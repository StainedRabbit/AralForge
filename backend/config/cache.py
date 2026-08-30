from django.core.cache import cache
from rest_framework.response import Response


class CachedReferenceListMixin:
    """Short-lived cache for non-user-specific reference lists only."""

    cache_namespace = None
    cache_timeout = 300

    def _cache_version_key(self):
        return f'aralforge:reference-version:{self.cache_namespace}'

    def _cache_version(self):
        return cache.get_or_set(self._cache_version_key(), 1, timeout=None)

    def list(self, request, *args, **kwargs):
        key = (
            f'aralforge:reference:{self.cache_namespace}:{self._cache_version()}:'
            f'{request.query_params.urlencode()}'
        )
        cached = cache.get(key)
        if cached is not None:
            return Response(cached)
        response = super().list(request, *args, **kwargs)
        if response.status_code == 200:
            cache.set(key, response.data, self.cache_timeout)
        return response

    def _invalidate_reference_cache(self):
        version_key = self._cache_version_key()
        try:
            cache.incr(version_key)
        except ValueError:
            cache.set(version_key, 2, timeout=None)

    def perform_create(self, serializer):
        super().perform_create(serializer)
        self._invalidate_reference_cache()

    def perform_update(self, serializer):
        super().perform_update(serializer)
        self._invalidate_reference_cache()

    def perform_destroy(self, instance):
        super().perform_destroy(instance)
        self._invalidate_reference_cache()
