from django.db import migrations, models


def delete_coding_points(apps, schema_editor):
    PointLedger = apps.get_model('gamification', 'PointLedger')
    PointLedger.objects.filter(source='CODING').delete()


class Migration(migrations.Migration):
    dependencies = [
        ('gamification', '0002_remove_assessment_point_source'),
    ]

    operations = [
        migrations.RunPython(
            delete_coding_points,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name='pointledger',
            name='source',
            field=models.CharField(
                choices=[
                    ('ATTENDANCE', 'Attendance'),
                    ('MODULE_ACTIVITY', 'Module Activity'),
                    ('MANUAL', 'Manual'),
                ],
                max_length=30,
            ),
        ),
    ]
