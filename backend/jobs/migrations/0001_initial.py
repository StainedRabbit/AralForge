import uuid

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(
            name='BackgroundJob',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('job_type', models.CharField(choices=[('GRADE_RECALCULATION', 'Grade recalculation'), ('MODULE_PROGRESS', 'Module progress synchronization'), ('PDF_GENERATION', 'PDF generation'), ('IMPORT', 'Import'), ('EXPORT', 'Export')], max_length=40)),
                ('status', models.CharField(choices=[('PENDING', 'Pending'), ('RUNNING', 'Running'), ('SUCCEEDED', 'Succeeded'), ('FAILED', 'Failed')], default='PENDING', max_length=20)),
                ('progress', models.PositiveIntegerField(default=0)),
                ('total', models.PositiveIntegerField(default=0)),
                ('payload', models.JSONField(blank=True, default=dict)),
                ('result', models.JSONField(blank=True, default=dict)),
                ('error', models.TextField(blank=True)),
                ('idempotency_key', models.CharField(blank=True, max_length=160, null=True)),
                ('celery_task_id', models.CharField(blank=True, max_length=80)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('started_at', models.DateTimeField(blank=True, null=True)),
                ('finished_at', models.DateTimeField(blank=True, null=True)),
                ('owner', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='background_jobs', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
                'indexes': [models.Index(fields=['status', 'created_at'], name='job_status_created_idx'), models.Index(fields=['owner', 'created_at'], name='job_owner_created_idx')],
                'constraints': [models.UniqueConstraint(condition=models.Q(('status__in', ('PENDING', 'RUNNING'))), fields=('idempotency_key',), name='unique_active_job_key')],
            },
        ),
    ]
