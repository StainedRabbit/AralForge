import tempfile

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
