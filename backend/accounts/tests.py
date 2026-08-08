from datetime import time, timedelta

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule

from .auth import PasswordSetupToken
from .models import StudentProfile


class UserPasswordValidationTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.teacher = user_model.objects.create_user(
            username='teacher-password-test',
            password='testpass123',
            role=user_model.Role.TEACHER,
        )
        self.client.force_authenticate(self.teacher)

    def test_numeric_student_number_cannot_be_used_as_password(self):
        response = self.client.post(
            reverse('accounts:user-list'),
            {
                'username': '20270001',
                'password': '20270001',
                'role': 'STUDENT',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('password', response.data)


class AvailableStudentPickerTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.teacher = user_model.objects.create_user(
            username='picker-teacher',
            password='testpass123',
            role=user_model.Role.TEACHER,
        )
        self.available = self.create_student('available', 'Avery', 'Cruz', 'ST-100', 'A')
        self.inactive = self.create_student('inactive', 'Bailey', 'Santos', 'ST-200', 'B')
        self.active = self.create_student('active', 'Casey', 'Reyes', 'ST-300', 'C')
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

    def create_student(self, username, first_name, last_name, student_number, section):
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
            section=section,
            year_level=2,
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
            'section': 'A',
            'year_level': 2,
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
