from django.db import migrations, models


def delete_assessment_grade_items(apps, schema_editor):
    GradeItem = apps.get_model('grades', 'GradeItem')
    StudentGradeItemScore = apps.get_model('grades', 'StudentGradeItemScore')
    ScheduleStudent = apps.get_model('subjects', 'ScheduleStudent')

    affected_items = GradeItem.objects.filter(
        models.Q(source_type='ASSESSMENT') | models.Q(assessment_id__isnull=False)
    )
    targets = set()
    for item in affected_items.only('id', 'grade_category_id', 'schedule_id'):
        student_ids = set(StudentGradeItemScore.objects.filter(
            grade_item_id=item.id,
        ).values_list('student_id', flat=True))
        if item.schedule_id:
            student_ids.update(ScheduleStudent.objects.filter(
                schedule_id=item.schedule_id,
                is_active=True,
            ).values_list('student_id', flat=True))
        targets.update(
            (student_id, item.grade_category_id, item.schedule_id)
            for student_id in student_ids
        )

    affected_items.delete()

    # Recalculate with the surviving grade items only. Importing the current
    # service here is intentional: it owns category, period, and final-grade
    # consistency, while the IDs above were gathered from the historical state.
    from accounts.models import User
    from grades.models import GradeCategory
    from grades.services import recompute_student_category_from_items
    from subjects.models import SubjectSchedule

    for student_id, category_id, schedule_id in sorted(
        targets,
        key=lambda value: (value[0], value[1], value[2] or 0),
    ):
        student = User.objects.filter(pk=student_id).first()
        category = GradeCategory.objects.filter(pk=category_id).first()
        schedule = (
            SubjectSchedule.objects.filter(pk=schedule_id).first()
            if schedule_id else None
        )
        if student and category and (not schedule_id or schedule):
            recompute_student_category_from_items(student, category, schedule)


class Migration(migrations.Migration):
    # PostgreSQL must commit the destructive data cleanup before the assessment
    # foreign key can be removed from GradeItem.
    atomic = False

    dependencies = [
        ('assessments', '0004_production_query_indexes'),
        ('grades', '0008_rebrand_standard_grading_template'),
    ]

    operations = [
        migrations.RunPython(
            delete_assessment_grade_items,
            reverse_code=migrations.RunPython.noop,
            atomic=True,
        ),
        migrations.RemoveField(
            model_name='gradeitem',
            name='assessment',
        ),
        migrations.AlterField(
            model_name='gradeitem',
            name='source_type',
            field=models.CharField(
                choices=[
                    ('MANUAL', 'Manual'),
                    ('MODULE_ACTIVITY', 'Module activity'),
                    ('ATTENDANCE', 'Attendance'),
                    ('CODING', 'Coding'),
                ],
                default='MANUAL',
                max_length=30,
            ),
        ),
    ]
