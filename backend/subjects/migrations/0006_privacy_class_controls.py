import django.db.models.deletion

from django.conf import settings
from django.db import migrations, models


def backfill_instructors(apps, schema_editor):
    SubjectSchedule = apps.get_model('subjects', 'SubjectSchedule')
    ScheduleInstructor = apps.get_model('subjects', 'ScheduleInstructor')
    assignments = []
    for schedule in SubjectSchedule.objects.select_related('created_by').exclude(created_by=None):
        if schedule.created_by.role == 'TEACHER':
            assignments.append(ScheduleInstructor(
                schedule_id=schedule.id,
                instructor_id=schedule.created_by_id,
                assigned_by_id=schedule.created_by_id,
            ))
    ScheduleInstructor.objects.bulk_create(assignments, ignore_conflicts=True)


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0008_privacy_officer_role'),
        ('subjects', '0005_production_query_indexes'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name='ScheduleInstructor',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('is_active', models.BooleanField(default=True)),
                ('assigned_at', models.DateTimeField(auto_now_add=True)),
                ('deactivated_at', models.DateTimeField(blank=True, null=True)),
                ('assigned_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='created_teaching_assignments', to=settings.AUTH_USER_MODEL)),
                ('instructor', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='teaching_assignments', to=settings.AUTH_USER_MODEL)),
                ('schedule', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='instructors', to='subjects.subjectschedule')),
            ],
        ),
        migrations.CreateModel(
            name='AdultRosterAttestation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('statement_version', models.CharField(default='2026-09-11', max_length=30)),
                ('attested_at', models.DateTimeField(auto_now_add=True)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('revocation_reason', models.CharField(blank=True, max_length=500)),
                ('attested_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='adult_roster_attestations', to=settings.AUTH_USER_MODEL)),
                ('revoked_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='revoked_adult_roster_attestations', to=settings.AUTH_USER_MODEL)),
                ('schedule', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='adult_roster_attestations', to='subjects.subjectschedule')),
            ],
            options={'ordering': ['-attested_at']},
        ),
        migrations.AddConstraint(model_name='scheduleinstructor', constraint=models.UniqueConstraint(fields=('schedule', 'instructor'), name='unique_schedule_instructor')),
        migrations.AddIndex(model_name='scheduleinstructor', index=models.Index(fields=['instructor', 'is_active'], name='instructor_active_idx')),
        migrations.AddConstraint(model_name='adultrosterattestation', constraint=models.UniqueConstraint(condition=models.Q(('revoked_at__isnull', True)), fields=('schedule',), name='unique_active_adult_attestation')),
        migrations.RunPython(backfill_instructors, migrations.RunPython.noop),
    ]
