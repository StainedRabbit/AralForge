from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('assessments', '0005_remove_digital_assessments'),
        ('coding', '0004_remove_assessment_links'),
        ('gamification', '0003_remove_coding_point_source'),
        ('grades', '0010_remove_coding_sources'),
        ('learning_modules', '0024_remove_coding_activities'),
    ]

    operations = [
        migrations.DeleteModel(name='CodeBlankAnswer'),
        migrations.DeleteModel(name='CodeBlank'),
        migrations.DeleteModel(name='CodeSubmission'),
        migrations.DeleteModel(name='TestCase'),
        migrations.DeleteModel(name='ProgrammingProblem'),
    ]
