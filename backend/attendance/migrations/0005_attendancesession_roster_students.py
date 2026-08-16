from django.conf import settings
from django.db import migrations, models


def snapshot_existing_rosters(apps, schema_editor):
    AttendanceRecord = apps.get_model('attendance', 'AttendanceRecord')
    AttendanceSession = apps.get_model('attendance', 'AttendanceSession')
    ScheduleStudent = apps.get_model('subjects', 'ScheduleStudent')

    for session in AttendanceSession.objects.iterator():
        student_ids = set(
            AttendanceRecord.objects.filter(session_id=session.id).values_list('student_id', flat=True),
        )
        if session.schedule_id:
            student_ids.update(
                ScheduleStudent.objects.filter(
                    schedule_id=session.schedule_id,
                    is_active=True,
                ).values_list('student_id', flat=True),
            )
        session.roster_students.set(student_ids)


class Migration(migrations.Migration):
    dependencies = [
        ('attendance', '0004_production_query_indexes'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='attendancesession',
            name='roster_students',
            field=models.ManyToManyField(
                blank=True,
                related_name='attendance_session_rosters',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.RunPython(snapshot_existing_rosters, migrations.RunPython.noop),
    ]
