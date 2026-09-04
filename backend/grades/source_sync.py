from decimal import Decimal

from django.db import transaction
from django.db.models import Q

from subjects.models import ScheduleStudent

from .models import GradeItem, GradeItemSourceType, StudentGradeItemScore


def _normalized_score(earned, maximum, item_maximum):
    if earned is None or maximum is None or maximum <= 0:
        return None
    value = Decimal(earned) / Decimal(maximum) * Decimal(item_maximum)
    return min(max(value, Decimal('0')), Decimal(item_maximum))


def _module_activity_result(item, student):
    activity = item.module_activity
    if not activity:
        return None
    if activity.activity_type == activity.ActivityType.INTERACTIVE:
        candidates = [
            _normalized_score(attempt.score, attempt.max_score, item.points_possible)
            for attempt in activity.attempts.filter(
                student=student,
                status='SUBMITTED',
            ).filter(
                Q(
                    submission_method='ONLINE',
                    context_type='CLASS',
                    schedule=item.schedule,
                )
                | Q(submission_method='PAPER', paper_grade_item=item)
            )
        ]
    else:
        submission = activity.submissions.filter(student=student, graded_at__isnull=False).first()
        candidates = [
            _normalized_score(submission.score, activity.points_possible, item.points_possible)
        ] if submission else []
    resolved = [score for score in candidates if score is not None]
    return max(resolved) if resolved else None


def _attendance_result(item, student):
    record = item.attendance_session.records.filter(student=student).first() if item.attendance_session else None
    return _normalized_score(
        record.points_earned, item.attendance_session.points_possible, item.points_possible
    ) if record else None


def source_score(item, student):
    return {
        GradeItemSourceType.MODULE_ACTIVITY: _module_activity_result,
        GradeItemSourceType.ATTENDANCE: _attendance_result,
    }.get(item.source_type, lambda *_: None)(item, student)


@transaction.atomic
def sync_grade_item(item):
    if item.source_type == GradeItemSourceType.MANUAL or not item.schedule_id:
        return 0
    students = [
        enrollment.student
        for enrollment in ScheduleStudent.objects.filter(
            schedule=item.schedule, is_active=True
        ).select_related('student')
    ]
    changed = 0
    for student in students:
        existing = StudentGradeItemScore.objects.filter(grade_item=item, student=student).first()
        if existing and existing.origin == StudentGradeItemScore.Origin.OVERRIDE:
            continue
        score = source_score(item, student)
        if score is None:
            if existing and existing.origin == StudentGradeItemScore.Origin.AUTOMATIC:
                existing.delete()
                changed += 1
            continue
        StudentGradeItemScore.objects.update_or_create(
            grade_item=item,
            student=student,
            defaults={
                'raw_score': score,
                'status': StudentGradeItemScore.Status.GRADED,
                'origin': StudentGradeItemScore.Origin.AUTOMATIC,
                'override_reason': '',
                'remarks': 'Synchronized from linked work.',
            },
        )
        changed += 1
    return changed


def sync_items(queryset):
    return sum(sync_grade_item(item) for item in queryset.select_related(
        'schedule', 'module_activity', 'attendance_session'
    ))


@transaction.atomic
def sync_grade_items_for_students(queryset, student_ids):
    """Synchronize automatic items for a bounded student set without save signals."""
    student_ids = {int(student_id) for student_id in student_ids}
    if not student_ids:
        return 0

    student_model = StudentGradeItemScore._meta.get_field('student').remote_field.model
    students = list(student_model.objects.filter(id__in=student_ids))
    changed = 0
    for item in queryset.select_related('schedule', 'module_activity', 'attendance_session'):
        existing = {
            score.student_id: score
            for score in StudentGradeItemScore.objects.filter(
                grade_item=item,
                student_id__in=student_ids,
            )
        }
        creates = []
        updates = []
        delete_ids = []
        for student in students:
            current = existing.get(student.id)
            if current and current.origin == StudentGradeItemScore.Origin.OVERRIDE:
                continue
            score = source_score(item, student)
            if score is None:
                if current and current.origin == StudentGradeItemScore.Origin.AUTOMATIC:
                    delete_ids.append(current.id)
                continue
            if current:
                current.raw_score = score
                current.status = StudentGradeItemScore.Status.GRADED
                current.origin = StudentGradeItemScore.Origin.AUTOMATIC
                current.override_reason = ''
                current.remarks = 'Synchronized from linked work.'
                updates.append(current)
            else:
                creates.append(StudentGradeItemScore(
                    grade_item=item,
                    student=student,
                    raw_score=score,
                    status=StudentGradeItemScore.Status.GRADED,
                    origin=StudentGradeItemScore.Origin.AUTOMATIC,
                    override_reason='',
                    remarks='Synchronized from linked work.',
                ))
        if delete_ids:
            StudentGradeItemScore.objects.filter(id__in=delete_ids).delete()
        if creates:
            StudentGradeItemScore.objects.bulk_create(creates, batch_size=500)
        if updates:
            StudentGradeItemScore.objects.bulk_update(
                updates,
                ('raw_score', 'status', 'origin', 'override_reason', 'remarks'),
                batch_size=500,
            )
        changed += len(delete_ids) + len(creates) + len(updates)
    return changed


def sync_activity_attempt_target(attempt):
    """Synchronize only the class item and student affected by an attempt."""
    if not attempt.schedule_id:
        return 0
    items = GradeItem.objects.filter(
        source_type=GradeItemSourceType.MODULE_ACTIVITY,
        module_activity_id=attempt.activity_id,
        schedule_id=attempt.schedule_id,
    ).select_related('schedule', 'module_activity', 'attendance_session')
    if attempt.submission_method == 'PAPER' and attempt.paper_grade_item_id:
        items = items.filter(pk=attempt.paper_grade_item_id)

    changed = 0
    for item in items:
        existing = StudentGradeItemScore.objects.filter(
            grade_item=item,
            student_id=attempt.student_id,
        ).first()
        if existing and existing.origin == StudentGradeItemScore.Origin.OVERRIDE:
            continue
        score = source_score(item, attempt.student)
        if score is None:
            if existing and existing.origin == StudentGradeItemScore.Origin.AUTOMATIC:
                existing.delete()
                changed += 1
            continue
        StudentGradeItemScore.objects.update_or_create(
            grade_item=item,
            student_id=attempt.student_id,
            defaults={
                'raw_score': score,
                'status': StudentGradeItemScore.Status.GRADED,
                'origin': StudentGradeItemScore.Origin.AUTOMATIC,
                'override_reason': '',
                'remarks': 'Synchronized from linked work.',
            },
        )
        changed += 1
    return changed


def clear_automatic_scores(items):
    for item in items:
        item.student_scores.filter(origin=StudentGradeItemScore.Origin.AUTOMATIC).delete()
