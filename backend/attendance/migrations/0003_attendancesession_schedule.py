import django.db.models.deletion
from django.db import migrations, models
from django.db.models import Q


def link_unambiguous_sessions(apps, schema_editor):
    AttendanceSession = apps.get_model('attendance', 'AttendanceSession')
    SubjectSchedule = apps.get_model('subjects', 'SubjectSchedule')

    for session in AttendanceSession.objects.filter(
        school_year_semester__isnull=False,
    ).iterator():
        schedule_ids = list(
            SubjectSchedule.objects.filter(
                subject_id=session.subject_id,
                school_year_semester_id=session.school_year_semester_id,
            ).values_list('id', flat=True)[:2],
        )
        if len(schedule_ids) == 1:
            session.schedule_id = schedule_ids[0]
            session.save(update_fields=['schedule'])


class Migration(migrations.Migration):
    dependencies = [
        ('attendance', '0002_attendancesession_school_year_semester_and_more'),
        ('subjects', '0003_schedulestudent_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='attendancesession',
            name='schedule',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='attendance_sessions',
                to='subjects.subjectschedule',
            ),
        ),
        migrations.RunPython(link_unambiguous_sessions, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name='attendancesession',
            name='unique_attendance_session_term',
        ),
        migrations.AddConstraint(
            model_name='attendancesession',
            constraint=models.UniqueConstraint(
                condition=Q(schedule__isnull=False),
                fields=('schedule', 'date', 'title'),
                name='unique_attendance_session_schedule',
            ),
        ),
    ]
