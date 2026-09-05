from importlib import import_module
from types import SimpleNamespace
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TestCase
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import User, StudentProfile


migration = import_module('accounts.migrations.0007_user_middle_name')


class NameMigrationTests(TestCase):
    @patch.dict('os.environ', {'ALLOW_PERFORMANCE_SEED': 'true'})
    def test_migration_keeps_enrollments_grades_and_attendance_unchanged(self):
        from subjects.models import ScheduleStudent
        from attendance.models import AttendanceRecord
        from grades.models import StudentGradeItemScore

        call_command('seed_performance', students=2, schedules=1,
                     classes_per_student=1, grade_items_per_class=1,
                     attendance_sessions_per_class=1, lessons_per_module=1,
                     confirm=True, stdout=StringIO())
        models = (ScheduleStudent, AttendanceRecord, StudentGradeItemScore)
        before = [list(model.objects.order_by('pk').values()) for model in models]
        self.assertTrue(all(before))
        historical = MigrationExecutor(connection).loader.project_state([('accounts', '0007_user_middle_name')]).apps
        migration.migrate_names(historical, SimpleNamespace(connection=connection))
        for model, expected in zip(models, before):
            self.assertEqual(list(model.objects.order_by('pk').values()), expected)

    def test_split_rules(self):
        for suffix in migration.MIDDLE_NAMES:
            with self.subTest(suffix=suffix):
                self.assertEqual(migration.split_name('Mary Ann ' + suffix), ('Mary Ann', suffix))
                self.assertEqual(migration.split_name('Mary ' + suffix.lower()), ('Mary', suffix.lower()))
                self.assertEqual(migration.split_name(suffix), (suffix, ''))
        for original, expected in (
            ('Mary Ann', ('Mary', 'Ann')),
            ('Mary Ann Cruz', ('Mary Ann', 'Cruz')),
            ('Mary A.', ('Mary', 'A.')),
            ('Élise Ñora', ('Élise', 'Ñora')),
            ('  Mary\tAnn\n De  Leon ', ('Mary Ann', 'De Leon')),
            ('Mary', ('Mary', '')), ('', ('', '')), ('   ', ('', '')),
        ):
            with self.subTest(original=original):
                self.assertEqual(migration.split_name(original), expected)

    def test_historical_models_batches_and_reversal_preserve_identity(self):
        student = User.objects.create(username='migration-student', first_name='Mary Ann', last_name='Cruz')
        profile = StudentProfile.objects.create(user=student, student_number=student.username)
        teacher = User.objects.create(username='migration-teacher', role='TEACHER', first_name='Mary Ann')
        User.objects.bulk_create([User(username=f'batch-{i}', first_name='Juan De Leon') for i in range(501)])
        historical = MigrationExecutor(connection).loader.project_state([('accounts', '0007_user_middle_name')]).apps
        editor = SimpleNamespace(connection=connection)
        migration.migrate_names(historical, editor)
        student.refresh_from_db()
        teacher.refresh_from_db()
        profile.refresh_from_db()
        self.assertEqual((student.first_name, student.middle_name, student.last_name), ('Mary', 'Ann', 'Cruz'))
        self.assertEqual(student.username, 'migration-student')
        self.assertEqual(profile.user_id, student.id)
        self.assertEqual(teacher.first_name, 'Mary Ann')
        self.assertEqual(User.objects.filter(middle_name='De Leon').count(), 501)
        migration.reverse_names(historical, editor)
        student.refresh_from_db()
        self.assertEqual((student.first_name, student.middle_name), ('Mary Ann', ''))


class StudentNameApiTests(APITestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(username='names-teacher', role='TEACHER')
        self.client.force_authenticate(self.teacher)

    def test_explicit_creation_edit_search_and_name_values(self):
        response = self.client.post(reverse('accounts:student-list'), {
            'student_number': 'NAME-001', 'first_name': 'Mary Ann',
            'middle_name': 'De Leon', 'last_name': 'Cruz',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        student = User.objects.get(username='NAME-001')
        self.assertEqual(student.first_name, 'Mary Ann')
        self.assertEqual(student.get_display_name(), 'Mary Ann D. Cruz')
        self.assertEqual(student.get_full_name(), 'Mary Ann De Leon Cruz')
        url = reverse('accounts:user-detail', args=[student.id])
        response = self.client.patch(url, {'middle_name': 'Ñora'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['display_name'], 'Mary Ann Ñ. Cruz')
        self.assertEqual(response.data['full_name'], 'Mary Ann Ñora Cruz')
        search = self.client.get(reverse('accounts:user-list'), {'search': 'Ñora'})
        self.assertContains(search, 'NAME-001')
        for field in ('first_name', 'middle_name', 'last_name'):
            for value in ('x' * 151, 'Bad\ufffdName'):
                response = self.client.patch(url, {field: value}, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.data)
        response = self.client.patch(url, {'middle_name': ''}, format='json')
        self.assertEqual(response.data['display_name'], 'Mary Ann Cruz')

    def test_teacher_formatting_and_existing_initial(self):
        user = User(first_name='Mary Ann', middle_name='D.', last_name='Cruz')
        self.assertEqual(user.get_display_name(), 'Mary Ann D. Cruz')
        user.role = 'TEACHER'
        self.assertEqual(user.get_display_name(), 'Mary Ann Cruz')
        self.assertEqual(user.get_full_name(), 'Mary Ann Cruz')
