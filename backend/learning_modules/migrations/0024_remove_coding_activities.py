from django.db import migrations, models


def delete_coding_activities(apps, schema_editor):
    ModuleActivity = apps.get_model('learning_modules', 'ModuleActivity')
    ModuleActivity.objects.filter(
        models.Q(activity_type__in=['CODE_COMPLETE', 'CODE_FILL_BLANK'])
        | models.Q(programming_problem_id__isnull=False)
    ).delete()


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ('grades', '0010_remove_coding_sources'),
        ('learning_modules', '0023_topic_pdf_only'),
    ]

    operations = [
        migrations.RunPython(
            delete_coding_activities,
            reverse_code=migrations.RunPython.noop,
            atomic=True,
        ),
        migrations.RemoveField(
            model_name='moduleactivity',
            name='programming_problem',
        ),
        migrations.RemoveField(
            model_name='moduleactivity',
            name='accepts_code',
        ),
        migrations.RemoveField(
            model_name='moduleactivitysubmission',
            name='code',
        ),
        migrations.AlterField(
            model_name='moduleactivity',
            name='activity_type',
            field=models.CharField(
                choices=[
                    ('TEXT', 'Text'),
                    ('FILE_UPLOAD', 'File Upload'),
                    ('INTERACTIVE', 'Interactive'),
                ],
                default='TEXT',
                max_length=30,
            ),
        ),
    ]
