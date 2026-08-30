"""Small dependency-free authenticated API load check for staging environments."""

import argparse
import json
import math
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
    'modules/modules/?limit=50',
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
            db_match = re.search(r'db;dur=([0-9.]+)', server_timing)
            app_ms = float(response.headers.get('X-Response-Time-Ms', '0') or 0)
            db_ms = float(db_match.group(1)) if db_match else 0.0
            return response.status, payload, (time.perf_counter() - started_at) * 1000, app_ms, db_ms, len(raw)
    except HTTPError as error:
        return error.code, None, (time.perf_counter() - started_at) * 1000, 0.0, 0.0, 0
    except (TimeoutError, URLError):
        return 0, None, (time.perf_counter() - started_at) * 1000, 0.0, 0.0, 0


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
    parser.add_argument('--password', required=True)
    parser.add_argument('--requests', type=int, default=100)
    parser.add_argument('--concurrency', type=int, default=10)
    parser.add_argument('--p95-budget-ms', type=float, default=500)
    parser.add_argument('--path', action='append', dest='paths', help='Relative GET path; repeat for multiple endpoints.')
    args = parser.parse_args()
    if args.requests < 1 or args.concurrency < 1:
        parser.error('--requests and --concurrency must be positive integers')

    base_url = args.base_url.rstrip('/') + '/'
    status, payload, login_ms, _, _, _ = request_json(
        urljoin(base_url, 'auth/token/'),
        data={'username': args.username, 'password': args.password},
    )
    if status != 200 or not payload or 'access' not in payload:
        print(f'Login failed with status {status}.', file=sys.stderr)
        return 2

    paths = tuple(args.paths or DEFAULT_PATHS)

    def run(index):
        path = paths[index % len(paths)]
        response_status, _, duration_ms, app_ms, db_ms, response_bytes = request_json(
            urljoin(base_url, path), token=payload['access'],
        )
        return path, response_status, duration_ms, app_ms, db_ms, response_bytes

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
    app_durations = [result[3] for result in results if result[3] > 0]
    db_durations = [result[4] for result in results if result[4] > 0]
    response_sizes = [result[5] for result in results if 200 <= result[1] < 400]

    print(f'Login: {login_ms:.1f} ms')
    print(f'Requests: {len(results)} at concurrency {args.concurrency} in {elapsed:.2f} s')
    print(f'Throughput: {len(results) / elapsed:.1f} requests/s')
    if durations:
        print(f'Latency: mean {statistics.fmean(durations):.1f} ms, p50 {percentile(durations, 50):.1f} ms, p95 {p95:.1f} ms, p99 {percentile(durations, 99):.1f} ms, max {max(durations):.1f} ms')
        if app_durations:
            print(f'Application: p50 {percentile(app_durations, 50):.1f} ms, p95 {percentile(app_durations, 95):.1f} ms')
        if db_durations:
            print(f'Database: p50 {percentile(db_durations, 50):.1f} ms, p95 {percentile(db_durations, 95):.1f} ms')
        print(f'Response bytes: mean {statistics.fmean(response_sizes):.0f}, p95 {percentile(response_sizes, 95):.0f}, max {max(response_sizes)}')
    else:
        print('Latency: no successful responses')
    print(f'Errors: {len(errors)} ({(len(errors) / len(results)) * 100:.1f}%)')
    for path in paths:
        path_durations = [result[2] for result in results if result[0] == path and 200 <= result[1] < 400]
        if path_durations:
            print(f'  {path}: p95 {percentile(path_durations, 95):.1f} ms')

    return 1 if errors or not durations or p95 > args.p95_budget_ms else 0


if __name__ == '__main__':
    raise SystemExit(main())
