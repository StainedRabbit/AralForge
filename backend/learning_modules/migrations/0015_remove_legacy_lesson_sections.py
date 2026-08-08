from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('learning_modules', '0014_module_lesson_assets'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='modulelesson',
            name='apply_what_you_learned',
        ),
        migrations.RemoveField(
            model_name='modulelesson',
            name='evidence_of_learning',
        ),
        migrations.RemoveField(
            model_name='modulelesson',
            name='key_terms',
        ),
        migrations.RemoveField(
            model_name='modulelesson',
            name='reflection',
        ),
        migrations.RemoveField(
            model_name='modulelesson',
            name='rubric',
        ),
    ]
