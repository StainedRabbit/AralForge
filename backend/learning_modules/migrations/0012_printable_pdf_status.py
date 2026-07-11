# Generated manually for printable PDF generation status.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('learning_modules', '0011_module_lesson_examples'),
    ]

    operations = [
        migrations.AddField(
            model_name='module',
            name='pdf_generated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='module',
            name='pdf_is_outdated',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='pdf_generated_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='pdf_is_outdated',
            field=models.BooleanField(default=True),
        ),
    ]
