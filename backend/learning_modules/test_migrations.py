import tempfile
from datetime import time
from decimal import Decimal

from django.core.files.base import ContentFile
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from accounts.models import User


class RemoveModulePaymentsMigrationTests(TransactionTestCase):
    migrate_from = [('learning_modules', '0019_activity_reliability')]
    migrate_to = [('learning_modules', '0020_remove_module_payments')]

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        executor.migrate(self.migrate_from)
        old_apps = executor.loader.project_state(self.migrate_from).apps

        Module = old_apps.get_model('learning_modules', 'Module')
        ModuleAccess = old_apps.get_model('learning_modules', 'ModuleAccess')
        teacher = User.objects.create(username='migration-teacher', role='TEACHER')
        students = [
            User.objects.create(username=f'migration-student-{index}', role='STUDENT')
            for index in range(3)
        ]
        module = Module.objects.create(
            title='Legacy Priced Module',
            slug='legacy-priced-module',
            is_paid=True,
            price='500.00',
        )
        expiry = timezone.now() + timezone.timedelta(days=30)
        self.valid_id = ModuleAccess.objects.create(
            access_type='PAYMENT',
            activated_by_id=teacher.id,
            amount_paid='500.00',
            expires_at=expiry,
            is_active=True,
            module=module,
            payment_reference='LEGACY-VALID',
            payment_status='PAID',
            student_id=students[0].id,
        ).id
        self.unpaid_id = ModuleAccess.objects.create(
            access_type='PAYMENT',
            activated_by_id=teacher.id,
            expires_at=expiry,
            is_active=True,
            module=module,
            payment_status='UNPAID',
            student_id=students[1].id,
        ).id
        self.unverified_id = ModuleAccess.objects.create(
            access_type='PAYMENT',
            activated_by_id=None,
            expires_at=expiry,
            is_active=True,
            module=module,
            payment_status='PAID',
            student_id=students[2].id,
        ).id

        executor = MigrationExecutor(connection)
        executor.migrate(self.migrate_to)
        self.apps = executor.loader.project_state(self.migrate_to).apps

    def tearDown(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())
        super().tearDown()

    def test_migration_preserves_valid_access_and_removes_money_fields(self):
        Module = self.apps.get_model('learning_modules', 'Module')
        ModuleAccess = self.apps.get_model('learning_modules', 'ModuleAccess')
        valid = ModuleAccess.objects.get(pk=self.valid_id)
        unpaid = ModuleAccess.objects.get(pk=self.unpaid_id)
        unverified = ModuleAccess.objects.get(pk=self.unverified_id)

        self.assertEqual(valid.access_type, 'ENROLLED')
        self.assertTrue(valid.is_active)
        self.assertFalse(unpaid.is_active)
        self.assertFalse(unverified.is_active)
        self.assertNotIn('is_paid', {field.name for field in Module._meta.fields})
        self.assertNotIn('price', {field.name for field in Module._meta.fields})
        access_fields = {field.name for field in ModuleAccess._meta.fields}
        self.assertNotIn('payment_status', access_fields)
        self.assertNotIn('amount_paid', access_fields)
        self.assertNotIn('payment_reference', access_fields)


class TopicPdfOnlyMigrationTests(TransactionTestCase):
    reset_sequences = True

    migrate_from = {
        'coding': '0004_remove_assessment_links',
        'gamification': '0002_remove_assessment_point_source',
        'grades': '0009_remove_assessment_sources',
        'learning_modules': '0022_moduletopic_printable_pdf',
    }

    def setUp(self):
        super().setUp()
        self.media_root = tempfile.TemporaryDirectory()
        self.settings_override = override_settings(MEDIA_ROOT=self.media_root.name)
        self.settings_override.enable()

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
        self.settings_override.disable()
        self.media_root.cleanup()
        super().tearDown()

    def test_migration_deletes_module_and_lesson_pdfs_but_preserves_topic_pdf(self):
        Module = self.old_apps.get_model('learning_modules', 'Module')
        ModuleTopic = self.old_apps.get_model('learning_modules', 'ModuleTopic')
        ModuleLesson = self.old_apps.get_model('learning_modules', 'ModuleLesson')

        module = Module.objects.create(
            title='Migration Printable Module',
            slug='migration-printable-module',
        )
        topic = ModuleTopic.objects.create(
            module=module,
            title='Migration Printable Topic',
        )
        lesson = ModuleLesson.objects.create(
            topic=topic,
            title='Migration Printable Lesson',
        )
        module.pdf_file.save('module.pdf', ContentFile(b'module pdf'))
        topic.pdf_file.save('topic.pdf', ContentFile(b'topic pdf'))
        lesson.pdf_file.save('lesson.pdf', ContentFile(b'lesson pdf'))

        module_name = module.pdf_file.name
        topic_name = topic.pdf_file.name
        lesson_name = lesson.pdf_file.name
        storage = topic.pdf_file.storage
        self.assertTrue(storage.exists(module_name))
        self.assertTrue(storage.exists(topic_name))
        self.assertTrue(storage.exists(lesson_name))

        MigrationExecutor(connection).migrate(self.latest_targets)

        from learning_modules.models import Module as CurrentModule
        from learning_modules.models import ModuleLesson as CurrentModuleLesson
        from learning_modules.models import ModuleTopic as CurrentModuleTopic

        self.assertTrue(CurrentModule.objects.filter(pk=module.pk).exists())
        self.assertTrue(CurrentModuleTopic.objects.filter(pk=topic.pk).exists())
        self.assertTrue(CurrentModuleLesson.objects.filter(pk=lesson.pk).exists())
        self.assertFalse(storage.exists(module_name))
        self.assertTrue(storage.exists(topic_name))
        self.assertFalse(storage.exists(lesson_name))

        with connection.cursor() as cursor:
            module_columns = {
                column.name
                for column in connection.introspection.get_table_description(
                    cursor,
                    CurrentModule._meta.db_table,
                )
            }
            lesson_columns = {
                column.name
                for column in connection.introspection.get_table_description(
                    cursor,
                    CurrentModuleLesson._meta.db_table,
                )
            }

        retired_columns = {'pdf_file', 'pdf_generated_at', 'pdf_is_outdated'}
        self.assertTrue(retired_columns.isdisjoint(module_columns))
        self.assertTrue(retired_columns.isdisjoint(lesson_columns))


class MainActivityGradingPeriodMigrationTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        self.latest_targets = executor.loader.graph.leaf_nodes()
        old_targets = [
            ('learning_modules', '0024_remove_coding_activities')
            if app_label == 'learning_modules'
            else (app_label, migration_name)
            for app_label, migration_name in self.latest_targets
        ]
        executor.migrate(old_targets)
        self.old_apps = executor.loader.project_state(old_targets).apps

    def tearDown(self):
        MigrationExecutor(connection).migrate(self.latest_targets)
        super().tearDown()

    def test_infers_only_an_unambiguous_linked_period(self):
        Subject = self.old_apps.get_model('subjects', 'Subject')
        SchoolYear = self.old_apps.get_model('subjects', 'SchoolYear')
        Term = self.old_apps.get_model('subjects', 'SchoolYearSemester')
        Schedule = self.old_apps.get_model('subjects', 'SubjectSchedule')
        Module = self.old_apps.get_model('learning_modules', 'Module')
        Activity = self.old_apps.get_model('learning_modules', 'ModuleActivity')
        Category = self.old_apps.get_model('grades', 'GradeCategory')
        GradeItem = self.old_apps.get_model('grades', 'GradeItem')

        subject = Subject.objects.create(code='PERIOD101', name='Period migration')
        school_year = SchoolYear.objects.create(start_year=2042, end_year=2043)
        term = Term.objects.create(school_year=school_year, semester='FIRST')
        schedule_a = Schedule.objects.create(
            subject=subject, school_year_semester=term, days='MWF',
            start_time=time(8), end_time=time(9), section='A',
        )
        schedule_b = Schedule.objects.create(
            subject=subject, school_year_semester=term, days='TTH',
            start_time=time(9), end_time=time(10), section='B',
        )
        prelim = Category.objects.create(
            subject=subject, grading_period='PRELIM', category='QUIZ',
            name='Prelim quizzes', weight=Decimal('50.00'),
        )
        midterm = Category.objects.create(
            subject=subject, grading_period='MIDTERM', category='QUIZ',
            name='Midterm quizzes', weight=Decimal('50.00'),
        )
        module = Module.objects.create(title='Period module', slug='period-module', subject=subject)
        inferred = Activity.objects.create(
            module=module, title='Inferred activity', instructions='Complete it.',
            points_possible=Decimal('10.00'),
        )
        mixed = Activity.objects.create(
            module=module, title='Mixed activity', instructions='Complete it.',
            points_possible=Decimal('10.00'),
        )
        unlinked = Activity.objects.create(
            module=module, title='Unlinked activity', instructions='Complete it.',
            points_possible=Decimal('10.00'),
        )
        for activity, schedule, category in (
            (inferred, schedule_a, prelim),
            (mixed, schedule_a, prelim),
            (mixed, schedule_b, midterm),
        ):
            GradeItem.objects.create(
                schedule=schedule, grade_category=category, title=activity.title,
                points_possible=Decimal('10.00'), source_type='MODULE_ACTIVITY',
                module_activity=activity,
            )

        executor = MigrationExecutor(connection)
        executor.migrate(self.latest_targets)
        apps = executor.loader.project_state(self.latest_targets).apps
        MigratedActivity = apps.get_model('learning_modules', 'ModuleActivity')

        self.assertEqual(MigratedActivity.objects.get(pk=inferred.pk).grading_period, 'PRELIM')
        self.assertIsNone(MigratedActivity.objects.get(pk=mixed.pk).grading_period)
        self.assertIsNone(MigratedActivity.objects.get(pk=unlinked.pk).grading_period)


class MainActivityHardeningMigrationTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        self.latest_targets = executor.loader.graph.leaf_nodes()
        old_targets = [
            ('learning_modules', '0026_learning_contexts')
            if app_label == 'learning_modules'
            else (app_label, migration_name)
            for app_label, migration_name in self.latest_targets
        ]
        executor.migrate(old_targets)
        self.old_apps = executor.loader.project_state(old_targets).apps

    def tearDown(self):
        MigrationExecutor(connection).migrate(self.latest_targets)
        super().tearDown()

    def test_clears_lesson_windows_and_supersedes_duplicate_open_attempts(self):
        Subject = self.old_apps.get_model('subjects', 'Subject')
        SchoolYear = self.old_apps.get_model('subjects', 'SchoolYear')
        Term = self.old_apps.get_model('subjects', 'SchoolYearSemester')
        Schedule = self.old_apps.get_model('subjects', 'SubjectSchedule')
        Module = self.old_apps.get_model('learning_modules', 'Module')
        Topic = self.old_apps.get_model('learning_modules', 'ModuleTopic')
        Lesson = self.old_apps.get_model('learning_modules', 'ModuleLesson')
        Activity = self.old_apps.get_model('learning_modules', 'ModuleActivity')
        Attempt = self.old_apps.get_model('learning_modules', 'ModuleActivityAttempt')
        Extension = self.old_apps.get_model('learning_modules', 'ModuleActivityExtension')

        teacher = User.objects.create(username='hardening-migration-teacher', role='TEACHER')
        student = User.objects.create(username='hardening-migration-student', role='STUDENT')
        subject = Subject.objects.create(code='HARD101', name='Hardening migration')
        year = SchoolYear.objects.create(start_year=2044, end_year=2045)
        term = Term.objects.create(school_year=year, semester='FIRST')
        schedule = Schedule.objects.create(
            subject=subject,
            school_year_semester=term,
            days='MWF',
            start_time=time(8),
            end_time=time(9),
            section='A',
        )
        module = Module.objects.create(title='Hardening module', slug='hardening-module', subject=subject)
        topic = Topic.objects.create(module=module, title='Hardening topic')
        lesson = Lesson.objects.create(topic=topic, title='Hardening lesson')
        activity = Activity.objects.create(
            module=module,
            topic=topic,
            lesson=lesson,
            title='Hardening activity',
            due_at=timezone.now() + timezone.timedelta(days=1),
            opens_at=timezone.now() - timezone.timedelta(days=1),
            allow_late_submissions=True,
            passing_score=Decimal('5.00'),
            grading_period='PRELIM',
        )
        older = Attempt.objects.create(
            activity=activity,
            student_id=student.id,
            context_type='CLASS',
            schedule=schedule,
            attempt_number=1,
        )
        newest = Attempt.objects.create(
            activity=activity,
            student_id=student.id,
            context_type='CLASS',
            schedule=schedule,
            attempt_number=2,
        )
        Extension.objects.create(
            activity=activity,
            student_id=student.id,
            due_at=timezone.now() + timezone.timedelta(days=2),
            granted_by_id=teacher.id,
        )

        executor = MigrationExecutor(connection)
        executor.migrate(self.latest_targets)
        apps = executor.loader.project_state(self.latest_targets).apps
        MigratedActivity = apps.get_model('learning_modules', 'ModuleActivity')
        MigratedAttempt = apps.get_model('learning_modules', 'ModuleActivityAttempt')
        MigratedExtension = apps.get_model('learning_modules', 'ModuleActivityExtension')

        migrated_activity = MigratedActivity.objects.get(pk=activity.pk)
        self.assertIsNone(migrated_activity.opens_at)
        self.assertIsNone(migrated_activity.due_at)
        self.assertFalse(migrated_activity.allow_late_submissions)
        self.assertFalse(MigratedExtension.objects.filter(activity_id=activity.pk).exists())
        self.assertEqual(MigratedAttempt.objects.get(pk=older.pk).status, 'SUPERSEDED')
        migrated_newest = MigratedAttempt.objects.get(pk=newest.pk)
        self.assertEqual(migrated_newest.status, 'IN_PROGRESS')
        self.assertEqual(migrated_newest.passing_score_snapshot, Decimal('5.00'))
        self.assertNotIn(
            'is_submitted',
            {field.name for field in MigratedAttempt._meta.fields},
        )


class MarkTopicPdfsOutdatedMigrationTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        self.latest_targets = executor.loader.graph.leaf_nodes()
        old_targets = [
            ('learning_modules', '0029_performance_indexes')
            if app_label == 'learning_modules'
            else (app_label, migration_name)
            for app_label, migration_name in self.latest_targets
        ]
        executor.migrate(old_targets)
        self.old_apps = executor.loader.project_state(old_targets).apps

    def tearDown(self):
        MigrationExecutor(connection).migrate(self.latest_targets)
        super().tearDown()

    def test_marks_only_existing_current_topic_pdfs_outdated(self):
        Subject = self.old_apps.get_model('subjects', 'Subject')
        Module = self.old_apps.get_model('learning_modules', 'Module')
        Topic = self.old_apps.get_model('learning_modules', 'ModuleTopic')

        subject = Subject.objects.create(code='PDFMIG', name='PDF migration')
        module = Module.objects.create(
            title='PDF migration module',
            slug='pdf-migration-module',
            subject=subject,
        )
        current_pdf = Topic.objects.create(
            module=module,
            title='Current PDF',
            pdf_file='module_topic_pdfs/current.pdf',
            pdf_generated_at=timezone.now(),
            pdf_is_outdated=False,
        )
        already_outdated_pdf = Topic.objects.create(
            module=module,
            title='Already outdated PDF',
            pdf_file='module_topic_pdfs/outdated.pdf',
            pdf_generated_at=timezone.now(),
            pdf_is_outdated=True,
        )
        missing_pdf = Topic.objects.create(
            module=module,
            title='Missing PDF',
            pdf_is_outdated=False,
        )

        executor = MigrationExecutor(connection)
        executor.migrate(self.latest_targets)
        apps = executor.loader.project_state(self.latest_targets).apps
        MigratedTopic = apps.get_model('learning_modules', 'ModuleTopic')

        self.assertTrue(MigratedTopic.objects.get(pk=current_pdf.pk).pdf_is_outdated)
        self.assertTrue(
            MigratedTopic.objects.get(pk=already_outdated_pdf.pk).pdf_is_outdated,
        )
        self.assertFalse(MigratedTopic.objects.get(pk=missing_pdf.pk).pdf_is_outdated)
