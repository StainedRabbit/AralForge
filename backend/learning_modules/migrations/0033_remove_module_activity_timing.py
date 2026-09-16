from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('learning_modules', '0032_rename_default_main_activity_titles'),
    ]

    operations = [
        migrations.RemoveIndex(
            model_name='moduleactivity',
            name='activity_module_due_idx',
        ),
        migrations.RemoveField(
            model_name='moduleactivity',
            name='allow_late_submissions',
        ),
        migrations.RemoveField(
            model_name='moduleactivity',
            name='due_at',
        ),
        migrations.RemoveField(
            model_name='moduleactivity',
            name='opens_at',
        ),
        migrations.DeleteModel(
            name='ModuleActivityExtension',
        ),
    ]
