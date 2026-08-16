from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase

from .models import ProgrammingProblem, TestCase


class ProgrammingProblemSecurityTests(APITestCase):
    def test_student_workspace_never_exposes_hidden_test_cases(self):
        user_model = get_user_model()
        student = user_model.objects.create_user(
            username='coding-security-student', password='testpass123', role=user_model.Role.STUDENT,
        )
        problem = ProgrammingProblem.objects.create(
            title='Safe problem', slug='safe-problem', description='Test', is_published=True,
        )
        TestCase.objects.create(problem=problem, expected_output='visible', is_hidden=False)
        TestCase.objects.create(problem=problem, expected_output='secret', is_hidden=True)
        self.client.force_authenticate(student)
        response = self.client.get(f'/api/coding/problems/{problem.id}/workspace/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['problem']['test_cases']), 1)
        self.assertEqual(response.data['problem']['test_cases'][0]['expected_output'], 'visible')

# Create your tests here.
