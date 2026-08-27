from datetime import time
from decimal import Decimal

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase


class RemoveCodingFeatureMigrationTests(TransactionTestCase):
    reset_sequences = True

    migrate_from = {
        'coding': '0004_remove_assessment_links',
        'gamification': '0002_remove_assessment_point_source',
        'grades': '0009_remove_assessment_sources',
        'learning_modules': '0023_topic_pdf_only',
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

    def test_removal_deletes_coding_data_and_recomputes_grades(self):
        User = self.old_apps.get_model('accounts', 'User')
        Subject = self.old_apps.get_model('subjects', 'Subject')
        SchoolYear = self.old_apps.get_model('subjects', 'SchoolYear')
        Term = self.old_apps.get_model('subjects', 'SchoolYearSemester')
        Schedule = self.old_apps.get_model('subjects', 'SubjectSchedule')
        Enrollment = self.old_apps.get_model('subjects', 'ScheduleStudent')
        Module = self.old_apps.get_model('learning_modules', 'Module')
        Activity = self.old_apps.get_model('learning_modules', 'ModuleActivity')
        ActivitySubmission = self.old_apps.get_model('learning_modules', 'ModuleActivitySubmission')
        Problem = self.old_apps.get_model('coding', 'ProgrammingProblem')
        Submission = self.old_apps.get_model('coding', 'CodeSubmission')
        Blank = self.old_apps.get_model('coding', 'CodeBlank')
        BlankAnswer = self.old_apps.get_model('coding', 'CodeBlankAnswer')
        Category = self.old_apps.get_model('grades', 'GradeCategory')
        GradeItem = self.old_apps.get_model('grades', 'GradeItem')
        Score = self.old_apps.get_model('grades', 'StudentGradeItemScore')
        PointLedger = self.old_apps.get_model('gamification', 'PointLedger')

        student = User.objects.create(username='coding-removal-student', role='STUDENT')
        subject = Subject.objects.create(code='RET101', name='Retirement Testing')
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
        module = Module.objects.create(title='Retained module', slug='retained-module', subject=subject)
        problem = Problem.objects.create(
            title='Retired problem',
            slug='retired-problem',
            description='This data is intentionally removed.',
            subject=subject,
            module=module,
            points_possible=Decimal('10.00'),
        )
        code_activity = Activity.objects.create(
            module=module,
            programming_problem=problem,
            title='Retired coding activity',
            instructions='Write code.',
            activity_type='CODE_COMPLETE',
            accepts_code=True,
            accepts_text=False,
            points_possible=Decimal('10.00'),
        )
        mixed_activity = Activity.objects.create(
            module=module,
            title='Retained mixed activity',
            instructions='Submit text or code.',
            activity_type='TEXT',
            accepts_code=True,
            accepts_text=True,
            points_possible=Decimal('10.00'),
        )
        mixed_submission = ActivitySubmission.objects.create(
            activity=mixed_activity,
            student=student,
            text_answer='Keep this answer.',
            code='discard();',
        )
        code_submission = Submission.objects.create(
            problem=problem,
            student=student,
            language='python',
            source_code='print(1)',
            score=Decimal('10.00'),
            status='ACCEPTED',
        )
        blank = Blank.objects.create(problem=problem, key='answer', expected_answer='1')
        BlankAnswer.objects.create(submission=code_submission, blank=blank, answer='1')

        activity_category = Category.objects.create(
            subject=subject,
            grading_period='PRELIM',
            category='ACTIVITY',
            name='Activities',
            weight=Decimal('50.00'),
        )
        coding_category = Category.objects.create(
            subject=subject,
            grading_period='PRELIM',
            category='CODING',
            name='Coding',
            weight=Decimal('50.00'),
        )
        retained_item = GradeItem.objects.create(
            schedule=schedule,
            grade_category=activity_category,
            title='Retained paper activity',
            points_possible=Decimal('10.00'),
            source_type='MANUAL',
        )
        linked_item = GradeItem.objects.create(
            schedule=schedule,
            grade_category=activity_category,
            title='Retired linked activity',
            points_possible=Decimal('10.00'),
            source_type='MODULE_ACTIVITY',
            module_activity=code_activity,
        )
        coding_item = GradeItem.objects.create(
            schedule=schedule,
            grade_category=coding_category,
            title='Retired coding item',
            points_possible=Decimal('10.00'),
            source_type='CODING',
            coding_problem=problem,
        )
        Score.objects.create(grade_item=retained_item, student=student, raw_score=Decimal('8.00'))
        Score.objects.create(grade_item=linked_item, student=student, raw_score=Decimal('9.00'))
        Score.objects.create(grade_item=coding_item, student=student, raw_score=Decimal('10.00'))
        PointLedger.objects.create(
            student=student,
            source='CODING',
            points=25,
            description='Retired coding points',
        )
        PointLedger.objects.create(
            student=student,
            source='MANUAL',
            points=5,
            description='Retained points',
        )

        MigrationExecutor(connection).migrate(self.latest_targets)

        with connection.cursor() as cursor:
            tables = set(connection.introspection.table_names(cursor))
        self.assertFalse(any(table.startswith('coding_') for table in tables))

        from gamification.models import PointLedger as CurrentPointLedger
        from grades.models import FinalGrade, GradeCategory, GradeItem as CurrentGradeItem, PeriodGrade
        from learning_modules.models import ModuleActivity, ModuleActivitySubmission

        self.assertFalse(ModuleActivity.objects.filter(pk=code_activity.pk).exists())
        self.assertTrue(ModuleActivity.objects.filter(pk=mixed_activity.pk).exists())
        self.assertTrue(ModuleActivitySubmission.objects.filter(pk=mixed_submission.pk).exists())
        self.assertFalse(hasattr(ModuleActivity, 'accepts_code'))
        self.assertFalse(hasattr(ModuleActivitySubmission, 'code'))
        self.assertEqual(
            set(CurrentGradeItem.objects.values_list('title', flat=True)),
            {'Retained paper activity'},
        )
        self.assertFalse(GradeCategory.objects.filter(category='CODING').exists())
        self.assertEqual(
            list(CurrentPointLedger.objects.values_list('source', 'points')),
            [('MANUAL', 5)],
        )
        period = PeriodGrade.objects.get(schedule_id=schedule.pk, student_id=student.pk)
        final = FinalGrade.objects.get(schedule_id=schedule.pk, student_id=student.pk)
        self.assertEqual(period.completion_status, 'PENDING')
        self.assertIsNone(period.raw_score)
        self.assertEqual(final.completion_status, 'PENDING')
        self.assertIsNone(final.prelim_grade)
