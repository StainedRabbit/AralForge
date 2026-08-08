from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('learning_modules', '0015_remove_legacy_lesson_sections'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='modulelessonexample',
            name='mini_check',
        ),
    ]
