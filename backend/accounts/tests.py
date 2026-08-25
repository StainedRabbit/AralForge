from datetime import time, timedelta

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule

from .auth import PasswordSetupToken
from .models import StudentProfile


class StudentAccountCreationTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.teacher = user_model.objects.create_user(
            username='teacher-password-test',
            password='testpass123',
            role=user_model.Role.TEACHER,
        )
        self.client.force_authenticate(self.teacher)

    def test_generic_user_endpoint_rejects_student_creation(self):
        response = self.client.post(
            reverse('accounts:user-list'),
            {
                'username': '20270001',
                'password': 'SecurePass!482',
                'role': 'STUDENT',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('role', response.data)

        omitted_role = self.client.post(
            reverse('accounts:user-list'),
            {'username': 'implicit-student', 'password': 'SecurePass!482'},
            format='json',
        )
        self.assertEqual(omitted_role.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('role', omitted_role.data)

    def test_student_endpoint_creates_atomic_account_with_temporary_number_credentials(self):
        response = self.client.post(
            reverse('accounts:student-list'),
            {
                'student_number': '141443',
                'first_name': 'New',
                'last_name': 'Student',
                'email': 'student@example.test',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        profile = StudentProfile.objects.select_related('user').get(student_number='141443')
        self.assertEqual(profile.user.username, '141443')
        self.assertEqual(profile.user.role, get_user_model().Role.STUDENT)
        self.assertTrue(profile.user.check_password('141443'))
        self.assertTrue(profile.user.must_change_password)
        self.assertNotIn('section', response.data)
        self.assertNotIn('year_level', response.data)

        login = self.client.post(
            reverse('token_obtain_pair'),
            {'username': '141443', 'password': '141443'},
            format='json',
        )
        self.assertEqual(login.status_code, status.HTTP_200_OK)
        self.assertTrue(login.data['must_change_password'])
        self.assertNotIn('access', login.data)

    def test_student_username_cannot_diverge_but_admin_can_set_a_secure_password(self):
        profile = StudentProfile.objects.create(
            user=get_user_model().objects.create_user(
                username='ST-LOCKED',
                password='ST-LOCKED',
                role=get_user_model().Role.STUDENT,
                must_change_password=True,
            ),
            student_number='ST-LOCKED',
        )

        rejected = self.client.patch(
            reverse('accounts:user-detail', args=[profile.user_id]),
            {'username': 'different-name'},
            format='json',
        )
        self.assertEqual(rejected.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('username', rejected.data)

        updated = self.client.patch(
            reverse('accounts:user-detail', args=[profile.user_id]),
            {'password': 'AdminChosenSecurePass!482'},
            format='json',
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        profile.user.refresh_from_db()
        self.assertTrue(profile.user.check_password('AdminChosenSecurePass!482'))
        self.assertFalse(profile.user.must_change_password)

    def test_student_number_rejects_case_insensitive_username_conflict(self):
        get_user_model().objects.create_user(
            username='Existing-Number',
            password='SecurePass!482',
            role=get_user_model().Role.TEACHER,
        )

        response = self.client.post(
            reverse('accounts:student-list'),
            {'student_number': 'existing-number'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('student_number', response.data)

    def test_number_change_resets_only_an_unclaimed_temporary_password(self):
        profile = StudentProfile.objects.create(
            user=get_user_model().objects.create_user(
                username='OLD-1',
                password='OLD-1',
                role=get_user_model().Role.STUDENT,
                must_change_password=True,
            ),
            student_number='OLD-1',
        )

        response = self.client.patch(
            reverse('accounts:student-detail', args=[profile.id]),
            {'student_number': 'NEW-1'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        profile.user.refresh_from_db()
        self.assertEqual(profile.user.username, 'NEW-1')
        self.assertTrue(profile.user.check_password('NEW-1'))

        profile.user.set_password('ChosenSecurePass!482')
        profile.user.must_change_password = False
        profile.user.save(update_fields=('password', 'must_change_password'))
        response = self.client.patch(
            reverse('accounts:student-detail', args=[profile.id]),
            {'student_number': 'FINAL-1'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        profile.user.refresh_from_db()
        self.assertEqual(profile.user.username, 'FINAL-1')
        self.assertTrue(profile.user.check_password('ChosenSecurePass!482'))


class AvailableStudentPickerTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.teacher = user_model.objects.create_user(
            username='picker-teacher',
            password='testpass123',
            role=user_model.Role.TEACHER,
        )
        self.available = self.create_student('available', 'Avery', 'Cruz', 'ST-100')
        self.inactive = self.create_student('inactive', 'Bailey', 'Santos', 'ST-200')
        self.active = self.create_student('active', 'Casey', 'Reyes', 'ST-300')
        school_year = SchoolYear.objects.create(start_year=2032, end_year=2033)
        term = SchoolYearSemester.objects.create(school_year=school_year, semester=Semester.FIRST)
        subject = Subject.objects.create(code='PICK101', name='Student Picker')
        self.schedule = SubjectSchedule.objects.create(
            subject=subject,
            school_year_semester=term,
            days='MO',
            start_time=time(8),
            end_time=time(9),
        )
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.active)
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.inactive, is_active=False)
        self.client.force_authenticate(self.teacher)

    def create_student(self, username, first_name, last_name, student_number):
        user_model = get_user_model()
        student = user_model.objects.create_user(
            username=username,
            password='testpass123',
            first_name=first_name,
            last_name=last_name,
            role=user_model.Role.STUDENT,
        )
        StudentProfile.objects.create(
            user=student,
            student_number=student_number,
        )
        return student

    def test_returns_compact_picker_metadata_and_excludes_active_enrollments(self):
        response = self.client.get(
            reverse('accounts:user-available-students'),
            {'schedule': self.schedule.id, 'limit': 8},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = {item['id']: item for item in response.data['results']}
        self.assertNotIn(self.active.id, results)
        self.assertEqual(results[self.available.id], {
            'id': self.available.id,
            'display_name': 'Avery Cruz',
            'student_number': 'ST-100',
            'enrollment_status': 'not_enrolled',
        })
        self.assertEqual(results[self.inactive.id]['enrollment_status'], 'inactive')

    def test_searches_by_student_number(self):
        response = self.client.get(
            reverse('accounts:user-available-students'),
            {'schedule': self.schedule.id, 'search': 'ST-200', 'limit': 8},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item['id'] for item in response.data['results']], [self.inactive.id])


class TemporaryPasswordSetupTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.student = user_model.objects.create_user(
            username='internal-student-login',
            password='TemporaryPass!482',
            first_name='New',
            last_name='Student',
            role=user_model.Role.STUDENT,
            must_change_password=True,
        )
        StudentProfile.objects.create(user=self.student, student_number='ST-LOGIN-1')

    def test_student_number_login_requires_password_setup_and_setup_token_is_restricted(self):
        login = self.client.post(
            reverse('token_obtain_pair'),
            {'username': 'ST-LOGIN-1', 'password': 'TemporaryPass!482'},
            format='json',
        )

        self.assertEqual(login.status_code, status.HTTP_200_OK)
        self.assertTrue(login.data['must_change_password'])
        self.assertNotIn('access', login.data)
        setup_token = login.data['password_setup_token']

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {setup_token}')
        restricted = self.client.get(reverse('accounts:user-list'))
        self.assertEqual(restricted.status_code, status.HTTP_401_UNAUTHORIZED)
        self.client.credentials()

        completed = self.client.post(
            reverse('complete_password_setup'),
            {
                'password_setup_token': setup_token,
                'new_password': 'NewSecurePass!482',
                'confirm_password': 'NewSecurePass!482',
            },
            format='json',
        )
        self.assertEqual(completed.status_code, status.HTTP_200_OK)
        self.assertIn('access', completed.data)
        self.student.refresh_from_db()
        self.assertFalse(self.student.must_change_password)
        self.assertTrue(self.student.check_password('NewSecurePass!482'))

        reused = self.client.post(
            reverse('complete_password_setup'),
            {
                'password_setup_token': setup_token,
                'new_password': 'AnotherSecurePass!482',
                'confirm_password': 'AnotherSecurePass!482',
            },
            format='json',
        )
        self.assertEqual(reused.status_code, status.HTTP_400_BAD_REQUEST)

    def test_normal_username_login_remains_compatible(self):
        self.student.must_change_password = False
        self.student.save(update_fields=['must_change_password'])
        response = self.client.post(
            reverse('token_obtain_pair'),
            {'username': self.student.username, 'password': 'TemporaryPass!482'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)

    def test_expired_password_setup_token_is_rejected(self):
        token = PasswordSetupToken.for_user(self.student)
        token.set_exp(lifetime=timedelta(seconds=-1))
        response = self.client.post(
            reverse('complete_password_setup'),
            {
                'password_setup_token': str(token),
                'new_password': 'NewSecurePass!482',
                'confirm_password': 'NewSecurePass!482',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
