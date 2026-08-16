from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('grades', '0006_gradeitem_date')]
    operations = [migrations.AddIndex(model_name='gradeitem', index=models.Index(fields=['schedule', 'date'], name='gradeitem_schedule_date_idx'))]
