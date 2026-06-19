from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APITestCase

from accounts.models import User
from assessments.models import Assessment
from grades.models import (
    GradeCategory,
    GradeCategoryChoices,
    GradeItem,
    GradeItemSourceType,
    GradingPeriod,
    StudentCategoryGrade,
    StudentGradeItemScore,
    transmute_score,
)
from grades.services import compute_final_grade, compute_period_grade, compute_student_category_grade
from subjects.models import Subject
from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, SubjectSchedule


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

    def test_source_linked_grade_item_uses_source_title_and_points(self):
        assessment = Assessment.objects.create(
            title='Quiz 1',
            kind=Assessment.Kind.QUIZ,
            subject=self.subject,
            points_possible=Decimal('25.00'),
        )

        item = GradeItem.objects.create(
            grade_category=self.quiz_category,
            title='',
            points_possible=Decimal('100.00'),
            source_type=GradeItemSourceType.ASSESSMENT,
            assessment=assessment,
        )

        self.assertEqual(item.title, 'Quiz 1')
        self.assertEqual(item.points_possible, Decimal('25.00'))

    def test_item_scores_compute_category_period_and_final_grades(self):
        quiz_one = GradeItem.objects.create(
            grade_category=self.quiz_category,
            title='Quiz 1',
            points_possible=Decimal('20.00'),
        )
        quiz_two = GradeItem.objects.create(
            grade_category=self.quiz_category,
            title='Quiz 2',
            points_possible=Decimal('30.00'),
        )

        StudentGradeItemScore.objects.create(
            grade_item=quiz_one,
            student=self.student,
            raw_score=Decimal('18.00'),
        )
        StudentGradeItemScore.objects.create(
            grade_item=quiz_two,
            student=self.student,
            raw_score=Decimal('27.00'),
        )

        category_grade = StudentCategoryGrade.objects.get(
            student=self.student,
            grade_category=self.quiz_category,
        )

        self.assertTrue(category_grade.is_item_computed)
        self.assertEqual(category_grade.raw_score, Decimal('45.00'))
        self.assertEqual(category_grade.total_score, Decimal('50.00'))
        self.assertEqual(category_grade.transmuted_grade, Decimal('96.00'))
        self.assertEqual(category_grade.weighted_score, Decimal('38.40'))
        self.assertEqual(
            self.student.period_grades.get(subject=self.subject, grading_period=GradingPeriod.PRELIM).raw_score,
            Decimal('38.40'),
        )
        self.assertEqual(
            self.student.final_grades.get(subject=self.subject).prelim_grade,
            Decimal('38.40'),
        )

    def test_missing_item_score_is_not_counted_as_zero(self):
        quiz_one = GradeItem.objects.create(
            grade_category=self.quiz_category,
            title='Quiz 1',
            points_possible=Decimal('20.00'),
        )
        GradeItem.objects.create(
            grade_category=self.quiz_category,
            title='Quiz 2',
            points_possible=Decimal('30.00'),
        )

        StudentGradeItemScore.objects.create(
            grade_item=quiz_one,
            student=self.student,
            raw_score=Decimal('18.00'),
        )

        category_grade = StudentCategoryGrade.objects.get(
            student=self.student,
            grade_category=self.quiz_category,
        )

        self.assertEqual(category_grade.raw_score, Decimal('18.00'))
        self.assertEqual(category_grade.total_score, Decimal('20.00'))

    def test_existing_aggregate_grade_remains_fallback_without_item_scores(self):
        fallback = compute_student_category_grade(
            self.student,
            self.quiz_category,
            Decimal('35.00'),
            Decimal('50.00'),
        )
        GradeItem.objects.create(
            grade_category=self.quiz_category,
            title='Quiz 1',
            points_possible=Decimal('20.00'),
        )

        fallback.refresh_from_db()

        self.assertFalse(fallback.is_item_computed)
        self.assertEqual(fallback.raw_score, Decimal('35.00'))
        self.assertEqual(fallback.total_score, Decimal('50.00'))


class GradeItemAccessTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            username='student2',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.visible_subject = Subject.objects.create(code='CS102', name='Visible')
        self.hidden_subject = Subject.objects.create(code='CS103', name='Hidden')
        school_year = SchoolYear.objects.create(start_year=2026, end_year=2027)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        schedule = SubjectSchedule.objects.create(
            subject=self.visible_subject,
            school_year_semester=term,
            days='MWF',
            start_time='08:00',
            end_time='09:00',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=schedule, student=self.student)
        self.visible_category = GradeCategory.objects.create(
            subject=self.visible_subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Visible Quizzes',
            weight=Decimal('50.00'),
        )
        self.hidden_category = GradeCategory.objects.create(
            subject=self.hidden_subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Hidden Quizzes',
            weight=Decimal('50.00'),
        )
        self.visible_item = GradeItem.objects.create(
            grade_category=self.visible_category,
            title='Visible Quiz',
            points_possible=Decimal('10.00'),
        )
        GradeItem.objects.create(
            grade_category=self.hidden_category,
            title='Hidden Quiz',
            points_possible=Decimal('10.00'),
        )

    def test_student_only_reads_grade_items_for_enrolled_subjects(self):
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/grades/items/')

        self.assertEqual(response.status_code, 200)
        ids = {item['id'] for item in response.data}
        self.assertEqual(ids, {self.visible_item.id})
