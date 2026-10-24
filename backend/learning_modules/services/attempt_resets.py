from django.db import transaction
from django.db.models import Max, Q

from accounts.models import User
from learning_modules.models import (
    LearningContextType,
    ModuleActivity,
    ModuleActivityAttempt,
    ModuleActivityAttemptReset,
)
from subjects.models import ScheduleStudent, SchoolYearSemester, SubjectSchedule


ATTEMPT_LIMIT = 3


def active_semester_attempt_reset_scope():
    semesters = list(
        SchoolYearSemester.objects.filter(
            is_active=True,
            school_year__is_active=True,
        ).select_related('school_year').order_by(
            '-school_year__start_year', 'semester', 'id',
        )[:2]
    )
    if not semesters:
        raise ValueError('No active semester was found in an active school year.')
    if len(semesters) > 1:
        choices = ', '.join(f'{semester.id}: {semester.name}' for semester in semesters)
        raise ValueError(
            'More than one active semester was found; refusing to guess: '
            f'{choices}.'
        )

    semester = semesters[0]
    schedules = list(
        SubjectSchedule.objects.filter(
            school_year_semester=semester,
            is_active=True,
        ).select_related('subject')
    )
    targets = set()
    activity_ids = set()
    for schedule in schedules:
        activities = ModuleActivity.objects.filter(
            activity_type=ModuleActivity.ActivityType.INTERACTIVE,
            is_published=True,
            module__is_published=True,
            lesson__isnull=False,
            lesson__is_published=True,
            lesson__topic__is_published=True,
        ).filter(
            Q(module__subject=schedule.subject)
            | Q(module__subjects=schedule.subject)
        ).distinct().values_list('id', flat=True)
        activity_ids.update(activities)
        student_ids = ScheduleStudent.objects.filter(
            schedule=schedule,
            is_active=True,
            student__role=User.Role.STUDENT,
        ).values_list('student_id', flat=True)
        targets.update(
            (activity_id, student_id, schedule.id)
            for activity_id in activities
            for student_id in student_ids
        )

    schedule_ids = {schedule.id for schedule in schedules}
    paper_contexts = set(
        ModuleActivityAttempt.objects.filter(
            activity_id__in=activity_ids,
            schedule_id__in=schedule_ids,
            context_type=LearningContextType.CLASS,
            submission_method=ModuleActivityAttempt.SubmissionMethod.PAPER,
            status=ModuleActivityAttempt.Status.SUBMITTED,
        ).values_list('activity_id', 'student_id', 'schedule_id')
    )
    previously_reset = set(
        ModuleActivityAttemptReset.objects.filter(
            activity_id__in=activity_ids,
            schedule_id__in=schedule_ids,
        ).values_list('activity_id', 'student_id', 'schedule_id')
    )
    eligible_targets = sorted(targets - paper_contexts - previously_reset)
    return {
        'semester': semester,
        'targets': targets,
        'eligible_targets': eligible_targets,
        'paper_contexts': paper_contexts,
        'previously_reset': previously_reset,
        'activity_ids': activity_ids,
        'schedule_ids': schedule_ids,
    }


def attempt_reset_preview(scope):
    semester = scope['semester']
    targets = scope['targets']
    return {
        'semester': {'id': semester.id, 'name': semester.name},
        'attempt_limit': ATTEMPT_LIMIT,
        'eligible_context_count': len(scope['eligible_targets']),
        'paper_excluded_context_count': len(targets.intersection(scope['paper_contexts'])),
        'already_reset_context_count': len(targets.intersection(scope['previously_reset'])),
        'history_preserved': True,
    }


@transaction.atomic
def grant_active_semester_attempt_resets():
    scope = active_semester_attempt_reset_scope()
    eligible_targets = scope['eligible_targets']
    if not eligible_targets:
        return {**attempt_reset_preview(scope), 'granted_context_count': 0}

    cutoffs = {
        (row['activity_id'], row['student_id'], row['schedule_id']): row['cutoff'] or 0
        for row in ModuleActivityAttempt.objects.filter(
            context_type=LearningContextType.CLASS,
            activity_id__in=scope['activity_ids'],
            schedule_id__in=scope['schedule_ids'],
        ).values(
            'activity_id', 'student_id', 'schedule_id',
        ).annotate(cutoff=Max('id'))
    }
    resets = [
        ModuleActivityAttemptReset(
            activity_id=activity_id,
            student_id=student_id,
            schedule_id=schedule_id,
            attempt_id_cutoff=cutoffs.get(
                (activity_id, student_id, schedule_id),
                0,
            ),
            attempt_limit=ATTEMPT_LIMIT,
        )
        for activity_id, student_id, schedule_id in eligible_targets
    ]
    ModuleActivityAttemptReset.objects.bulk_create(resets)
    return {
        **attempt_reset_preview(active_semester_attempt_reset_scope()),
        'granted_context_count': len(resets),
    }
