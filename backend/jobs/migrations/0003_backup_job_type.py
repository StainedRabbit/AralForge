from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('jobs', '0002_backgroundjob_attempts')]

    operations = [
        migrations.AlterField(
            model_name='backgroundjob',
            name='job_type',
            field=models.CharField(
                choices=[
                    ('GRADE_RECALCULATION', 'Grade recalculation'),
                    ('MODULE_PROGRESS', 'Module progress synchronization'),
                    ('PDF_GENERATION', 'PDF generation'),
                    ('IMPORT', 'Import'),
                    ('EXPORT', 'Export'),
                    ('BACKUP', 'Full database and media backup'),
                ],
                max_length=40,
            ),
        ),
    ]
