from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from attendance.models import AttendanceRecord
from gamification.models import PointLedger
from grades.models import (
    FinalGrade,
    GradePublication,
    PeriodGrade,
    PublishedStudentGrade,
    StudentCategoryGrade,
    StudentGradeItemScore,
)
from learning_modules.models import (
    ModuleActivityAttempt,
    ModuleActivitySubmission,
    ModuleLessonProgress,
    ModuleProgress,
    ModuleTopicProgress,
)
from subjects.models import ScheduleStudent, SubjectSchedule

from .models import LegalHold, PurgeRun


def retention_preview(closure):
    schedule_ids = list(SubjectSchedule.objects.filter(
        school_year_semester=closure.term,
    ).values_list('id', flat=True))
    student_ids = list(ScheduleStudent.objects.filter(
        schedule_id__in=schedule_ids,
    ).values_list('student_id', flat=True).distinct())
    counts = {
        'attendance_records': AttendanceRecord.objects.filter(session__schedule_id__in=schedule_ids).count(),
        'grade_item_scores': StudentGradeItemScore.objects.filter(grade_item__schedule_id__in=schedule_ids).count(),
        'category_grades': StudentCategoryGrade.objects.filter(schedule_id__in=schedule_ids).count(),
        'period_grades': PeriodGrade.objects.filter(schedule_id__in=schedule_ids).count(),
        'final_grades': FinalGrade.objects.filter(schedule_id__in=schedule_ids).count(),
        'published_snapshots': PublishedStudentGrade.objects.filter(publication__schedule_id__in=schedule_ids).count(),
        'grade_publications': GradePublication.objects.filter(schedule_id__in=schedule_ids).count(),
        'activity_attempts': ModuleActivityAttempt.objects.filter(schedule_id__in=schedule_ids).count(),
        'module_progress': ModuleProgress.objects.filter(schedule_id__in=schedule_ids).count(),
        'topic_progress': ModuleTopicProgress.objects.filter(schedule_id__in=schedule_ids).count(),
        'lesson_progress': ModuleLessonProgress.objects.filter(schedule_id__in=schedule_ids).count(),
        'enrollments': ScheduleStudent.objects.filter(schedule_id__in=schedule_ids).count(),
    }
    subject_ids = SubjectSchedule.objects.filter(id__in=schedule_ids).values_list('subject_id', flat=True)
    blockers = []
    # These older tables do not yet carry a class/term key. Deleting them by user
    # could remove another term, so the system refuses an unsafe purge.
    if ModuleActivitySubmission.objects.filter(
        student_id__in=student_ids,
    ).filter(
        Q(activity__module__subjects__id__in=subject_ids)
        | Q(activity__module__subject_id__in=subject_ids),
    ).exists():
        blockers.append('Unscoped activity submissions must be assigned to a class before term purge.')
    if PointLedger.objects.filter(student_id__in=student_ids).exists():
        blockers.append('Unscoped point-ledger entries must be assigned to a class before term purge.')
    if LegalHold.objects.filter(term=closure.term, released_at__isnull=True).exists():
        blockers.append('An active legal hold prevents this purge.')
    if not closure.dpo_approved_at or not closure.purge_after:
        blockers.append('The school DPO has not approved this term closure.')
    elif closure.purge_after > timezone.now():
        blockers.append('The DPO-approved purge date has not arrived.')
    if PurgeRun.objects.filter(
        closure=closure, mode=PurgeRun.Mode.EXECUTE, result=PurgeRun.Result.COMPLETED,
    ).exists():
        blockers.append('This term has already been purged.')
    return counts, blockers


@transaction.atomic
def execute_retention_purge(closure, actor):
    counts, blockers = retention_preview(closure)
    if blockers:
        raise ValidationError({'blockers': blockers})
    schedule_ids = list(SubjectSchedule.objects.filter(
        school_year_semester=closure.term,
    ).values_list('id', flat=True))

    AttendanceRecord.objects.filter(session__schedule_id__in=schedule_ids).delete()
    StudentGradeItemScore.objects.filter(grade_item__schedule_id__in=schedule_ids).delete()
    StudentCategoryGrade.objects.filter(schedule_id__in=schedule_ids).delete()
    PeriodGrade.objects.filter(schedule_id__in=schedule_ids).delete()
    FinalGrade.objects.filter(schedule_id__in=schedule_ids).delete()
    PublishedStudentGrade.objects.filter(publication__schedule_id__in=schedule_ids).delete()
    GradePublication.objects.filter(schedule_id__in=schedule_ids).delete()
    ModuleActivityAttempt.objects.filter(schedule_id__in=schedule_ids).delete()
    ModuleLessonProgress.objects.filter(schedule_id__in=schedule_ids).delete()
    ModuleTopicProgress.objects.filter(schedule_id__in=schedule_ids).delete()
    ModuleProgress.objects.filter(schedule_id__in=schedule_ids).delete()
    ScheduleStudent.objects.filter(schedule_id__in=schedule_ids).delete()
    cache.clear()
    return PurgeRun.objects.create(
        closure=closure,
        mode=PurgeRun.Mode.EXECUTE,
        result=PurgeRun.Result.COMPLETED,
        actor=actor,
        counts=counts,
        blockers=[],
    )
