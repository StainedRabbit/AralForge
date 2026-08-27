from datetime import time
from decimal import Decimal

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class RetireDigitalAssessmentsMigrationTests(TransactionTestCase):
    reset_sequences = True

    migrate_from = {
        'assessments': '0004_production_query_indexes',
        'coding': '0003_programmingproblem_topic_lesson',
        'gamification': '0002_remove_assessment_point_source',
        'grades': '0008_rebrand_standard_grading_template',
        'learning_modules': '0020_remove_module_payments',
    }

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        self.latest_targets = executor.loader.graph.leaf_nodes()
        old_targets = [
            (app_label, self.migrate_from.get(app_label, migration_name))
            for app_label, migration_name in self.latest_targets
        ]
        executor.migrate(old_targets)
        self.old_apps = executor.loader.project_state(old_targets).apps

    def tearDown(self):
        MigrationExecutor(connection).migrate(self.latest_targets)
        super().tearDown()

    def test_retirement_deletes_assessment_data_and_recomputes_surviving_grades(self):
        User = self.old_apps.get_model('accounts', 'User')
        Subject = self.old_apps.get_model('subjects', 'Subject')
        SchoolYear = self.old_apps.get_model('subjects', 'SchoolYear')
        Term = self.old_apps.get_model('subjects', 'SchoolYearSemester')
        Schedule = self.old_apps.get_model('subjects', 'SubjectSchedule')
        Enrollment = self.old_apps.get_model('subjects', 'ScheduleStudent')
        Module = self.old_apps.get_model('learning_modules', 'Module')
        Activity = self.old_apps.get_model('learning_modules', 'ModuleActivity')
        Assessment = self.old_apps.get_model('assessments', 'Assessment')
        Question = self.old_apps.get_model('assessments', 'Question')
        Attempt = self.old_apps.get_model('assessments', 'AssessmentAttempt')
        Answer = self.old_apps.get_model('assessments', 'Answer')
        Category = self.old_apps.get_model('grades', 'GradeCategory')
        GradeItem = self.old_apps.get_model('grades', 'GradeItem')
        Score = self.old_apps.get_model('grades', 'StudentGradeItemScore')

        student = User.objects.create(username='migration-student', role='STUDENT')
        subject = Subject.objects.create(code='MIG101', name='Migration Testing')
        school_year = SchoolYear.objects.create(start_year=2026, end_year=2027)
        term = Term.objects.create(school_year=school_year, semester='FIRST')
        schedule = Schedule.objects.create(
            subject=subject,
            school_year_semester=term,
            days='MWF',
            start_time=time(8),
            end_time=time(9),
        )
        Enrollment.objects.create(schedule=schedule, student=student)
        module = Module.objects.create(title='Surviving module', slug='surviving-module', subject=subject)
        activity = Activity.objects.create(
            module=module,
            title='Surviving Main Activity',
            instructions='Complete online.',
            points_possible=Decimal('10.00'),
        )
        assessment = Assessment.objects.create(
            title='Retired quiz',
            kind='QUIZ',
            subject=subject,
            module=module,
            points_possible=Decimal('10.00'),
        )
        question = Question.objects.create(
            assessment=assessment,
            question_type='SHORT_ANSWER',
            prompt='Retired question',
            points=Decimal('10.00'),
        )
        attempt = Attempt.objects.create(assessment=assessment, student=student)
        Answer.objects.create(attempt=attempt, question=question, text_answer='old answer')

        category = Category.objects.create(
            subject=subject,
            grading_period='PRELIM',
            category='QUIZ',
            name='Quizzes',
            weight=Decimal('100.00'),
        )
        manual_item = GradeItem.objects.create(
            schedule=schedule,
            grade_category=category,
            title='Paper quiz',
            points_possible=Decimal('10.00'),
            source_type='MANUAL',
        )
        activity_item = GradeItem.objects.create(
            schedule=schedule,
            grade_category=category,
            title='Surviving Main Activity',
            points_possible=Decimal('10.00'),
            source_type='MODULE_ACTIVITY',
            module_activity=activity,
        )
        assessment_item = GradeItem.objects.create(
            schedule=schedule,
            grade_category=category,
            title='Retired quiz',
            points_possible=Decimal('10.00'),
            source_type='ASSESSMENT',
            assessment=assessment,
        )
        Score.objects.create(grade_item=manual_item, student=student, raw_score=Decimal('8.00'))
        Score.objects.create(grade_item=activity_item, student=student, raw_score=Decimal('9.00'))
        Score.objects.create(grade_item=assessment_item, student=student, raw_score=Decimal('10.00'))

        MigrationExecutor(connection).migrate(self.latest_targets)

        with connection.cursor() as cursor:
            tables = set(connection.introspection.table_names(cursor))
        self.assertFalse(any(table.startswith('assessments_') for table in tables))

        from grades.models import FinalGrade, GradeItem as CurrentGradeItem, PeriodGrade, StudentCategoryGrade
        from learning_modules.models import Module as CurrentModule, ModuleActivity

        self.assertTrue(CurrentModule.objects.filter(pk=module.pk).exists())
        self.assertTrue(ModuleActivity.objects.filter(pk=activity.pk).exists())
        self.assertEqual(
            set(CurrentGradeItem.objects.values_list('title', flat=True)),
            {'Paper quiz', 'Surviving Main Activity'},
        )
        category_grade = StudentCategoryGrade.objects.get(
            schedule_id=schedule.pk,
            student_id=student.pk,
            grade_category_id=category.pk,
        )
        self.assertEqual(category_grade.raw_score, Decimal('17.00'))
        self.assertEqual(category_grade.total_score, Decimal('20.00'))
        self.assertEqual(
            PeriodGrade.objects.get(schedule_id=schedule.pk, student_id=student.pk).raw_score,
            Decimal('94.00'),
        )
        self.assertEqual(
            FinalGrade.objects.get(schedule_id=schedule.pk, student_id=student.pk).prelim_grade,
            Decimal('94.00'),
        )
