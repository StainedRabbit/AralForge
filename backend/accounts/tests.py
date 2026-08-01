from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase


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
