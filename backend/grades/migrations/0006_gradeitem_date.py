from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('grades', '0005_reliable_automatic_grading'),
    ]

    operations = [
        migrations.AddField(
            model_name='gradeitem',
            name='date',
            field=models.DateField(blank=True, null=True),
        ),
    ]
