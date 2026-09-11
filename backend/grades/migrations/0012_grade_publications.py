import django.db.models.deletion

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('grades', '0011_grade_list_indexes'),
        ('subjects', '0006_privacy_class_controls'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name='GradePublication',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('period', models.CharField(choices=[('PRELIM', 'Prelim'), ('MIDTERM', 'Midterm'), ('PREFINAL', 'Prefinal'), ('FINAL', 'Final period'), ('OVERALL', 'Final course grade')], max_length=20)),
                ('revision', models.PositiveIntegerField()),
                ('publication_note', models.CharField(blank=True, max_length=500)),
                ('published_at', models.DateTimeField(auto_now_add=True)),
                ('withdrawn_at', models.DateTimeField(blank=True, null=True)),
                ('withdrawal_reason', models.CharField(blank=True, max_length=500)),
                ('published_by', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='published_grade_revisions', to=settings.AUTH_USER_MODEL)),
                ('schedule', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='grade_publications', to='subjects.subjectschedule')),
                ('withdrawn_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='withdrawn_grade_revisions', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['schedule', 'period', '-revision']},
        ),
        migrations.CreateModel(
            name='PublishedStudentGrade',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('snapshot', models.JSONField()),
                ('snapshot_sha256', models.CharField(max_length=64)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('publication', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='student_snapshots', to='grades.gradepublication')),
                ('student', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='published_grade_snapshots', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['publication', 'student']},
        ),
        migrations.AddConstraint(model_name='gradepublication', constraint=models.UniqueConstraint(fields=('schedule', 'period', 'revision'), name='unique_grade_publication_revision')),
        migrations.AddConstraint(model_name='gradepublication', constraint=models.UniqueConstraint(condition=models.Q(('withdrawn_at__isnull', True)), fields=('schedule', 'period'), name='unique_active_grade_publication')),
        migrations.AddIndex(model_name='gradepublication', index=models.Index(fields=['schedule', 'period', 'withdrawn_at'], name='grade_publication_active_idx')),
        migrations.AddConstraint(model_name='publishedstudentgrade', constraint=models.UniqueConstraint(fields=('publication', 'student'), name='unique_published_student_grade')),
    ]
