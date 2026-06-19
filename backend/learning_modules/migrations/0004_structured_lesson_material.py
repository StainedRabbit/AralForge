# Generated manually for structured lesson material fields.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('learning_modules', '0003_module_is_paid_module_price_moduleaccess'),
    ]

    operations = [
        migrations.AddField(
            model_name='module',
            name='learning_objectives',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='module',
            name='lesson_overview',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='module',
            name='detailed_discussion',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='module',
            name='examples',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='module',
            name='teacher_notes',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='module',
            name='student_activities',
            field=models.TextField(blank=True),
        ),
        migrations.AddField(
            model_name='module',
            name='resources',
            field=models.TextField(blank=True),
        ),
    ]
