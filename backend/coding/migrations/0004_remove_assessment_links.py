from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('assessments', '0004_production_query_indexes'),
        ('coding', '0003_programmingproblem_topic_lesson'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='programmingproblem',
            name='assessment_question',
        ),
        migrations.RemoveField(
            model_name='codesubmission',
            name='assessment_attempt',
        ),
    ]
