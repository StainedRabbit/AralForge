from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('learning_modules', '0020_remove_module_payments'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='modulelesson',
            name='assessment_url',
        ),
    ]
