from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('learning_modules', '0033_remove_module_activity_timing'),
    ]

    operations = [
        migrations.AddField(
            model_name='modulelesson',
            name='grading_period',
            field=models.CharField(
                blank=True,
                choices=[
                    ('PRELIM', 'Prelim'),
                    ('MIDTERM', 'Midterm'),
                    ('PREFINAL', 'Prefinal'),
                    ('FINAL', 'Final'),
                ],
                max_length=20,
                null=True,
            ),
        ),
    ]
