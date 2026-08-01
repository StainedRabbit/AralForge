from django.db import migrations, models
import django.db.models.deletion
from django.db.models import Q


def backfill_grade_schedules(apps, schema_editor):
    GradeItem = apps.get_model('grades', 'GradeItem')
    StudentCategoryGrade = apps.get_model('grades', 'StudentCategoryGrade')
    PeriodGrade = apps.get_model('grades', 'PeriodGrade')
    FinalGrade = apps.get_model('grades', 'FinalGrade')
    SubjectSchedule = apps.get_model('subjects', 'SubjectSchedule')

    def unique_enrollment_schedule(subject_id, student_id):
        ids = list(
            SubjectSchedule.objects.filter(
                subject_id=subject_id,
                students__student_id=student_id,
            ).values_list('id', flat=True).distinct()[:2]
        )
        return ids[0] if len(ids) == 1 else None

    for item in GradeItem.objects.all().iterator():
        schedule_id = None
        if item.attendance_session_id:
            session = item.attendance_session
            schedule_id = getattr(session, 'schedule_id', None)

        if not schedule_id:
            student_ids = list(item.student_scores.values_list('student_id', flat=True).distinct())
            candidates = SubjectSchedule.objects.filter(subject_id=item.grade_category.subject_id)
            for student_id in student_ids:
                candidates = candidates.filter(students__student_id=student_id)
            candidate_ids = list(candidates.values_list('id', flat=True).distinct()[:2])
            if len(candidate_ids) == 1:
                schedule_id = candidate_ids[0]

        if schedule_id:
            GradeItem.objects.filter(pk=item.pk).update(schedule_id=schedule_id)

    for grade in StudentCategoryGrade.objects.all().iterator():
        linked_ids = list(
            GradeItem.objects.filter(
                grade_category_id=grade.grade_category_id,
                student_scores__student_id=grade.student_id,
                schedule_id__isnull=False,
            ).values_list('schedule_id', flat=True).distinct()[:2]
        )
        schedule_id = linked_ids[0] if len(linked_ids) == 1 else unique_enrollment_schedule(
            grade.subject_id, grade.student_id
        )
        if schedule_id:
            StudentCategoryGrade.objects.filter(pk=grade.pk).update(schedule_id=schedule_id)

    for Model in (PeriodGrade, FinalGrade):
        for grade in Model.objects.all().iterator():
            schedule_id = unique_enrollment_schedule(grade.subject_id, grade.student_id)
            if schedule_id:
                Model.objects.filter(pk=grade.pk).update(schedule_id=schedule_id)


class Migration(migrations.Migration):
    dependencies = [
        ('attendance', '0003_attendancesession_schedule'),
        ('grades', '0003_grade_items'),
        ('subjects', '0003_schedulestudent_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='gradeitem',
            name='schedule',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='grade_items', to='subjects.subjectschedule'),
        ),
        migrations.AddField(
            model_name='studentcategorygrade',
            name='schedule',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='student_category_grades', to='subjects.subjectschedule'),
        ),
        migrations.AddField(
            model_name='periodgrade',
            name='schedule',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='period_grades', to='subjects.subjectschedule'),
        ),
        migrations.AddField(
            model_name='finalgrade',
            name='schedule',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='final_grades', to='subjects.subjectschedule'),
        ),
        migrations.RunPython(backfill_grade_schedules, migrations.RunPython.noop),
        migrations.RemoveConstraint(model_name='studentcategorygrade', name='unique_student_category_grade'),
        migrations.RemoveConstraint(model_name='periodgrade', name='unique_period_grade_per_subject_student'),
        migrations.RemoveConstraint(model_name='finalgrade', name='unique_final_grade_per_subject_student'),
        migrations.AddConstraint(
            model_name='studentcategorygrade',
            constraint=models.UniqueConstraint(fields=('schedule', 'student', 'grade_category'), condition=Q(schedule__isnull=False), name='unique_schedule_student_category_grade'),
        ),
        migrations.AddConstraint(
            model_name='periodgrade',
            constraint=models.UniqueConstraint(fields=('schedule', 'student', 'grading_period'), condition=Q(schedule__isnull=False), name='unique_period_grade_per_schedule_student'),
        ),
        migrations.AddConstraint(
            model_name='finalgrade',
            constraint=models.UniqueConstraint(fields=('schedule', 'student'), condition=Q(schedule__isnull=False), name='unique_final_grade_per_schedule_student'),
        ),
    ]
