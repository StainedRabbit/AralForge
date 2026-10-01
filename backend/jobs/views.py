from datetime import timedelta

from django.conf import settings
from django.core.files.storage import default_storage
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import BackgroundJob
from .serializers import BackgroundJobSerializer
from accounts.permissions import IsAdmin
from .tasks import create_full_backup, enqueue, expire_pending_roster_imports


class BackgroundJobViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = BackgroundJobSerializer
    permission_classes = [IsAuthenticated]
    cursor_ordering = ('-created_at', '-id')

    @action(detail=False, methods=['post'], permission_classes=[IsAdmin], url_path='backups')
    def backups(self, request):
        if settings.DATABASES['default']['ENGINE'] != 'django.db.backends.postgresql':
            raise ValidationError({'detail': 'Full backups require a PostgreSQL database.'})
        job = enqueue(
            create_full_backup,
            job_type=BackgroundJob.Type.BACKUP,
            owner=request.user,
            idempotency_key=f'full-backup:{request.user.pk}',
        )
        return Response(BackgroundJobSerializer(job).data, status=202)

    @action(detail=True, methods=['get'], permission_classes=[IsAdmin], url_path='backup-download')
    def backup_download(self, request, pk=None):
        job = self.get_object()
        if job.job_type != BackgroundJob.Type.BACKUP:
            raise Http404
        if job.status != BackgroundJob.Status.SUCCEEDED:
            return Response({'detail': 'This backup is not ready to download.'}, status=409)
        if not job.finished_at or job.finished_at <= timezone.now() - timedelta(hours=24):
            expire_backup(job)
            raise Http404
        storage_name = job.result.get('storage_name')
        if not storage_name or not default_storage.exists(storage_name):
            raise Http404
        return FileResponse(
            default_storage.open(storage_name, 'rb'),
            as_attachment=True,
            filename=f'aralforge-backup-{job.finished_at:%Y%m%d-%H%M%S}.zip',
            content_type='application/zip',
        )

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


def expire_backup(job):
    storage_name = job.result.get('storage_name')
    if storage_name and default_storage.exists(storage_name):
        default_storage.delete(storage_name)
    job.result = {}
    job.status = BackgroundJob.Status.FAILED
    job.error = 'This backup expired after 24 hours. Start a new backup to download a fresh copy.'
    job.save(update_fields=['result', 'status', 'error'])

