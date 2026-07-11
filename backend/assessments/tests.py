from decimal import Decimal

from rest_framework.test import APITestCase

from accounts.models import User
from learning_modules.models import Module, ModuleAccess
from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule

from .models import Assessment, Choice, Question


class MockExamWorkflowTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            username='mock-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.teacher = User.objects.create_user(
            username='mock-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.subject = Subject.objects.create(code='CC104', name='Mock Subject')
        school_year = SchoolYear.objects.create(start_year=2026, end_year=2027)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='MWF',
            start_time='13:00',
            end_time='14:00',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=schedule, student=self.student)
        self.topic = Module.objects.create(
            title='Arrays',
            slug='arrays',
            is_paid=False,
            is_published=True,
        )
        self.topic.subjects.add(self.subject)
        ModuleAccess.objects.create(
            activated_by=self.teacher,
            module=self.topic,
            student=self.student,
        )
        self.assessment = Assessment.objects.create(
            title='Mock Exam',
            kind=Assessment.Kind.MOCK_EXAM,
            module=self.topic,
            subject=self.subject,
            mock_question_count=1,
            max_attempts=2,
            is_published=True,
            counts_toward_grade=False,
        )
        self.question = Question.objects.create(
            assessment=self.assessment,
            question_type=Question.QuestionType.MULTIPLE_CHOICE,
            prompt='Which index is first in a zero-based array?',
            points=Decimal('5.00'),
            order=1,
        )
        self.question.topics.add(self.topic)
        self.correct_choice = Choice.objects.create(
            question=self.question,
            text='0',
            is_correct=True,
            order=1,
        )
        Choice.objects.create(
            question=self.question,
            text='1',
            is_correct=False,
            order=2,
        )

    def test_student_starts_and_scores_mock_exam_from_selected_topic(self):
        self.client.force_authenticate(self.student)

        start_response = self.client.post(
            f'/api/assessments/assessments/{self.assessment.id}/start-mock/',
            {'selected_topics': [self.topic.id]},
            format='json',
        )

        self.assertEqual(start_response.status_code, 201)
        self.assertEqual(start_response.data['selected_question_ids'], [self.question.id])
        attempt_id = start_response.data['id']

        answer_response = self.client.post(
            '/api/assessments/answers/',
            {
                'attempt': attempt_id,
                'question': self.question.id,
                'selected_choice': self.correct_choice.id,
                'text_answer': '',
                'code_answer': '',
            },
            format='json',
        )
        self.assertEqual(answer_response.status_code, 201)

        submit_response = self.client.patch(
            f'/api/assessments/attempts/{attempt_id}/',
            {'is_submitted': True},
            format='json',
        )

        self.assertEqual(submit_response.status_code, 200)
        self.assertEqual(Decimal(submit_response.data['score']), Decimal('5.00'))
