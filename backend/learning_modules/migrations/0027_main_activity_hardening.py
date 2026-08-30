from django.db import migrations, models
from django.db.models import Q
import django.core.validators


def backfill_attempt_state(apps, schema_editor):
    ModuleActivity = apps.get_model('learning_modules', 'ModuleActivity')
    ModuleActivityAttempt = apps.get_model('learning_modules', 'ModuleActivityAttempt')
    ModuleActivityExtension = apps.get_model('learning_modules', 'ModuleActivityExtension')

    for attempt in ModuleActivityAttempt.objects.select_related('activity').iterator():
        ModuleActivityAttempt.objects.filter(pk=attempt.pk).update(
            status='SUBMITTED' if attempt.is_submitted else 'IN_PROGRESS',
            activity_revision=attempt.activity.revision,
            passing_score_snapshot=attempt.activity.passing_score,
        )

    # Older clients could create more than one unfinished attempt. Keep only the
    # newest attempt active in each context so the partial unique constraints can
    # be installed safely without deleting historical drafts.
    seen_contexts = set()
    open_attempts = ModuleActivityAttempt.objects.filter(
        status='IN_PROGRESS',
        submission_method='ONLINE',
    ).order_by(
        'activity_id', 'student_id', 'context_type', 'schedule_id',
        '-attempt_number', '-id',
    )
    for attempt in open_attempts.iterator():
        key = (
            attempt.activity_id,
            attempt.student_id,
            attempt.context_type,
            attempt.schedule_id if attempt.context_type == 'CLASS' else None,
        )
        if key in seen_contexts:
            ModuleActivityAttempt.objects.filter(pk=attempt.pk).update(
                status='SUPERSEDED',
                is_submitted=False,
            )
        else:
            seen_contexts.add(key)

    lesson_activity_ids = ModuleActivity.objects.filter(
        lesson__isnull=False,
    ).values_list('id', flat=True)
    ModuleActivity.objects.filter(id__in=lesson_activity_ids).update(
        opens_at=None,
        due_at=None,
        allow_late_submissions=False,
    )
    ModuleActivityExtension.objects.filter(activity_id__in=lesson_activity_ids).delete()


class Migration(migrations.Migration):
    # PostgreSQL must commit the data cleanup before it can build the partial
    # unique indexes; otherwise deferred foreign-key triggers remain pending.
    atomic = False

    dependencies = [
        ('learning_modules', '0026_learning_contexts'),
    ]

    operations = [
        migrations.AlterField(
            model_name='moduleactivity',
            name='max_attempts',
            field=models.PositiveSmallIntegerField(
                default=3,
                validators=[django.core.validators.MinValueValidator(1)],
            ),
        ),
        migrations.AddField(
            model_name='moduleactivity',
            name='revision',
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name='moduleactivityattempt',
            name='activity_revision',
            field=models.PositiveIntegerField(default=1),
        ),
        migrations.AddField(
            model_name='moduleactivityattempt',
            name='draft_revision',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='moduleactivityattempt',
            name='draft_saved_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='moduleactivityattempt',
            name='passing_score_snapshot',
            field=models.DecimalField(
                blank=True,
                decimal_places=2,
                max_digits=7,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name='moduleactivityattempt',
            name='status',
            field=models.CharField(
                choices=[
                    ('IN_PROGRESS', 'In progress'),
                    ('SUBMITTED', 'Submitted'),
                    ('SUPERSEDED', 'Superseded'),
                ],
                default='IN_PROGRESS',
                max_length=20,
            ),
        ),
        migrations.RunPython(
            backfill_attempt_state,
            migrations.RunPython.noop,
            atomic=True,
        ),
        migrations.AddConstraint(
            model_name='moduleactivityattempt',
            constraint=models.UniqueConstraint(
                condition=Q(
                    context_type='CLASS',
                    submission_method='ONLINE',
                    status='IN_PROGRESS',
                ),
                fields=('activity', 'student', 'schedule'),
                name='unique_open_class_activity_attempt',
            ),
        ),
        migrations.AddConstraint(
            model_name='moduleactivityattempt',
            constraint=models.UniqueConstraint(
                condition=Q(
                    context_type='PERSONAL',
                    submission_method='ONLINE',
                    status='IN_PROGRESS',
                ),
                fields=('activity', 'student'),
                name='unique_open_personal_activity_attempt',
            ),
        ),
    ]
