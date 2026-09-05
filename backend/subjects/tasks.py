from celery import shared_task
from django.utils import timezone
from django.db.models import F

from jobs.models import BackgroundJob
from jobs.tasks import expire_pending_roster_imports

from .models import SubjectSchedule
from .roster_import import (
    RosterImportValidationError,
    commit_roster_import,
    prepare_password_hashes,
    validate_roster_rows,
)


def _finish_failed(job_id, message, *, result=None):
    job = BackgroundJob.objects.get(pk=job_id)
    schedule_id = job.payload.get('schedule_id')
    job.status = BackgroundJob.Status.FAILED
    job.error = str(message)[:4000]
    job.result = result or {}
    job.payload = {'schedule_id': schedule_id} if schedule_id else {}
    job.finished_at = timezone.now()
    job.save(update_fields=('status', 'error', 'result', 'payload', 'finished_at'))


@shared_task(bind=True)
def import_roster_job(self, job_id):
    queryset = BackgroundJob.objects.filter(pk=job_id)
    expire_pending_roster_imports(queryset)
    claimed = queryset.filter(status=BackgroundJob.Status.PENDING).update(
        status=BackgroundJob.Status.RUNNING,
        attempts=F('attempts') + 1,
        started_at=timezone.now(),
        finished_at=None,
        error='',
    )
    job = BackgroundJob.objects.get(pk=job_id)
    if not claimed:
        return job.result
    schedule_id = job.payload['schedule_id']
    actor_id = job.payload['actor_id']
    rows = job.payload['rows']

    try:
        schedule = SubjectSchedule.objects.get(pk=schedule_id)
        validation = validate_roster_rows(schedule, rows)
        if not validation.preview['valid']:
            _finish_failed(
                job.id,
                'The roster is no longer valid. No students were imported.',
                result={'preview': validation.preview},
            )
            return None

        def update_progress(processed):
            if processed == len(validation.entries) or processed % 10 == 0:
                BackgroundJob.objects.filter(pk=job.id).update(progress=processed)

        password_hashes = prepare_password_hashes(validation, progress=update_progress)
        job.refresh_from_db()
        return commit_roster_import(
            schedule_id=schedule_id,
            rows=rows,
            actor_id=actor_id,
            password_hashes=password_hashes,
            job=job,
        )
    except RosterImportValidationError as error:
        _finish_failed(
            job.id,
            'The roster changed while the import was running. No students were imported.',
            result={'preview': error.preview},
        )
        return None
    except Exception:
        _finish_failed(job.id, 'The roster import failed. No students were imported.')
        raise
