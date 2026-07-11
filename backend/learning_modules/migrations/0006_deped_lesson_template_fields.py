# Generated manually for DepEd-style lesson template fields.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('learning_modules', '0005_subject_module_topics_lessons'),
    ]

    operations = [
        migrations.AddField(
            model_name='modulelesson',
            name='learning_targets',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='key_terms',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='before_you_start',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='short_discussion',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='guided_examples',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='lets_practice',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='apply_what_you_learned',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='challenge_task',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='rubric',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='modulelesson',
            name='reflection',
            field=models.TextField(blank=True),
        ),
    ]
