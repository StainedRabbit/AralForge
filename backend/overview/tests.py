from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import StudentProfile
from learning_modules.models import Module


class OverviewApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.teacher = user_model.objects.create_user(
            username='overview-teacher', password='testpass123', role=user_model.Role.TEACHER,
        )
        self.student = user_model.objects.create_user(
            username='overview-student', password='testpass123', role=user_model.Role.STUDENT,
        )
        self.profile = StudentProfile.objects.create(user=self.student, student_number='OV-1')

    def test_me_returns_only_the_authenticated_identity(self):
        self.client.force_authenticate(self.student)
        response = self.client.get(reverse('accounts:user-me'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['user']['id'], self.student.id)
        self.assertEqual(response.data['student_profile']['id'], self.profile.id)
        self.assertRegex(response['Server-Timing'], r'^app;dur=\d+\.\d$')
        self.assertGreaterEqual(float(response['X-Response-Time-Ms']), 0)

    def test_student_dashboard_is_role_scoped_and_query_bounded(self):
        Module.objects.create(title='Hidden', slug='hidden-overview', is_published=False)
        self.client.force_authenticate(self.student)
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(reverse('overview:dashboard'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['role'], 'student')
        self.assertEqual(response.data['metrics']['module_count'], 0)
        self.assertLessEqual(len(queries), 25)

    def test_teacher_navigation_reports_teacher_role(self):
        self.client.force_authenticate(self.teacher)
        response = self.client.get(reverse('overview:navigation'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['role'], 'teacher')


class PaginationTests(APITestCase):
    def test_user_lists_are_paginated_and_searchable(self):
        user_model = get_user_model()
        teacher = user_model.objects.create_user(
            username='pagination-teacher', password='testpass123', role=user_model.Role.TEACHER,
        )
        for index in range(55):
            user_model.objects.create_user(username=f'pagination-{index:02d}', role=user_model.Role.STUDENT)
        self.client.force_authenticate(teacher)
        response = self.client.get(reverse('accounts:user-list'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['results']), 50)
        filtered = self.client.get(reverse('accounts:user-list'), {'search': 'pagination-54'})
        self.assertEqual([item['username'] for item in filtered.data['results']], ['pagination-54'])


class ProductionScaleOverviewTests(APITestCase):
    def test_teacher_dashboard_stays_query_bounded_with_one_thousand_students(self):
        user_model = get_user_model()
        teacher = user_model.objects.create_user(
            username='scale-teacher', password='testpass123', role=user_model.Role.TEACHER,
        )
        user_model.objects.bulk_create([
            user_model(username=f'scale-student-{index:04d}', role=user_model.Role.STUDENT)
            for index in range(1000)
        ])
        self.client.force_authenticate(teacher)
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(reverse('overview:dashboard'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['metrics']['student_count'], 1000)
        self.assertLessEqual(len(queries), 20)
