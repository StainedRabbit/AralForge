from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
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
