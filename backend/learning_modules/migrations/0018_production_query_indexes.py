from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('learning_modules', '0017_moduleactivityattempt_paper_entry')]
    operations = [
        migrations.AddIndex(model_name='moduleactivity', index=models.Index(fields=['module', 'is_published', 'due_at'], name='activity_module_due_idx')),
        migrations.AddIndex(model_name='moduleactivitysubmission', index=models.Index(fields=['student', 'score'], name='submission_student_score_idx')),
    ]
