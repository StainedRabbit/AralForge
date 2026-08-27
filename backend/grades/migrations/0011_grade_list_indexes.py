from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('grades', '0010_remove_coding_sources')]

    operations = [
        migrations.AddIndex(
            model_name='studentcategorygrade',
            index=models.Index(fields=['schedule', 'completion_status'], name='catgrade_sched_status_idx'),
        ),
        migrations.AddIndex(
            model_name='periodgrade',
            index=models.Index(
                fields=['schedule', 'grading_period', 'completion_status'],
                name='period_sched_state_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='finalgrade',
            index=models.Index(fields=['schedule', 'completion_status'], name='final_sched_status_idx'),
        ),
    ]
