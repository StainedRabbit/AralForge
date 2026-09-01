import logging
import os
from time import perf_counter

from django.db import connection


logger = logging.getLogger('aralforge.performance')


class DatabaseTiming:
    def __init__(self):
        self.duration_ms = 0.0
        self.query_count = 0

    def __call__(self, execute, sql, params, many, context):
        started_at = perf_counter()
        try:
            return execute(sql, params, many, context)
        finally:
            self.duration_ms += (perf_counter() - started_at) * 1000
            self.query_count += 1


class RequestTimingMiddleware:
    """Expose request duration and flag slow API calls in server logs."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.slow_request_ms = float(os.getenv('API_SLOW_REQUEST_MS', '750'))
        self.db_timing_enabled = os.getenv('API_DB_TIMING_ENABLED', '').strip().lower() in {
            '1', 'true', 'yes', 'on',
        }

    def __call__(self, request):
        started_at = perf_counter()
        database_timing = DatabaseTiming() if self.db_timing_enabled else None
        if database_timing:
            with connection.execute_wrapper(database_timing):
                response = self.get_response(request)
        else:
            response = self.get_response(request)
        duration_ms = (perf_counter() - started_at) * 1000

        if request.path.startswith('/api/'):
            metric = f'app;dur={duration_ms:.1f}'
            if database_timing:
                metric += (
                    f', db;dur={database_timing.duration_ms:.1f};desc="{database_timing.query_count} queries"'
                )
            existing = response.get('Server-Timing')
            response['Server-Timing'] = f'{existing}, {metric}' if existing else metric
            response['X-Response-Time-Ms'] = f'{duration_ms:.1f}'

            if duration_ms >= self.slow_request_ms:
                if database_timing:
                    database_ms = database_timing.duration_ms
                    database_share = min(
                        (database_ms / duration_ms) * 100 if duration_ms else 0.0,
                        100.0,
                    )
                    non_database_ms = max(duration_ms - database_ms, 0.0)
                    query_count = database_timing.query_count
                else:
                    database_ms = -1.0
                    database_share = -1.0
                    non_database_ms = -1.0
                    query_count = -1
                request_view = (
                    'summary'
                    if request.GET.get('view') == 'summary'
                    else 'default'
                )
                logger.warning(
                    'Slow API request method=%s path=%s view=%s status=%s '
                    'duration_ms=%.1f db_ms=%.1f db_share_pct=%.1f '
                    'non_db_ms=%.1f queries=%s bytes=%s',
                    request.method,
                    request.path,
                    request_view,
                    response.status_code,
                    duration_ms,
                    database_ms,
                    database_share,
                    non_database_ms,
                    query_count,
                    response.get('Content-Length', '-'),
                )

        return response
