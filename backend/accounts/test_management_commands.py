import csv
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import authenticate, get_user_model
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase


class PrepareMigratedUsersCommandTests(TestCase):
    def test_rotates_passwords_and_requires_first_login_change(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username='migrated-user',
            password='old-password-123',
            role=user_model.Role.STUDENT,
        )

        with TemporaryDirectory() as output_dir:
            output = Path(output_dir) / 'temporary-credentials.csv'
            call_command(
                'prepare_migrated_users',
                output=str(output),
                confirm=True,
                stdout=StringIO(),
            )
            with output.open(encoding='utf-8') as output_file:
                rows = list(csv.DictReader(output_file))

        user.refresh_from_db()
        self.assertTrue(user.must_change_password)
        self.assertIsNone(authenticate(username=user.username, password='old-password-123'))
        self.assertIsNotNone(
            authenticate(username=user.username, password=rows[0]['temporary_password'])
        )


class SyncStudentCredentialsCommandTests(TestCase):
    def create_profile(self, username, student_number, *, active=True, password='old-password'):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username=username,
            password=password,
            role=user_model.Role.STUDENT,
            is_active=active,
        )
        from .models import StudentProfile

        return StudentProfile.objects.create(
            user=user,
            student_number=student_number,
            is_active=active,
        )

    def test_dry_run_validates_without_changing_data(self):
        profile = self.create_profile('legacy-name', '141443')

        call_command('sync_student_credentials', dry_run=True, stdout=StringIO())

        profile.user.refresh_from_db()
        self.assertEqual(profile.user.username, 'legacy-name')
        self.assertTrue(profile.user.check_password('old-password'))
        self.assertFalse(profile.user.must_change_password)

    def test_confirm_updates_active_and_inactive_students_but_not_staff(self):
        active = self.create_profile('active-legacy', '141443')
        inactive = self.create_profile('inactive-legacy', '141444', active=False)
        user_model = get_user_model()
        teacher = user_model.objects.create_user(
            username='teacher-safe',
            password='TeacherSecurePass!482',
            role=user_model.Role.TEACHER,
        )

        call_command('sync_student_credentials', confirm=True, stdout=StringIO())

        for profile in (active, inactive):
            profile.user.refresh_from_db()
            self.assertEqual(profile.user.username, profile.student_number)
            self.assertTrue(profile.user.check_password(profile.student_number))
            self.assertTrue(profile.user.must_change_password)
        teacher.refresh_from_db()
        self.assertEqual(teacher.username, 'teacher-safe')
        self.assertTrue(teacher.check_password('TeacherSecurePass!482'))

    def test_confirm_handles_student_username_swaps(self):
        first = self.create_profile('STUDENT-B', 'STUDENT-A')
        second = self.create_profile('STUDENT-A', 'STUDENT-B')

        call_command('sync_student_credentials', confirm=True, stdout=StringIO())

        first.user.refresh_from_db()
        second.user.refresh_from_db()
        self.assertEqual(first.user.username, 'STUDENT-A')
        self.assertEqual(second.user.username, 'STUDENT-B')

    def test_conflict_aborts_without_changing_any_student(self):
        profile = self.create_profile('legacy-name', 'CONFLICT-1')
        user_model = get_user_model()
        user_model.objects.create_user(
            username='conflict-1',
            password='TeacherSecurePass!482',
            role=user_model.Role.TEACHER,
        )

        with self.assertRaises(CommandError):
            call_command('sync_student_credentials', confirm=True, stdout=StringIO())

        profile.user.refresh_from_db()
        self.assertEqual(profile.user.username, 'legacy-name')
        self.assertTrue(profile.user.check_password('old-password'))

    def test_case_insensitive_duplicate_aborts(self):
        self.create_profile('legacy-one', 'Mixed-Number')
        self.create_profile('legacy-two', 'mixed-number')

        with self.assertRaises(CommandError):
            call_command('sync_student_credentials', dry_run=True, stdout=StringIO())
