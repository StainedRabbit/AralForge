from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('assessments', '0003_module_topic_mock_exam_links')]
    operations = [migrations.AddIndex(model_name='assessmentattempt', index=models.Index(fields=['student', 'assessment', 'is_submitted'], name='attempt_student_state_idx'))]
