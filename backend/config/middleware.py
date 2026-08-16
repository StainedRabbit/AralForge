import logging
import os
from time import perf_counter


logger = logging.getLogger('ezoryx.performance')


class RequestTimingMiddleware:
    """Expose request duration and flag slow API calls in server logs."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.slow_request_ms = float(os.getenv('API_SLOW_REQUEST_MS', '750'))

    def __call__(self, request):
        started_at = perf_counter()
        response = self.get_response(request)
        duration_ms = (perf_counter() - started_at) * 1000

        if request.path.startswith('/api/'):
            metric = f'app;dur={duration_ms:.1f}'
            existing = response.get('Server-Timing')
            response['Server-Timing'] = f'{existing}, {metric}' if existing else metric
            response['X-Response-Time-Ms'] = f'{duration_ms:.1f}'

            if duration_ms >= self.slow_request_ms:
                logger.warning(
                    'Slow API request method=%s path=%s status=%s duration_ms=%.1f',
                    request.method,
                    request.path,
                    response.status_code,
                    duration_ms,
                )

        return response
