from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [('learning_modules', '0028_remove_attempt_is_submitted')]

    operations = [
        migrations.AddIndex(
            model_name='moduleaccess',
            index=models.Index(
                fields=['student', 'module', 'expires_at'],
                condition=Q(is_active=True, activated_by__isnull=False),
                name='modaccess_active_student_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='moduleactivityattempt',
            index=models.Index(
                fields=['activity', 'schedule', 'student'],
                condition=Q(context_type='CLASS', submission_method='ONLINE', status='SUBMITTED'),
                name='attempt_submitted_class_idx',
            ),
        ),
    ]
