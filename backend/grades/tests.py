from decimal import Decimal

from django.test import TestCase

from accounts.models import User
from grades.models import (
    GradeCategory,
    GradeCategoryChoices,
    GradingPeriod,
    StudentCategoryGrade,
    transmute_score,
)
from grades.services import compute_final_grade, compute_period_grade, compute_student_category_grade
from subjects.models import Subject


class GradeComputationTests(TestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            username='student1',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.subject = Subject.objects.create(code='CS101', name='Programming 1')
        self.quiz_category = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Quizzes',
            weight=Decimal('40.00'),
        )
        self.exam_category = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.EXAM,
            name='Prelim Exam',
            weight=Decimal('60.00'),
        )

    def test_transmute_score_uses_sixty_base_formula(self):
        self.assertEqual(transmute_score(Decimal('35'), Decimal('50')), Decimal('88'))

    def test_student_category_grade_computes_transmuted_and_weighted_scores(self):
        grade = compute_student_category_grade(
            student=self.student,
            grade_category=self.quiz_category,
            raw_score=Decimal('35'),
            total_score=Decimal('50'),
        )

        self.assertEqual(grade.transmuted_grade, Decimal('88'))
        self.assertEqual(grade.weighted_score, Decimal('35.2000'))

    def test_period_grade_sums_weighted_category_scores(self):
        compute_student_category_grade(self.student, self.quiz_category, Decimal('35'), Decimal('50'))
        compute_student_category_grade(self.student, self.exam_category, Decimal('45'), Decimal('50'))

        period_grade = compute_period_grade(self.student, self.subject, GradingPeriod.PRELIM)

        self.assertEqual(period_grade.raw_score, Decimal('92.8000000000000'))

    def test_final_grade_averages_available_period_grades(self):
        compute_student_category_grade(self.student, self.quiz_category, Decimal('35'), Decimal('50'))
        compute_student_category_grade(self.student, self.exam_category, Decimal('45'), Decimal('50'))
        compute_period_grade(self.student, self.subject, GradingPeriod.PRELIM)

        final_grade = compute_final_grade(self.student, self.subject)

        self.assertEqual(final_grade.prelim_grade, Decimal('92.80'))
        self.assertEqual(final_grade.final_grade, Decimal('92.80'))

    def test_student_category_grade_model_calculates_on_save(self):
        grade = StudentCategoryGrade.objects.create(
            student=self.student,
            subject=self.subject,
            grade_category=self.quiz_category,
            raw_score=Decimal('35'),
            total_score=Decimal('50'),
        )

        self.assertEqual(grade.transmuted_grade, Decimal('88'))
        self.assertEqual(grade.weighted_score, Decimal('35.2000'))
