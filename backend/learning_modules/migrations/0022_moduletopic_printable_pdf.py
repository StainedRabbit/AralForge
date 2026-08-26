from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('learning_modules', '0021_remove_modulelesson_assessment_url'),
    ]

    operations = [
        migrations.AddField(
            model_name='moduletopic',
            name='pdf_file',
            field=models.FileField(blank=True, upload_to='module_topic_pdfs/'),
        ),
        migrations.AddField(
            model_name='moduletopic',
            name='pdf_generated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='moduletopic',
            name='pdf_is_outdated',
            field=models.BooleanField(default=True),
        ),
    ]
