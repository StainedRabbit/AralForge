from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('subjects', '0004_class_archival_and_audit')]
    operations = [
        migrations.AddIndex(model_name='subjectschedule', index=models.Index(fields=['school_year_semester', 'is_active'], name='schedule_term_active_idx')),
        migrations.AddIndex(model_name='schedulestudent', index=models.Index(fields=['schedule', 'is_active'], name='enroll_schedule_active_idx')),
        migrations.AddIndex(model_name='schedulestudent', index=models.Index(fields=['student', 'is_active'], name='enroll_student_active_idx')),
    ]
