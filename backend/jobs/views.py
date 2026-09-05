from rest_framework import mixins, viewsets

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import BackgroundJob
from .serializers import BackgroundJobSerializer
from .tasks import expire_pending_roster_imports


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

    def retrieve(self, request, *args, **kwargs):
        job = self.get_object()
        if expire_pending_roster_imports(BackgroundJob.objects.filter(pk=job.pk)):
            job.refresh_from_db()
        return Response(self.get_serializer(job).data)
