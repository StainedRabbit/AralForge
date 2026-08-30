from django.db import migrations, models


def infer_linked_activity_periods(apps, schema_editor):
    GradeItem = apps.get_model('grades', 'GradeItem')
    ModuleActivity = apps.get_model('learning_modules', 'ModuleActivity')

    for activity_id in ModuleActivity.objects.values_list('id', flat=True).iterator():
        periods = list(
            GradeItem.objects.filter(
                module_activity_id=activity_id,
                schedule_id__isnull=False,
            ).values_list('grade_category__grading_period', flat=True).distinct()[:2]
        )
        if len(periods) == 1:
            ModuleActivity.objects.filter(pk=activity_id).update(grading_period=periods[0])


class Migration(migrations.Migration):
    dependencies = [
        ('grades', '0010_remove_coding_sources'),
        ('learning_modules', '0024_remove_coding_activities'),
    ]

    operations = [
        migrations.AddField(
            model_name='moduleactivity',
            name='grading_period',
            field=models.CharField(
                blank=True,
                choices=[
                    ('PRELIM', 'Prelim'),
                    ('MIDTERM', 'Midterm'),
                    ('PREFINAL', 'Prefinal'),
                    ('FINAL', 'Final'),
                ],
                max_length=20,
                null=True,
            ),
        ),
        migrations.RunPython(
            infer_linked_activity_periods,
            reverse_code=migrations.RunPython.noop,
        ),
    ]
