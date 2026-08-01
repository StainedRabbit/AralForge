from django.db.models.signals import post_delete, post_save, pre_delete
from django.dispatch import receiver

from assessments.models import Answer, Assessment, AssessmentAttempt
from attendance.models import AttendanceRecord, AttendanceSession
from coding.models import CodeSubmission, ProgrammingProblem
from learning_modules.models import (
    ModuleActivity, ModuleActivityAttempt, ModuleActivitySubmission,
)
from subjects.models import ScheduleStudent, Subject

from .models import GradeCategory, GradeItem, GradeItemSourceType, GradingTemplate, SubjectGradingPolicy
from .source_sync import clear_automatic_scores, sync_items


@receiver(post_save, sender=Subject)
def apply_default_grading_template(sender, instance, created, **kwargs):
    if not created:
        return

    template = GradingTemplate.objects.filter(is_default=True).first()

    if template:
        template.apply_to_subject(instance)
    else:
        SubjectGradingPolicy.objects.get_or_create(subject=instance)


def recompute_subject_students(subject):
    from .services import recompute_all_for_student

    for schedule in subject.schedules.all():
        for enrollment in schedule.students.filter(is_active=True).select_related('student'):
            recompute_all_for_student(enrollment.student, schedule)


@receiver(post_save, sender=SubjectGradingPolicy)
def recompute_after_policy_change(sender, instance, **kwargs):
    recompute_subject_students(instance.subject)


@receiver(post_save, sender=GradeCategory)
def recompute_after_category_change(sender, instance, **kwargs):
    recompute_subject_students(instance.subject)


@receiver(post_save, sender=ScheduleStudent)
def initialize_enrollment_grades(sender, instance, **kwargs):
    if not instance.is_active:
        return
    from .services import recompute_all_for_student
    from .source_sync import sync_grade_item

    for item in instance.schedule.grade_items.exclude(source_type=GradeItemSourceType.MANUAL):
        sync_grade_item(item)
    recompute_all_for_student(instance.student, instance.schedule)


def _items_for_source(source_type, field, source_id):
    return GradeItem.objects.filter(source_type=source_type, **{field: source_id})


@receiver(post_save, sender=AssessmentAttempt)
@receiver(post_delete, sender=AssessmentAttempt)
@receiver(post_save, sender=Answer)
@receiver(post_delete, sender=Answer)
def sync_assessment_scores(sender, instance, **kwargs):
    assessment_id = instance.assessment_id if sender is AssessmentAttempt else instance.attempt.assessment_id
    sync_items(_items_for_source(GradeItemSourceType.ASSESSMENT, 'assessment_id', assessment_id))


@receiver(post_save, sender=ModuleActivityAttempt)
@receiver(post_delete, sender=ModuleActivityAttempt)
def sync_interactive_activity_scores(sender, instance, **kwargs):
    sync_items(_items_for_source(GradeItemSourceType.MODULE_ACTIVITY, 'module_activity_id', instance.activity_id))


@receiver(post_save, sender=ModuleActivitySubmission)
@receiver(post_delete, sender=ModuleActivitySubmission)
def sync_manual_activity_scores(sender, instance, **kwargs):
    sync_items(_items_for_source(GradeItemSourceType.MODULE_ACTIVITY, 'module_activity_id', instance.activity_id))


@receiver(post_save, sender=AttendanceRecord)
@receiver(post_delete, sender=AttendanceRecord)
def sync_attendance_scores(sender, instance, **kwargs):
    sync_items(_items_for_source(GradeItemSourceType.ATTENDANCE, 'attendance_session_id', instance.session_id))


@receiver(post_save, sender=CodeSubmission)
@receiver(post_delete, sender=CodeSubmission)
def sync_coding_scores(sender, instance, **kwargs):
    sync_items(_items_for_source(GradeItemSourceType.CODING, 'coding_problem_id', instance.problem_id))


SOURCE_MODELS = {
    Assessment: (GradeItemSourceType.ASSESSMENT, 'assessment_id'),
    ModuleActivity: (GradeItemSourceType.MODULE_ACTIVITY, 'module_activity_id'),
    AttendanceSession: (GradeItemSourceType.ATTENDANCE, 'attendance_session_id'),
    ProgrammingProblem: (GradeItemSourceType.CODING, 'coding_problem_id'),
}


@receiver(post_save, sender=Assessment)
@receiver(post_save, sender=ModuleActivity)
@receiver(post_save, sender=AttendanceSession)
@receiver(post_save, sender=ProgrammingProblem)
def sync_source_metadata(sender, instance, **kwargs):
    source_type, field = SOURCE_MODELS[sender]
    items = _items_for_source(source_type, field, instance.pk)
    title = str(getattr(instance, 'title', '') or getattr(instance, 'date', ''))
    items.update(title=title, points_possible=instance.points_possible)
    items = _items_for_source(source_type, field, instance.pk)
    sync_items(items)
    from .services import recompute_student_category_from_items

    for item in items.select_related('schedule', 'grade_category'):
        if not item.schedule_id:
            continue
        for enrollment in item.schedule.students.filter(is_active=True).select_related('student'):
            recompute_student_category_from_items(
                enrollment.student, item.grade_category, item.schedule
            )


@receiver(pre_delete, sender=Assessment)
@receiver(pre_delete, sender=ModuleActivity)
@receiver(pre_delete, sender=AttendanceSession)
@receiver(pre_delete, sender=ProgrammingProblem)
def clear_deleted_source_scores(sender, instance, **kwargs):
    source_type, field = SOURCE_MODELS[sender]
    clear_automatic_scores(list(_items_for_source(source_type, field, instance.pk)))
