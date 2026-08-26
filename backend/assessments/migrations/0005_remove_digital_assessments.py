from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('assessments', '0004_production_query_indexes'),
        ('coding', '0004_remove_assessment_links'),
        ('grades', '0009_remove_assessment_sources'),
        ('learning_modules', '0021_remove_modulelesson_assessment_url'),
    ]

    operations = [
        migrations.DeleteModel(name='Answer'),
        migrations.DeleteModel(name='AssessmentAttemptQuestion'),
        migrations.DeleteModel(name='Choice'),
        migrations.DeleteModel(name='Question'),
        migrations.DeleteModel(name='AssessmentAttempt'),
        migrations.DeleteModel(name='Assessment'),
    ]
