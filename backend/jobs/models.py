import uuid

from django.conf import settings
from django.db import models


class BackgroundJob(models.Model):
    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        RUNNING = 'RUNNING', 'Running'
        SUCCEEDED = 'SUCCEEDED', 'Succeeded'
        FAILED = 'FAILED', 'Failed'

    class Type(models.TextChoices):
        GRADE_RECALCULATION = 'GRADE_RECALCULATION', 'Grade recalculation'
        MODULE_PROGRESS = 'MODULE_PROGRESS', 'Module progress synchronization'
        PDF_GENERATION = 'PDF_GENERATION', 'PDF generation'
        IMPORT = 'IMPORT', 'Import'
        EXPORT = 'EXPORT', 'Export'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job_type = models.CharField(max_length=40, choices=Type)
    owner = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='background_jobs',
        null=True,
        blank=True,
    )
    status = models.CharField(max_length=20, choices=Status, default=Status.PENDING)
    attempts = models.PositiveIntegerField(default=0)
    progress = models.PositiveIntegerField(default=0)
    total = models.PositiveIntegerField(default=0)
    payload = models.JSONField(default=dict, blank=True)
    result = models.JSONField(default=dict, blank=True)
    error = models.TextField(blank=True)
    idempotency_key = models.CharField(max_length=160, null=True, blank=True)
    celery_task_id = models.CharField(max_length=80, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    started_at = models.DateTimeField(null=True, blank=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['status', 'created_at'], name='job_status_created_idx'),
            models.Index(fields=['owner', 'created_at'], name='job_owner_created_idx'),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=['idempotency_key'],
                condition=models.Q(status__in=('PENDING', 'RUNNING')),
                name='unique_active_job_key',
            ),
        ]

    def __str__(self):
        return f'{self.job_type} {self.id} ({self.status})'
