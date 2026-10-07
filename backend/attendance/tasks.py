import logging

from celery import shared_task

from .services import finalize_ended_attendance


logger = logging.getLogger(__name__)


@shared_task
def finalize_ended_attendance_sessions():
    result = finalize_ended_attendance()
    if result['deleted_sessions'] or result['created_absences']:
        logger.info('Attendance finalization completed: %s', result)
    return result
