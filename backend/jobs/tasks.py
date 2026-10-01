import logging
import json
import os
import subprocess
import tempfile
import zipfile
from datetime import timedelta
from pathlib import PurePosixPath
from shutil import copyfileobj

from celery import shared_task
from django.conf import settings
from django.core.files import File
from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from config.object_storage import safe_exception_message

from .models import BackgroundJob


logger = logging.getLogger(__name__)


def expire_pending_roster_imports(queryset):
    """Release abandoned roster jobs; a conditional claim prevents late execution."""
    cutoff = timezone.now() - timedelta(seconds=settings.ROSTER_IMPORT_QUEUE_TIMEOUT_SECONDS)
    return queryset.filter(
        job_type=BackgroundJob.Type.IMPORT,
        idempotency_key__startswith='roster-import:',
        status=BackgroundJob.Status.PENDING,
        created_at__lte=cutoff,
    ).update(
        status=BackgroundJob.Status.FAILED,
        error='The import did not start in time. Ask your administrator to check the background worker, then preview and import the file again. No students were imported.',
        payload={},
        finished_at=timezone.now(),
    )


def mark_running(job):
    BackgroundJob.objects.filter(pk=job.pk).update(
        status=BackgroundJob.Status.RUNNING,
        attempts=F('attempts') + 1,
        started_at=timezone.now(),
        finished_at=None,
        error='',
    )
    job.refresh_from_db()


def mark_failed(job, error):
    job.status = BackgroundJob.Status.FAILED
    job.error = safe_exception_message(error)
    job.finished_at = timezone.now()
    job.save(update_fields=('status', 'error', 'finished_at'))
    logger.error('Background job %s failed: %s', job.pk, job.error)


@shared_task(bind=True, autoretry_for=(ConnectionError,), retry_backoff=True, retry_kwargs={'max_retries': 3})
def recalculate_subject_grades(self, job_id):
    job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job)
    try:
        from grades.signals import recompute_subject_students_now
        from subjects.models import Subject

        subject = Subject.objects.get(pk=job.payload['subject_id'])
        processed = recompute_subject_students_now(subject, job=job)
        job.status = BackgroundJob.Status.SUCCEEDED
        job.progress = processed
        job.result = {'processed_students': processed, 'subject': subject.id}
        job.finished_at = timezone.now()
        job.save(update_fields=('status', 'progress', 'result', 'finished_at'))
    except Exception as error:
        mark_failed(job, error)
        raise


@shared_task(bind=True, autoretry_for=(ConnectionError,), retry_backoff=True, retry_kwargs={'max_retries': 3})
def generate_topic_pdf_job(self, job_id):
    job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job)
    try:
        from learning_modules.models import ModuleTopic
        from learning_modules.services.pdf_generation import generate_topic_pdf

        topic = generate_topic_pdf(ModuleTopic.objects.get(pk=job.payload['topic_id']))
        job.status = BackgroundJob.Status.SUCCEEDED
        job.progress = 1
        job.result = {'topic': topic.id, 'pdf_file': topic.pdf_file.name}
        job.finished_at = timezone.now()
        job.save(update_fields=('status', 'progress', 'result', 'finished_at'))
    except Exception as error:
        mark_failed(job, error)
        raise


@shared_task(bind=True, autoretry_for=(ConnectionError,), retry_backoff=True, retry_kwargs={'max_retries': 3})
def sync_module_progress_job(self, job_id):
    job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job)
    try:
        from learning_modules.models import Module, sync_module_progress_for_students

        module = Module.objects.get(pk=job.payload['module_id'])
        processed = sync_module_progress_for_students(
            module,
            force_inline=True,
            job=job,
        )
        job.status = BackgroundJob.Status.SUCCEEDED
        job.progress = processed
        job.result = {'processed_contexts': processed, 'module': module.id}
        job.finished_at = timezone.now()
        job.save(update_fields=('status', 'progress', 'result', 'finished_at'))
    except Exception as error:
        mark_failed(job, error)
        raise


def enqueue(
    task,
    *,
    job_type,
    owner=None,
    payload=None,
    total=0,
    idempotency_key=None,
    dispatch_failure_payload=None,
):
    payload = payload or {}
    with transaction.atomic():
        if idempotency_key:
            expire_pending_roster_imports(BackgroundJob.objects.filter(idempotency_key=idempotency_key))
            existing = BackgroundJob.objects.select_for_update().filter(
                idempotency_key=idempotency_key,
                status__in=(BackgroundJob.Status.PENDING, BackgroundJob.Status.RUNNING),
            ).first()
            if existing:
                return existing
        job = BackgroundJob.objects.create(
            job_type=job_type,
            owner=owner,
            payload=payload,
            total=total,
            idempotency_key=idempotency_key,
        )

        def send():
            try:
                result = task.delay(str(job.id))
            except Exception as error:
                mark_failed(job, error)
                if dispatch_failure_payload is not None:
                    BackgroundJob.objects.filter(pk=job.pk).update(payload=dispatch_failure_payload)
                return
            BackgroundJob.objects.filter(pk=job.pk).update(celery_task_id=result.id or '')

        transaction.on_commit(send)
    return job


def _list_media_objects(storage, path=''):
    directories, files = storage.listdir(path)
    for filename in files:
        key = f'{path}/{filename}'.lstrip('/')
        if key != 'backups' and not key.startswith('backups/'):
            yield key
    for directory in directories:
        child = f'{path}/{directory}'.strip('/')
        if child != 'backups' and not child.startswith('backups/'):
            yield from _list_media_objects(storage, child)


def _run_pg_dump(destination):
    database = settings.DATABASES['default']
    command = ['pg_dump', '--format=custom', '--no-owner', '--no-privileges', '--no-password']
    for option, flag in (('HOST', '--host'), ('PORT', '--port'), ('USER', '--username'), ('NAME', '--dbname')):
        value = database.get(option)
        if value:
            command.extend((flag, str(value)))
    environment = os.environ.copy()
    if database.get('PASSWORD'):
        environment['PGPASSWORD'] = str(database['PASSWORD'])
    for option in ('sslmode', 'sslrootcert', 'sslcert', 'sslkey', 'target_session_attrs'):
        value = database.get('OPTIONS', {}).get(option)
        if value:
            environment[f'PG{option.upper()}'] = str(value)
    with open(destination, 'wb') as output:
        completed = subprocess.run(command, stdout=output, stderr=subprocess.PIPE, env=environment, check=False)
    if completed.returncode:
        raise RuntimeError('PostgreSQL backup command failed.')


@shared_task(bind=True)
def create_full_backup(self, job_id):
    job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job)
    storage_name = f'backups/{job.pk}.zip'
    try:
        if settings.DATABASES['default']['ENGINE'] != 'django.db.backends.postgresql':
            raise RuntimeError('Full backups require PostgreSQL.')
        with tempfile.TemporaryDirectory(prefix='aralforge-backup-') as workdir:
            dump_path = os.path.join(workdir, 'database.backup')
            archive_path = os.path.join(workdir, 'full-backup.zip')
            _run_pg_dump(dump_path)
            media_keys = sorted(_list_media_objects(default_storage))
            job.total = len(media_keys) + 1
            job.progress = 1
            job.save(update_fields=['total', 'progress'])
            manifest = {
                'format': 'AralForge full backup v1',
                'created_at': timezone.now().isoformat(),
                'database': {'file': 'database.backup', 'format': 'PostgreSQL custom archive'},
                'media_count': len(media_keys),
                'media_prefix': 'media/',
                'restore_note': 'Restore database.backup with pgAdmin Restore, then copy media/ contents to the configured media storage.',
            }
            with zipfile.ZipFile(archive_path, 'w', compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                archive.write(dump_path, 'database.backup')
                archive.writestr('manifest.json', json.dumps(manifest, indent=2))
                for index, key in enumerate(media_keys, start=1):
                    safe_key = str(PurePosixPath(key))
                    if '\\' in key or any(part in {'..', '.'} for part in PurePosixPath(key).parts) or safe_key.startswith('/'):
                        raise RuntimeError('Media storage returned an unsafe object path.')
                    with default_storage.open(key, 'rb') as source, archive.open(f'media/{safe_key}', 'w') as target:
                        copyfileobj(source, target, length=1024 * 1024)
                    job.progress = index + 1
                    job.save(update_fields=['progress'])
            with open(archive_path, 'rb') as archive_file:
                saved_name = default_storage.save(storage_name, File(archive_file, name=os.path.basename(storage_name)))
            job.status = BackgroundJob.Status.SUCCEEDED
            job.total = len(media_keys) + 1
            job.progress = job.total
            job.result = {'storage_name': saved_name, 'media_count': len(media_keys)}
            job.finished_at = timezone.now()
            job.save(update_fields=['status', 'total', 'progress', 'result', 'finished_at'])
    except Exception:
        logger.exception('Full backup job %s failed.', job.pk)
        job.status = BackgroundJob.Status.FAILED
        job.result = {}
        job.error = 'The full backup could not be completed. Check the backup worker configuration and storage access.'
        job.finished_at = timezone.now()
        job.save(update_fields=['status', 'result', 'error', 'finished_at'])
        if default_storage.exists(storage_name):
            default_storage.delete(storage_name)
        raise


@shared_task
def expire_old_backup_artifacts():
    cutoff = timezone.now() - timedelta(hours=24)
    expired = BackgroundJob.objects.filter(
        job_type=BackgroundJob.Type.BACKUP,
        status=BackgroundJob.Status.SUCCEEDED,
        finished_at__lte=cutoff,
    )
    for job in expired.iterator():
        storage_name = job.result.get('storage_name')
        if storage_name and default_storage.exists(storage_name):
            default_storage.delete(storage_name)
        job.result = {}
        job.status = BackgroundJob.Status.FAILED
        job.error = 'This backup expired after 24 hours. Start a new backup to download a fresh copy.'
        job.save(update_fields=['result', 'status', 'error'])
