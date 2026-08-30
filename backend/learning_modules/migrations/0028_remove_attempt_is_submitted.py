from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('learning_modules', '0027_main_activity_hardening'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='moduleactivityattempt',
            name='is_submitted',
        ),
    ]
