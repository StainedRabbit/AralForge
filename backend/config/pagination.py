from rest_framework.pagination import LimitOffsetPagination


class EzoryxLimitOffsetPagination(LimitOffsetPagination):
    default_limit = 50
    max_limit = 100

    def get_paginated_response(self, data):
        return super().get_paginated_response(data)
