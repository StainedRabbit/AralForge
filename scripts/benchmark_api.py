"""Small dependency-free authenticated API load check for staging environments."""

import argparse
import json
import math
import os
import statistics
import sys
import time
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


DEFAULT_PATHS = (
    'accounts/users/me/',
    'overview/navigation/',
    'overview/dashboard/',
    'subjects/subjects/?limit=50',
    'modules/modules/?view=summary&limit=100',
)


def parse_server_timing(value):
    db_match = re.search(
        r'db;dur=([0-9.]+)(?:;desc="([0-9]+) queries")?',
        value,
    )
    if not db_match:
        return None, None
    return (
        float(db_match.group(1)),
        int(db_match.group(2)) if db_match.group(2) is not None else None,
    )


def request_json(url, *, data=None, token=None, timeout=20):
    headers = {'Accept': 'application/json'}
    body = None
    if data is not None:
        body = json.dumps(data).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    if token:
        headers['Authorization'] = f'Bearer {token}'

    started_at = time.perf_counter()
    request = Request(url, data=body, headers=headers)
    try:
        with urlopen(request, timeout=timeout) as response:
            raw = response.read()
            payload = json.loads(raw.decode('utf-8'))
            server_timing = response.headers.get('Server-Timing', '')
            db_ms, query_count = parse_server_timing(server_timing)
            app_header = response.headers.get('X-Response-Time-Ms')
            app_ms = float(app_header) if app_header else None
            return (
                response.status,
                payload,
                (time.perf_counter() - started_at) * 1000,
                app_ms,
                db_ms,
                query_count,
                len(raw),
            )
    except HTTPError as error:
        return error.code, None, (time.perf_counter() - started_at) * 1000, None, None, None, 0
    except (TimeoutError, URLError):
        return 0, None, (time.perf_counter() - started_at) * 1000, None, None, None, 0


def percentile(values, percentile_value):
    if not values:
        return 0.0
    ordered = sorted(values)
    index = max(0, math.ceil((percentile_value / 100) * len(ordered)) - 1)
    return ordered[index]


def main():
    parser = argparse.ArgumentParser(description='Exercise authenticated AralForge read endpoints.')
    parser.add_argument('--base-url', required=True, help='API root, for example https://staging.example.com/api/')
    parser.add_argument('--username', required=True)
    parser.add_argument(
        '--password',
        default=os.getenv('ARALFORGE_BENCHMARK_PASSWORD'),
        help='Defaults to ARALFORGE_BENCHMARK_PASSWORD to avoid shell history.',
    )
    parser.add_argument('--requests', type=int, default=100)
    parser.add_argument('--concurrency', type=int, default=10)
    parser.add_argument('--warmup', type=int, default=2, help='Discarded requests per path.')
    parser.add_argument('--p50-budget-ms', type=float, default=500)
    parser.add_argument('--p95-budget-ms', type=float, default=750)
    parser.add_argument('--query-budget', type=int)
    parser.add_argument('--require-db-timing', action='store_true')
    parser.add_argument('--path', action='append', dest='paths', help='Relative GET path; repeat for multiple endpoints.')
    args = parser.parse_args()
    if not args.password:
        parser.error('--password or ARALFORGE_BENCHMARK_PASSWORD is required')
    if args.requests < 1 or args.concurrency < 1 or args.warmup < 0:
        parser.error('--requests and --concurrency must be positive; --warmup cannot be negative')
    if args.query_budget is not None and args.query_budget < 0:
        parser.error('--query-budget cannot be negative')

    base_url = args.base_url.rstrip('/') + '/'
    status, payload, login_ms, _, _, _, _ = request_json(
        urljoin(base_url, 'auth/token/'),
        data={'username': args.username, 'password': args.password},
    )
    if status != 200 or not payload or 'access' not in payload:
        print(f'Login failed with status {status}.', file=sys.stderr)
        return 2

    paths = tuple(args.paths or DEFAULT_PATHS)

    warmup_errors = []
    for path in paths:
        for _index in range(args.warmup):
            warmup_result = request_json(
                urljoin(base_url, path),
                token=payload['access'],
            )
            if not 200 <= warmup_result[0] < 400:
                warmup_errors.append((path, warmup_result[0]))
    if warmup_errors:
        print(f'Warm-up failed: {warmup_errors}', file=sys.stderr)
        return 2

    def run(index):
        path = paths[index % len(paths)]
        response_status, _, duration_ms, app_ms, db_ms, query_count, response_bytes = request_json(
            urljoin(base_url, path), token=payload['access'],
        )
        return path, response_status, duration_ms, app_ms, db_ms, query_count, response_bytes

    started_at = time.perf_counter()
    results = []
    with ThreadPoolExecutor(max_workers=args.concurrency) as executor:
        futures = [executor.submit(run, index) for index in range(args.requests)]
        for future in as_completed(futures):
            results.append(future.result())

    elapsed = time.perf_counter() - started_at
    durations = [result[2] for result in results if 200 <= result[1] < 400]
    errors = [result for result in results if not 200 <= result[1] < 400]
    p95 = percentile(durations, 95)
    app_durations = [result[3] for result in results if result[3] is not None]
    db_durations = [result[4] for result in results if result[4] is not None]
    query_counts = [result[5] for result in results if result[5] is not None]
    response_sizes = [result[6] for result in results if 200 <= result[1] < 400]
    database_shares = [
        (result[4] / result[3]) * 100
        for result in results
        if result[3] and result[4] is not None
    ]
    budget_durations = app_durations if len(app_durations) == len(durations) else durations
    budget_source = 'application' if budget_durations is app_durations else 'network'
    budget_p50 = percentile(budget_durations, 50)
    budget_p95 = percentile(budget_durations, 95)

    print(f'Login: {login_ms:.1f} ms')
    print(f'Warm-up: {args.warmup} discarded request(s) per path')
    print(f'Requests: {len(results)} at concurrency {args.concurrency} in {elapsed:.2f} s')
    print(f'Throughput: {len(results) / elapsed:.1f} requests/s')
    if durations:
        print(f'Latency: mean {statistics.fmean(durations):.1f} ms, p50 {percentile(durations, 50):.1f} ms, p95 {p95:.1f} ms, p99 {percentile(durations, 99):.1f} ms, max {max(durations):.1f} ms')
        if app_durations:
            print(f'Application: p50 {percentile(app_durations, 50):.1f} ms, p95 {percentile(app_durations, 95):.1f} ms')
        if db_durations:
            print(f'Database: p50 {percentile(db_durations, 50):.1f} ms, p95 {percentile(db_durations, 95):.1f} ms')
        if database_shares:
            print(f'Database share: p50 {percentile(database_shares, 50):.1f}%, p95 {percentile(database_shares, 95):.1f}%')
        if query_counts:
            print(f'Queries: p50 {percentile(query_counts, 50):.0f}, p95 {percentile(query_counts, 95):.0f}, max {max(query_counts)}')
        print(f'Response bytes: mean {statistics.fmean(response_sizes):.0f}, p95 {percentile(response_sizes, 95):.0f}, max {max(response_sizes)}')
    else:
        print('Latency: no successful responses')
    print(f'Errors: {len(errors)} ({(len(errors) / len(results)) * 100:.1f}%)')
    for path in paths:
        path_results = [result for result in results if result[0] == path and 200 <= result[1] < 400]
        path_durations = [result[2] for result in path_results]
        if path_durations:
            path_app = [result[3] for result in path_results if result[3] is not None]
            path_db = [result[4] for result in path_results if result[4] is not None]
            path_queries = [result[5] for result in path_results if result[5] is not None]
            details = [f'network p95 {percentile(path_durations, 95):.1f} ms']
            if path_app:
                details.append(f'app p95 {percentile(path_app, 95):.1f} ms')
            if path_db:
                details.append(f'db p95 {percentile(path_db, 95):.1f} ms')
            if path_queries:
                details.append(f'queries max {max(path_queries)}')
            print(f'  {path}: {", ".join(details)}')

    print(
        f'Budget source: {budget_source}; p50 {budget_p50:.1f}/{args.p50_budget_ms:.1f} ms, '
        f'p95 {budget_p95:.1f}/{args.p95_budget_ms:.1f} ms'
    )
    timing_missing = args.require_db_timing and len(db_durations) != len(durations)
    query_budget_exceeded = (
        args.query_budget is not None
        and (not query_counts or max(query_counts) > args.query_budget)
    )
    if timing_missing:
        print('Database timing was required but was absent from one or more responses.', file=sys.stderr)
    if query_budget_exceeded:
        print(
            f'Query budget failed: observed max {max(query_counts) if query_counts else "unavailable"}, '
            f'budget {args.query_budget}.',
            file=sys.stderr,
        )
    failed = (
        errors
        or not durations
        or budget_p50 > args.p50_budget_ms
        or budget_p95 > args.p95_budget_ms
        or timing_missing
        or query_budget_exceeded
    )
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
