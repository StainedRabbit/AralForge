import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.db.models import Q


def matching_schedule_id(ScheduleStudent, student_id, subject_ids, timestamp):
    if not subject_ids or not timestamp:
        return None
    candidates = list(
        ScheduleStudent.objects.filter(
            student_id=student_id,
            schedule__subject_id__in=subject_ids,
            added_at__lte=timestamp,
            schedule__created_at__lte=timestamp,
        ).filter(
            Q(deactivated_at__isnull=True) | Q(deactivated_at__gte=timestamp),
        ).filter(
            Q(schedule__archived_at__isnull=True)
            | Q(schedule__archived_at__gte=timestamp),
        ).values_list('schedule_id', flat=True).distinct()[:2]
    )
    return candidates[0] if len(candidates) == 1 else None


def infer_learning_contexts(apps, schema_editor):
    Module = apps.get_model('learning_modules', 'Module')
    ModuleActivityAttempt = apps.get_model('learning_modules', 'ModuleActivityAttempt')
    ModuleLessonProgress = apps.get_model('learning_modules', 'ModuleLessonProgress')
    ModuleProgress = apps.get_model('learning_modules', 'ModuleProgress')
    ModuleTopicProgress = apps.get_model('learning_modules', 'ModuleTopicProgress')
    ScheduleStudent = apps.get_model('subjects', 'ScheduleStudent')

    subject_cache = {}

    def subject_ids(module_id):
        if module_id not in subject_cache:
            module = Module.objects.get(pk=module_id)
            values = set(module.subjects.values_list('id', flat=True))
            if module.subject_id:
                values.add(module.subject_id)
            subject_cache[module_id] = values
        return subject_cache[module_id]

    attempts = ModuleActivityAttempt.objects.select_related(
        'activity', 'paper_grade_item',
    ).all()
    for attempt in attempts.iterator():
        schedule_id = (
            attempt.paper_grade_item.schedule_id
            if attempt.paper_grade_item_id and attempt.paper_grade_item.schedule_id
            else matching_schedule_id(
                ScheduleStudent,
                attempt.student_id,
                subject_ids(attempt.activity.module_id),
                attempt.started_at,
            )
        )
        if schedule_id:
            ModuleActivityAttempt.objects.filter(pk=attempt.pk).update(
                context_type='CLASS', schedule_id=schedule_id,
            )

    progress_models = (
        (ModuleLessonProgress, lambda row: row.lesson.topic.module_id),
        (ModuleTopicProgress, lambda row: row.topic.module_id),
        (ModuleProgress, lambda row: row.module_id),
    )
    for ProgressModel, module_id_for in progress_models:
        queryset = ProgressModel.objects.all()
        if ProgressModel is ModuleLessonProgress:
            queryset = queryset.select_related('lesson__topic')
        elif ProgressModel is ModuleTopicProgress:
            queryset = queryset.select_related('topic')
        for row in queryset.iterator():
            module_id = module_id_for(row)
            schedule_id = matching_schedule_id(
                ScheduleStudent,
                row.student_id,
                subject_ids(module_id),
                row.started_at,
            )
            if schedule_id:
                ProgressModel.objects.filter(pk=row.pk).update(
                    context_type='CLASS', schedule_id=schedule_id,
                )


def add_context_fields(model_name, related_name):
    return [
        migrations.AddField(
            model_name=model_name,
            name='context_type',
            field=models.CharField(
                choices=[
                    ('CLASS', 'Class'),
                    ('PERSONAL', 'Personal study'),
                    ('LEGACY', 'Legacy history'),
                ],
                default='LEGACY',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name=model_name,
            name='schedule',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name=related_name,
                to='subjects.subjectschedule',
            ),
        ),
    ]


def add_progress_constraints(model_name, entity_field, prefix):
    return [
        migrations.AddConstraint(
            model_name=model_name,
            constraint=models.UniqueConstraint(
                condition=Q(context_type='CLASS'),
                fields=(entity_field, 'student', 'schedule'),
                name=f'unique_class_{prefix}_progress',
            ),
        ),
        migrations.AddConstraint(
            model_name=model_name,
            constraint=models.UniqueConstraint(
                condition=Q(context_type='PERSONAL'),
                fields=(entity_field, 'student'),
                name=f'unique_personal_{prefix}_progress',
            ),
        ),
        migrations.AddConstraint(
            model_name=model_name,
            constraint=models.UniqueConstraint(
                condition=Q(context_type='LEGACY'),
                fields=(entity_field, 'student'),
                name=f'unique_legacy_{prefix}_progress',
            ),
        ),
        migrations.AddConstraint(
            model_name=model_name,
            constraint=models.CheckConstraint(
                condition=(
                    Q(context_type='CLASS', schedule__isnull=False)
                    | Q(context_type__in=('PERSONAL', 'LEGACY'), schedule__isnull=True)
                ),
                name=f'{prefix}_progress_valid_learning_context',
            ),
        ),
    ]


class Migration(migrations.Migration):
    dependencies = [
        ('grades', '0011_grade_list_indexes'),
        ('learning_modules', '0025_moduleactivity_grading_period'),
        ('subjects', '0005_production_query_indexes'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name='moduleactivityattempt',
            name='unique_module_activity_attempt_number',
        ),
        migrations.RemoveConstraint(
            model_name='modulelessonprogress',
            name='unique_module_lesson_progress',
        ),
        migrations.RemoveConstraint(
            model_name='moduleprogress',
            name='unique_module_progress',
        ),
        migrations.RemoveConstraint(
            model_name='moduletopicprogress',
            name='unique_module_topic_progress',
        ),
        *add_context_fields('moduleactivityattempt', 'module_activity_attempts'),
        *add_context_fields('modulelessonprogress', 'module_lesson_progress'),
        *add_context_fields('moduleprogress', 'module_progress'),
        *add_context_fields('moduletopicprogress', 'module_topic_progress'),
        migrations.RunPython(
            infer_learning_contexts,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AddConstraint(
            model_name='moduleactivityattempt',
            constraint=models.UniqueConstraint(
                condition=Q(context_type='CLASS'),
                fields=('activity', 'student', 'schedule', 'attempt_number'),
                name='unique_class_activity_attempt_number',
            ),
        ),
        migrations.AddConstraint(
            model_name='moduleactivityattempt',
            constraint=models.UniqueConstraint(
                condition=Q(context_type='PERSONAL'),
                fields=('activity', 'student', 'attempt_number'),
                name='unique_personal_activity_attempt_number',
            ),
        ),
        migrations.AddConstraint(
            model_name='moduleactivityattempt',
            constraint=models.UniqueConstraint(
                condition=Q(context_type='LEGACY'),
                fields=('activity', 'student', 'attempt_number'),
                name='unique_legacy_activity_attempt_number',
            ),
        ),
        migrations.AddConstraint(
            model_name='moduleactivityattempt',
            constraint=models.CheckConstraint(
                condition=(
                    Q(context_type='CLASS', schedule__isnull=False)
                    | Q(context_type__in=('PERSONAL', 'LEGACY'), schedule__isnull=True)
                ),
                name='activity_attempt_valid_learning_context',
            ),
        ),
        *add_progress_constraints('modulelessonprogress', 'lesson', 'lesson'),
        *add_progress_constraints('moduleprogress', 'module', 'module'),
        *add_progress_constraints('moduletopicprogress', 'topic', 'topic'),
    ]
