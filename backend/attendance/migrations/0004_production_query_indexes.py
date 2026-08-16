from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('attendance', '0003_attendancesession_schedule')]
    operations = [migrations.AddIndex(model_name='attendancesession', index=models.Index(fields=['schedule', 'date'], name='attendance_schedule_date_idx'))]
