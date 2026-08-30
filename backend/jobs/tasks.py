from celery import shared_task
from django.db import transaction
from django.db.models import F
from django.utils import timezone

from .models import BackgroundJob


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
    job.error = str(error)[:4000]
    job.finished_at = timezone.now()
    job.save(update_fields=('status', 'error', 'finished_at'))


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


def enqueue(task, *, job_type, owner=None, payload=None, total=0, idempotency_key=None):
    payload = payload or {}
    with transaction.atomic():
        if idempotency_key:
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
                return
            BackgroundJob.objects.filter(pk=job.pk).update(celery_task_id=result.id or '')

        transaction.on_commit(send)
    return job
