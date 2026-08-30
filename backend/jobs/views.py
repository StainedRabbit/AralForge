from rest_framework import mixins, viewsets

from rest_framework.permissions import IsAuthenticated

from .models import BackgroundJob
from .serializers import BackgroundJobSerializer


class BackgroundJobViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = BackgroundJobSerializer
    permission_classes = [IsAuthenticated]
    cursor_ordering = ('-created_at', '-id')

    def get_queryset(self):
        queryset = BackgroundJob.objects.select_related('owner')
        if self.request.user.role == self.request.user.Role.ADMIN or self.request.user.is_superuser:
            return queryset
        return queryset.filter(owner=self.request.user)
