import csv
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase
from django.urls import reverse


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
        active_user_id = active.user_id
        active_profile_id = active.id
        active.user.first_name = 'Existing'
        active.user.email = 'existing@example.test'
        active.user.save(update_fields=('first_name', 'email'))
        group = Group.objects.create(name='Existing student group')
        permission = Permission.objects.order_by('id').first()
        self.assertIsNotNone(permission)
        active.user.groups.add(group)
        active.user.user_permissions.add(permission)
        user_model = get_user_model()
        teacher = user_model.objects.create_user(
            username='teacher-safe',
            password='TeacherSecurePass!482',
            role=user_model.Role.TEACHER,
        )

        call_command('sync_student_credentials', confirm=True, stdout=StringIO())

        for profile in (active, inactive):
            profile.user.refresh_from_db()
            profile.refresh_from_db()
            self.assertEqual(profile.user.username, profile.student_number)
            self.assertTrue(profile.user.check_password(profile.student_number))
            self.assertFalse(profile.user.check_password('old-password'))
            self.assertTrue(profile.user.must_change_password)
            self.assertEqual(profile.student_number, '141443' if profile == active else '141444')
        self.assertEqual(active.user.first_name, 'Existing')
        self.assertEqual(active.user.email, 'existing@example.test')
        self.assertEqual(active.user.id, active_user_id)
        self.assertEqual(active.id, active_profile_id)
        self.assertEqual(set(active.user.groups.values_list('id', flat=True)), {group.id})
        self.assertEqual(
            set(active.user.user_permissions.values_list('id', flat=True)),
            {permission.id},
        )
        teacher.refresh_from_db()
        self.assertEqual(teacher.username, 'teacher-safe')
        self.assertTrue(teacher.check_password('TeacherSecurePass!482'))

        login = self.client.post(
            reverse('token_obtain_pair'),
            {'username': '141443', 'password': '141443'},
        )
        self.assertEqual(login.status_code, 200)
        self.assertTrue(login.json()['must_change_password'])
        self.assertNotIn('access', login.json())

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
        unaffected = self.create_profile('another-legacy', 'SAFE-1')
        user_model = get_user_model()
        user_model.objects.create_user(
            username='conflict-1',
            password='TeacherSecurePass!482',
            role=user_model.Role.TEACHER,
        )

        with self.assertRaises(CommandError):
            call_command('sync_student_credentials', confirm=True, stdout=StringIO())

        profile.user.refresh_from_db()
        unaffected.user.refresh_from_db()
        self.assertEqual(profile.user.username, 'legacy-name')
        self.assertTrue(profile.user.check_password('old-password'))
        self.assertEqual(unaffected.user.username, 'another-legacy')
        self.assertTrue(unaffected.user.check_password('old-password'))
        self.assertFalse(unaffected.user.must_change_password)

    def test_case_insensitive_duplicate_aborts(self):
        self.create_profile('legacy-one', 'Mixed-Number')
        self.create_profile('legacy-two', 'mixed-number')

        with self.assertRaises(CommandError):
            call_command('sync_student_credentials', dry_run=True, stdout=StringIO())

    def test_preflight_rejects_orphan_staff_linked_and_noncanonical_records(self):
        user_model = get_user_model()
        user_model.objects.create_user(
            username='orphan-student',
            password='old-password',
            role=user_model.Role.STUDENT,
        )
        staff_profile = self.create_profile('staff-linked', '141445')
        staff_profile.user.is_staff = True
        staff_profile.user.save(update_fields=('is_staff',))
        noncanonical = self.create_profile('spaced-number', ' 141446 ')

        with self.assertRaises(CommandError) as caught:
            call_command('sync_student_credentials', dry_run=True, stdout=StringIO())

        message = str(caught.exception)
        self.assertIn('belongs to a non-student account', message)
        self.assertIn('has no student profile', message)
        self.assertIn('non-canonical student number', message)
        staff_profile.refresh_from_db()
        staff_profile.user.refresh_from_db()
        noncanonical.refresh_from_db()
        noncanonical.user.refresh_from_db()
        self.assertEqual(staff_profile.user.username, 'staff-linked')
        self.assertEqual(noncanonical.student_number, ' 141446 ')
        self.assertEqual(noncanonical.user.username, 'spaced-number')


class ConvertStudentUsernamesCommandTests(TestCase):
    def create_student(self, username, student_number, *, password='ExistingPass!482'):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username=username,
            password=password,
            role=user_model.Role.STUDENT,
        )
        from .models import StudentProfile

        profile = StudentProfile.objects.create(
            user=user,
            student_number=student_number,
        )
        return user, profile

    def test_default_dry_run_reports_candidates_without_changing_data(self):
        student, _profile = self.create_student('student-130183', '130183')
        teacher = get_user_model().objects.create_user(
            username='student-777777',
            password='TeacherPass!482',
            role=get_user_model().Role.TEACHER,
        )
        unmatched, _profile = self.create_student('student-ABC', 'ABC')
        output = StringIO()

        call_command('convert_student_usernames', stdout=output)

        student.refresh_from_db()
        teacher.refresh_from_db()
        unmatched.refresh_from_db()
        self.assertEqual(student.username, 'student-130183')
        self.assertEqual(teacher.username, 'student-777777')
        self.assertEqual(unmatched.username, 'student-ABC')
        self.assertIn('found=2', output.getvalue())
        self.assertIn('changed=0', output.getvalue())
        self.assertIn('would_change=1', output.getvalue())
        self.assertIn('skipped=1', output.getvalue())
        self.assertIn('conflicted=0', output.getvalue())

    def test_apply_changes_only_username_and_preserves_related_account_data(self):
        student, profile = self.create_student('student-130183', '130183')
        original_user_id = student.id
        original_profile_id = profile.id
        original_password = student.password
        output = StringIO()

        call_command('convert_student_usernames', apply=True, stdout=output)

        student.refresh_from_db()
        profile.refresh_from_db()
        self.assertEqual(student.id, original_user_id)
        self.assertEqual(profile.id, original_profile_id)
        self.assertEqual(student.username, '130183')
        self.assertEqual(student.password, original_password)
        self.assertEqual(student.role, get_user_model().Role.STUDENT)
        self.assertEqual(profile.student_number, '130183')
        self.assertIn('found=1', output.getvalue())
        self.assertIn('changed=1', output.getvalue())
        self.assertIn('skipped=0', output.getvalue())
        self.assertIn('conflicted=0', output.getvalue())

    def test_collision_aborts_all_changes(self):
        first, _profile = self.create_student('student-130183', '130183')
        second, _profile = self.create_student('student-130184', '130184')
        get_user_model().objects.create_user(
            username='130183',
            password='TeacherPass!482',
            role=get_user_model().Role.TEACHER,
        )
        output = StringIO()

        with self.assertRaises(CommandError):
            call_command('convert_student_usernames', apply=True, stdout=output)

        first.refresh_from_db()
        second.refresh_from_db()
        self.assertEqual(first.username, 'student-130183')
        self.assertEqual(second.username, 'student-130184')
        self.assertIn('found=2', output.getvalue())
        self.assertIn('changed=0', output.getvalue())
        self.assertIn('would_change=1', output.getvalue())
        self.assertIn('conflicted=1', output.getvalue())
