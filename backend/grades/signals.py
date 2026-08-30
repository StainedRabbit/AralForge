from django.db.models.signals import post_delete, post_save, pre_delete
from django.dispatch import receiver

from attendance.models import AttendanceRecord, AttendanceSession
from learning_modules.models import (
    ModuleActivity, ModuleActivityAttempt, ModuleActivitySubmission,
)
from subjects.models import ScheduleStudent, Subject

from .models import GradeCategory, GradeItem, GradeItemSourceType, GradingTemplate, SubjectGradingPolicy
from .source_sync import clear_automatic_scores, sync_activity_attempt_target, sync_items


@receiver(post_save, sender=Subject)
def apply_default_grading_template(sender, instance, created, **kwargs):
    if not created:
        return

    template = GradingTemplate.objects.filter(is_default=True).first()

    if template:
        template.apply_to_subject(instance)
    else:
        SubjectGradingPolicy.objects.get_or_create(subject=instance)


RECOMPUTE_INLINE_LIMIT = 250


def recompute_subject_students_now(subject, job=None):
    from .services import recompute_all_for_student

    processed = 0
    schedules = subject.schedules.all().prefetch_related('grade_items__grade_category')
    for schedule in schedules:
        enrollments = schedule.students.filter(is_active=True).select_related('student').iterator(chunk_size=200)
        for enrollment in enrollments:
            recompute_all_for_student(enrollment.student, schedule)
            processed += 1
            if job and processed % 100 == 0:
                job.progress = processed
                job.save(update_fields=('progress',))
    return processed


def recompute_subject_students(subject):
    enrollment_count = ScheduleStudent.objects.filter(
        schedule__subject=subject,
        schedule__is_active=True,
        is_active=True,
    ).count()
    if enrollment_count <= RECOMPUTE_INLINE_LIMIT:
        return recompute_subject_students_now(subject)

    from jobs.models import BackgroundJob
    from jobs.tasks import enqueue, recalculate_subject_grades

    return enqueue(
        recalculate_subject_grades,
        job_type=BackgroundJob.Type.GRADE_RECALCULATION,
        payload={'subject_id': subject.id},
        total=enrollment_count,
        idempotency_key=f'grade-recalculation:subject:{subject.id}',
    )


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


@receiver(post_save, sender=ModuleActivityAttempt)
@receiver(post_delete, sender=ModuleActivityAttempt)
def sync_interactive_activity_scores(sender, instance, update_fields=None, **kwargs):
    grading_fields = {'score', 'max_score', 'submitted_at', 'status'}
    if update_fields is not None and not grading_fields.intersection(update_fields):
        return
    if instance.status != ModuleActivityAttempt.Status.SUBMITTED:
        return
    sync_activity_attempt_target(instance)


@receiver(post_save, sender=ModuleActivitySubmission)
@receiver(post_delete, sender=ModuleActivitySubmission)
def sync_manual_activity_scores(sender, instance, **kwargs):
    sync_items(_items_for_source(GradeItemSourceType.MODULE_ACTIVITY, 'module_activity_id', instance.activity_id))


@receiver(post_save, sender=AttendanceRecord)
@receiver(post_delete, sender=AttendanceRecord)
def sync_attendance_scores(sender, instance, **kwargs):
    sync_items(_items_for_source(GradeItemSourceType.ATTENDANCE, 'attendance_session_id', instance.session_id))


SOURCE_MODELS = {
    ModuleActivity: (GradeItemSourceType.MODULE_ACTIVITY, 'module_activity_id'),
    AttendanceSession: (GradeItemSourceType.ATTENDANCE, 'attendance_session_id'),
}


@receiver(post_save, sender=ModuleActivity)
@receiver(post_save, sender=AttendanceSession)
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


@receiver(pre_delete, sender=ModuleActivity)
@receiver(pre_delete, sender=AttendanceSession)
def clear_deleted_source_scores(sender, instance, **kwargs):
    source_type, field = SOURCE_MODELS[sender]
    clear_automatic_scores(list(_items_for_source(source_type, field, instance.pk)))
