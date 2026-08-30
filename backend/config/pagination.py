from rest_framework.pagination import BasePagination, CursorPagination, LimitOffsetPagination
from rest_framework.response import Response


class AralForgeLimitOffsetPagination(LimitOffsetPagination):
    default_limit = 50
    max_limit = 100

    def get_paginated_response(self, data):
        return super().get_paginated_response(data)


class AralForgeCursorPagination(CursorPagination):
    page_size = 50
    page_size_query_param = 'limit'
    max_page_size = 100
    ordering = '-id'

    def paginate_queryset(self, queryset, request, view=None):
        self.total_count = queryset.count()
        requested_ordering = getattr(view, 'cursor_ordering', None)
        if requested_ordering:
            self.ordering = requested_ordering
        return super().paginate_queryset(queryset, request, view)

    def get_paginated_response(self, data):
        return Response({
            'count': self.total_count,
            'next': self.get_next_link(),
            'previous': self.get_previous_link(),
            'results': data,
        })


class AralForgePagination(BasePagination):
    """Opt-in cursor pages while preserving every existing limit/offset contract."""

    def paginate_queryset(self, queryset, request, view=None):
        pagination_class = (
            AralForgeCursorPagination
            if request.query_params.get('pagination') == 'cursor'
            else AralForgeLimitOffsetPagination
        )
        self.delegate = pagination_class()
        return self.delegate.paginate_queryset(queryset, request, view)

    def get_paginated_response(self, data):
        return self.delegate.get_paginated_response(data)
