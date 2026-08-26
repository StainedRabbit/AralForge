from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('gamification', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='pointledger',
            name='source',
            field=models.CharField(
                choices=[
                    ('ATTENDANCE', 'Attendance'),
                    ('MODULE_ACTIVITY', 'Module Activity'),
                    ('CODING', 'Coding'),
                    ('MANUAL', 'Manual'),
                ],
                max_length=30,
            ),
        ),
    ]
