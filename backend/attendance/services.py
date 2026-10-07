from datetime import datetime

from django.db import transaction
from django.utils import timezone

from subjects.models import ScheduleStudent

from .models import AttendanceRecord, AttendanceSession


def finalize_ended_attendance(*, now=None, delete_all_empty=False):
    """Delete empty ended sessions and mark unrecorded snapshot students absent."""
    now = now or timezone.now()
    local_now = timezone.localtime(now)
    deleted_sessions = 0
    created_absences = 0
    if delete_all_empty:
        empty_session_ids = AttendanceSession.objects.filter(
            records__isnull=True,
        ).values_list('id', flat=True)
        for session_id in empty_session_ids.iterator():
            with transaction.atomic():
                session = AttendanceSession.objects.select_for_update(of=('self',)).get(pk=session_id)
                if not session.records.exists():
                    session.delete()
                    deleted_sessions += 1

    sessions = AttendanceSession.objects.filter(
        schedule__isnull=False,
        date__lte=local_now.date(),
    ).select_related('schedule')
    for candidate in sessions.iterator():
        ended = bool(candidate.schedule_id and timezone.make_aware(
            datetime.combine(candidate.date, candidate.schedule.end_time),
            timezone.get_current_timezone(),
        ) <= now)
        if not ended:
            continue

        with transaction.atomic():
            session = AttendanceSession.objects.select_for_update(of=('self',)).select_related('schedule').get(pk=candidate.pk)
            existing_student_ids = set(session.records.values_list('student_id', flat=True))
            if not existing_student_ids:
                session.delete()
                deleted_sessions += 1
                continue
            if not ended or not session.schedule_id:
                continue

            roster_ids = set(session.roster_students.values_list('id', flat=True))
            if not roster_ids:
                roster_ids = set(ScheduleStudent.objects.filter(
                    schedule_id=session.schedule_id,
                    is_active=True,
                ).values_list('student_id', flat=True))
            missing_ids = roster_ids - existing_student_ids
            if missing_ids:
                AttendanceRecord.objects.bulk_create([
                    AttendanceRecord(
                        session=session,
                        student_id=student_id,
                        status=AttendanceRecord.Status.ABSENT,
                        points_earned=0,
                    )
                    for student_id in missing_ids
                ], ignore_conflicts=True)
                created_absences += len(missing_ids)

    return {'deleted_sessions': deleted_sessions, 'created_absences': created_absences}
