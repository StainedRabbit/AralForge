# Generated manually for solo-teacher lesson guide fields.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('learning_modules', '0006_deped_lesson_template_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='modulelesson',
            name='answer_key',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='expected_outputs',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='common_misconceptions',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='teaching_tips',
            field=models.TextField(blank=True),
        ),
    ]
