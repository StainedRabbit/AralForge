from django.db import migrations, models


def delete_coding_grade_data(apps, schema_editor):
    GradeCategory = apps.get_model('grades', 'GradeCategory')
    GradeItem = apps.get_model('grades', 'GradeItem')
    GradingTemplateItem = apps.get_model('grades', 'GradingTemplateItem')
    ModuleActivity = apps.get_model('learning_modules', 'ModuleActivity')
    ScheduleStudent = apps.get_model('subjects', 'ScheduleStudent')
    StudentCategoryGrade = apps.get_model('grades', 'StudentCategoryGrade')
    StudentGradeItemScore = apps.get_model('grades', 'StudentGradeItemScore')

    coding_activity_ids = ModuleActivity.objects.filter(
        models.Q(activity_type__in=['CODE_COMPLETE', 'CODE_FILL_BLANK'])
        | models.Q(programming_problem_id__isnull=False)
    ).values_list('id', flat=True)
    affected_items = GradeItem.objects.filter(
        models.Q(source_type='CODING')
        | models.Q(coding_problem_id__isnull=False)
        | models.Q(module_activity_id__in=coding_activity_ids)
    )

    category_targets = set()
    for item in affected_items.only('id', 'grade_category_id', 'schedule_id'):
        student_ids = set(StudentGradeItemScore.objects.filter(
            grade_item_id=item.id,
        ).values_list('student_id', flat=True))
        if item.schedule_id:
            student_ids.update(ScheduleStudent.objects.filter(
                schedule_id=item.schedule_id,
                is_active=True,
            ).values_list('student_id', flat=True))
        category_targets.update(
            (student_id, item.grade_category_id, item.schedule_id)
            for student_id in student_ids
        )
    affected_items.delete()

    coding_categories = GradeCategory.objects.filter(category='CODING')
    period_targets = set(StudentCategoryGrade.objects.filter(
        grade_category__in=coding_categories,
    ).values_list('student_id', 'subject_id', 'grade_category__grading_period', 'schedule_id'))
    for category in coding_categories.only('subject_id', 'grading_period'):
        enrollments = ScheduleStudent.objects.filter(
            schedule__subject_id=category.subject_id,
            is_active=True,
        ).values_list('student_id', 'schedule_id')
        period_targets.update(
            (student_id, category.subject_id, category.grading_period, schedule_id)
            for student_id, schedule_id in enrollments
        )
    coding_categories.delete()
    GradingTemplateItem.objects.filter(category='CODING').delete()

    # Use the current grade service after destructive cleanup so category,
    # period, and final aggregates reflect only the surviving grade data.
    from accounts.models import User
    from grades.models import GradeCategory as CurrentGradeCategory
    from grades.services import (
        compute_final_grade,
        compute_period_grade,
        recompute_student_category_from_items,
    )
    from subjects.models import Subject, SubjectSchedule

    for student_id, category_id, schedule_id in sorted(
        category_targets,
        key=lambda value: (value[0], value[1], value[2] or 0),
    ):
        student = User.objects.filter(pk=student_id).first()
        category = CurrentGradeCategory.objects.filter(pk=category_id).first()
        schedule = SubjectSchedule.objects.filter(pk=schedule_id).first() if schedule_id else None
        if student and category and (not schedule_id or schedule):
            recompute_student_category_from_items(student, category, schedule)

    for student_id, subject_id, grading_period, schedule_id in sorted(
        period_targets,
        key=lambda value: (value[0], value[1], value[2], value[3] or 0),
    ):
        student = User.objects.filter(pk=student_id).first()
        subject = Subject.objects.filter(pk=subject_id).first()
        schedule = SubjectSchedule.objects.filter(pk=schedule_id).first() if schedule_id else None
        if student and subject and (not schedule_id or schedule):
            compute_period_grade(student, subject, grading_period, schedule)
            compute_final_grade(student, subject, schedule)


class Migration(migrations.Migration):
    atomic = False

    dependencies = [
        ('coding', '0004_remove_assessment_links'),
        ('grades', '0009_remove_assessment_sources'),
        ('learning_modules', '0023_topic_pdf_only'),
    ]

    operations = [
        migrations.RunPython(
            delete_coding_grade_data,
            reverse_code=migrations.RunPython.noop,
            atomic=True,
        ),
        migrations.RemoveField(
            model_name='gradeitem',
            name='coding_problem',
        ),
        migrations.AlterField(
            model_name='gradeitem',
            name='source_type',
            field=models.CharField(
                choices=[
                    ('MANUAL', 'Manual'),
                    ('MODULE_ACTIVITY', 'Module activity'),
                    ('ATTENDANCE', 'Attendance'),
                ],
                default='MANUAL',
                max_length=30,
            ),
        ),
        migrations.AlterField(
            model_name='gradecategory',
            name='category',
            field=models.CharField(
                choices=[
                    ('QUIZ', 'Quiz'),
                    ('EXAM', 'Exam'),
                    ('ACTIVITY', 'Activity'),
                    ('ATTENDANCE', 'Attendance'),
                    ('OTHER', 'Other'),
                ],
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='gradingtemplateitem',
            name='category',
            field=models.CharField(
                choices=[
                    ('QUIZ', 'Quiz'),
                    ('EXAM', 'Exam'),
                    ('ACTIVITY', 'Activity'),
                    ('ATTENDANCE', 'Attendance'),
                    ('OTHER', 'Other'),
                ],
                max_length=20,
            ),
        ),
    ]
