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
                is_submitted=True,
            ).filter(
                Q(submission_method='ONLINE')
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


def _coding_result(item, student):
    problem = item.coding_problem
    if not problem:
        return None
    candidates = [
        _normalized_score(submission.score, problem.points_possible, item.points_possible)
        for submission in problem.submissions.filter(student=student, score__isnull=False).exclude(
            status__in=['PENDING', 'RUNNING']
        )
    ]
    resolved = [score for score in candidates if score is not None]
    return max(resolved) if resolved else None


def source_score(item, student):
    return {
        GradeItemSourceType.MODULE_ACTIVITY: _module_activity_result,
        GradeItemSourceType.ATTENDANCE: _attendance_result,
        GradeItemSourceType.CODING: _coding_result,
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
        'schedule', 'module_activity', 'attendance_session', 'coding_problem'
    ))


def clear_automatic_scores(items):
    for item in items:
        item.student_scores.filter(origin=StudentGradeItemScore.Origin.AUTOMATIC).delete()
