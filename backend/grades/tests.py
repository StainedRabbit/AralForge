from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APITestCase


def result_rows(response):
    return response.data.get('results', response.data) if isinstance(response.data, dict) else response.data

from accounts.models import User
from grades.models import (
    GradeCategory,
    GradeCategoryChoices,
    GradeItem,
    GradeItemSourceType,
    GradingTemplate,
    GradingPeriod,
    FinalGrade,
    PeriodGrade,
    StudentCategoryGrade,
    StudentGradeItemScore,
    transmute_score,
)
from grades.services import (
    compute_final_grade,
    compute_period_grade,
    compute_student_category_grade,
    recompute_grade_target_for_students,
)
from learning_modules.models import (
    LearningContextType,
    Module,
    ModuleActivity,
    ModuleActivityAttempt,
    ModuleActivityQuestion,
    ModuleLesson,
    ModuleTopic,
)
from subjects.models import Subject
from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, SubjectSchedule


class GradingTemplateSeedTests(TestCase):
    def test_seed_command_creates_the_aralforge_default_template(self):
        output = StringIO()

        call_command('seed_grading_templates', stdout=output)

        template = GradingTemplate.objects.get(name='Standard AralForge Grading')
        self.assertTrue(template.is_default)
        self.assertEqual(template.items.count(), 16)
        self.assertIn('Seeded the standard AralForge grading template.', output.getvalue())


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

    def test_missing_item_score_withholds_category_total(self):
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

        self.assertIsNone(category_grade.raw_score)
        self.assertIsNone(category_grade.total_score)
        self.assertEqual(category_grade.completion_status, 'PENDING')
        self.assertEqual(category_grade.pending_item_count, 1)

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
        self.schedule = SubjectSchedule.objects.create(
            subject=self.visible_subject,
            school_year_semester=term,
            days='MWF',
            start_time='08:00',
            end_time='09:00',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.student)
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
            schedule=self.schedule,
            grade_category=self.visible_category,
            title='Visible Quiz',
            points_possible=Decimal('10.00'),
        )
        other_section = SubjectSchedule.objects.create(
            subject=self.visible_subject,
            school_year_semester=term,
            days='TTH',
            start_time='11:00',
            end_time='12:00',
            section='B',
        )
        GradeItem.objects.create(
            schedule=other_section,
            grade_category=self.visible_category,
            title='Other section quiz',
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
        ids = {item['id'] for item in result_rows(response)}
        self.assertEqual(ids, {self.visible_item.id})


class ClassScopedGradeTests(APITestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username='teacher', password='testpass123', role=User.Role.TEACHER
        )
        self.student = User.objects.create_user(
            username='student3', password='testpass123', role=User.Role.STUDENT
        )
        self.other_student = User.objects.create_user(
            username='student4', password='testpass123', role=User.Role.STUDENT
        )
        self.subject = Subject.objects.create(code='CS201', name='Class scoped subject')
        other_subject = Subject.objects.create(code='CS202', name='Other subject')
        school_year = SchoolYear.objects.create(start_year=2027, end_year=2028)
        term = SchoolYearSemester.objects.create(school_year=school_year, semester=Semester.FIRST)
        self.schedule_a = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='MWF',
            start_time='08:00',
            end_time='09:00',
            section='A',
        )
        self.schedule_b = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='TTH',
            start_time='09:00',
            end_time='10:00',
            section='B',
        )
        self.other_schedule = SubjectSchedule.objects.create(
            subject=other_subject,
            school_year_semester=term,
            days='MWF',
            start_time='10:00',
            end_time='11:00',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=self.schedule_a, student=self.student)
        ScheduleStudent.objects.create(schedule=self.schedule_b, student=self.student)
        self.category = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Scoped quizzes',
            weight=Decimal('100.00'),
        )

    def test_computations_are_isolated_by_schedule(self):
        item_a = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Quiz A',
            points_possible=Decimal('20.00'),
        )
        item_b = GradeItem.objects.create(
            schedule=self.schedule_b,
            grade_category=self.category,
            title='Quiz B',
            points_possible=Decimal('20.00'),
        )

        StudentGradeItemScore.objects.create(grade_item=item_a, student=self.student, raw_score=Decimal('18.00'))
        StudentGradeItemScore.objects.create(grade_item=item_b, student=self.student, raw_score=Decimal('10.00'))

        self.assertEqual(
            StudentCategoryGrade.objects.get(schedule=self.schedule_a, student=self.student).raw_score,
            Decimal('18.00'),
        )
        self.assertEqual(
            StudentCategoryGrade.objects.get(schedule=self.schedule_b, student=self.student).raw_score,
            Decimal('10.00'),
        )
        self.assertEqual(PeriodGrade.objects.get(schedule=self.schedule_a, student=self.student).raw_score, Decimal('96.00'))
        self.assertEqual(PeriodGrade.objects.get(schedule=self.schedule_b, student=self.student).raw_score, Decimal('80.00'))
        self.assertIsNone(FinalGrade.objects.get(schedule=self.schedule_a, student=self.student).final_grade)
        self.assertIsNone(FinalGrade.objects.get(schedule=self.schedule_b, student=self.student).final_grade)

    def test_api_requires_matching_schedule_and_enrollment(self):
        self.client.force_authenticate(self.teacher)
        base_payload = {
            'grade_category': self.category.id,
            'title': 'Quiz',
            'points_possible': '10.00',
            'source_type': GradeItemSourceType.MANUAL,
        }

        self.assertEqual(self.client.post('/api/grades/items/', base_payload).status_code, 400)
        mismatch = self.client.post(
            '/api/grades/items/', {**base_payload, 'schedule': self.other_schedule.id}
        )
        self.assertEqual(mismatch.status_code, 400)

        item_response = self.client.post(
            '/api/grades/items/', {**base_payload, 'schedule': self.schedule_a.id}
        )
        self.assertEqual(item_response.status_code, 201)
        score_response = self.client.post(
            '/api/grades/item-scores/',
            {'grade_item': item_response.data['id'], 'student': self.other_student.id, 'raw_score': '8.00'},
        )
        self.assertEqual(score_response.status_code, 400)

    def test_batch_score_changes_are_atomic_and_recompute_once_per_student_category(self):
        ScheduleStudent.objects.create(schedule=self.schedule_a, student=self.other_student)
        item = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Batch quiz',
            points_possible=Decimal('20.00'),
        )
        self.client.force_authenticate(self.teacher)

        created = self.client.post(
            '/api/grades/item-scores/batch/',
            {'changes': [
                {
                    'operation': 'upsert', 'grade_item': item.id,
                    'student': self.student.id, 'raw_score': '18.00', 'remarks': 'Strong work',
                },
                {
                    'operation': 'upsert', 'grade_item': item.id,
                    'student': self.other_student.id, 'status': 'EXCUSED', 'remarks': 'Approved',
                },
            ]},
            format='json',
        )

        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.data['updated_count'], 2)
        self.assertEqual(
            StudentGradeItemScore.objects.get(grade_item=item, student=self.student).raw_score,
            Decimal('18.00'),
        )
        self.assertEqual(
            StudentGradeItemScore.objects.get(grade_item=item, student=self.other_student).status,
            StudentGradeItemScore.Status.EXCUSED,
        )

        rejected = self.client.post(
            '/api/grades/item-scores/batch/',
            {'changes': [
                {
                    'operation': 'upsert', 'grade_item': item.id,
                    'student': self.student.id, 'raw_score': '15.00',
                },
                {
                    'operation': 'upsert', 'grade_item': item.id,
                    'student': self.other_student.id, 'raw_score': '25.00',
                },
            ]},
            format='json',
        )

        self.assertEqual(rejected.status_code, 400)
        self.assertEqual(
            StudentGradeItemScore.objects.get(grade_item=item, student=self.student).raw_score,
            Decimal('18.00'),
        )

        deleted = self.client.post(
            '/api/grades/item-scores/batch/',
            {'changes': [{
                'operation': 'delete', 'grade_item': item.id, 'student': self.student.id,
            }]},
            format='json',
        )
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(deleted.data['deleted_count'], 1)
        self.assertFalse(StudentGradeItemScore.objects.filter(grade_item=item, student=self.student).exists())

    def test_batch_cannot_delete_an_automatic_score(self):
        item = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Automatic source score',
            points_possible=Decimal('20.00'),
        )
        StudentGradeItemScore.objects.bulk_create([
            StudentGradeItemScore(
                grade_item=item,
                student=self.student,
                raw_score=Decimal('18.00'),
                origin=StudentGradeItemScore.Origin.AUTOMATIC,
            ),
        ])
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            '/api/grades/item-scores/batch/',
            {'changes': [{
                'operation': 'delete',
                'grade_item': item.id,
                'student': self.student.id,
            }]},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertTrue(StudentGradeItemScore.objects.filter(
            grade_item=item,
            student=self.student,
            origin=StudentGradeItemScore.Origin.AUTOMATIC,
        ).exists())

    def test_batch_query_count_is_bounded_as_rows_grow(self):
        item = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Bounded batch quiz',
            points_possible=Decimal('20.00'),
        )
        students = [
            User.objects.create_user(
                username=f'batch_student_{index:02d}',
                role=User.Role.STUDENT,
            )
            for index in range(25)
        ]
        ScheduleStudent.objects.bulk_create([
            ScheduleStudent(schedule=self.schedule_a, student=student)
            for student in students
        ])
        self.client.force_authenticate(self.teacher)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.post(
                '/api/grades/item-scores/batch/',
                {'changes': [
                    {
                        'operation': 'upsert',
                        'grade_item': item.id,
                        'student': student.id,
                        'raw_score': '17.00',
                    }
                    for student in students
                ]},
                format='json',
            )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['updated_count'], 25)
        self.assertLessEqual(len(queries), 30)

    def test_score_sheet_creates_complete_roster_and_coerces_blank_to_zero(self):
        ScheduleStudent.objects.create(schedule=self.schedule_a, student=self.other_student)
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            '/api/grades/items/score-sheet/',
            {
                'schedule': self.schedule_a.id,
                'grade_category': self.category.id,
                'title': 'Quiz 1',
                'date': '2027-08-02',
                'points_possible': '10.00',
                'records': [
                    {'student': self.student.id, 'raw_score': '', 'status': 'GRADED'},
                    {
                        'student': self.other_student.id,
                        'raw_score': '',
                        'status': 'EXCUSED',
                        'remarks': 'Approved absence',
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        item = GradeItem.objects.get(title='Quiz 1')
        self.assertEqual(str(item.date), '2027-08-02')
        zero = StudentGradeItemScore.objects.get(grade_item=item, student=self.student)
        excused = StudentGradeItemScore.objects.get(grade_item=item, student=self.other_student)
        self.assertEqual(zero.raw_score, Decimal('0.00'))
        self.assertEqual(zero.status, StudentGradeItemScore.Status.GRADED)
        self.assertEqual(excused.status, StudentGradeItemScore.Status.EXCUSED)
        self.assertIsNone(excused.raw_score)
        self.assertEqual(response.data['counts']['zero_count'], 1)
        self.assertEqual(response.data['counts']['excused_count'], 1)
        self.assertEqual(
            StudentCategoryGrade.objects.get(
                schedule=self.schedule_a,
                student=self.student,
                grade_category=self.category,
            ).raw_score,
            Decimal('0.00'),
        )

    def test_score_sheet_start_creates_pending_rows_ordered_by_last_name(self):
        self.student.first_name = 'Learner'
        self.student.last_name = '000'
        self.student.save(update_fields=['first_name', 'last_name'])
        students = [self.student] + [
            User.objects.create_user(
                username=f'score_sheet_student_{index:02d}',
                role=User.Role.STUDENT,
                first_name='Learner',
                last_name=f'{index:03d}',
            )
            for index in range(1, 50)
        ]
        ScheduleStudent.objects.bulk_create([
            ScheduleStudent(schedule=self.schedule_a, student=student)
            for student in students[1:]
        ])
        self.client.force_authenticate(self.teacher)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.post(
                '/api/grades/items/score-sheet/start/',
                {
                    'schedule': self.schedule_a.id,
                    'grade_category': self.category.id,
                    'title': 'Runner quiz',
                    'date': '2027-08-03',
                    'points_possible': '10.00',
                },
                format='json',
            )

        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(
            [row['student'] for row in response.data['rows']],
            [student.id for student in students],
        )
        self.assertTrue(all(row['score_id'] is None for row in response.data['rows']))
        self.assertFalse(StudentGradeItemScore.objects.filter(
            grade_item_id=response.data['item']['id'],
        ).exists())
        self.assertEqual(GradeItem.objects.filter(
            schedule=self.schedule_a,
            title='Runner quiz',
            source_type=GradeItemSourceType.MANUAL,
        ).count(), 1)
        category_grades = StudentCategoryGrade.objects.filter(
            schedule=self.schedule_a,
            grade_category=self.category,
            student__in=students,
        )
        self.assertEqual(category_grades.count(), 50)
        self.assertFalse(category_grades.exclude(
            completion_status='PENDING',
            pending_item_count=1,
        ).exists())
        period_grades = PeriodGrade.objects.filter(
            schedule=self.schedule_a,
            grading_period=GradingPeriod.PRELIM,
            student__in=students,
        )
        self.assertEqual(period_grades.count(), 50)
        self.assertFalse(period_grades.exclude(completion_status='PENDING').exists())
        final_grades = FinalGrade.objects.filter(
            schedule=self.schedule_a,
            student__in=students,
        )
        self.assertEqual(final_grades.count(), 50)
        self.assertFalse(final_grades.exclude(completion_status='PENDING').exists())
        self.assertLessEqual(len(queries), 40)

    def test_score_sheet_details_update_all_fields_and_keep_scores_with_bounded_queries(self):
        midterm_category = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.MIDTERM,
            category=GradeCategoryChoices.ACTIVITY,
            name='Midterm activities',
            weight=Decimal('100.00'),
        )
        attendance_category = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.ATTENDANCE,
            name='Attendance',
            weight=Decimal('0.00'),
        )
        foreign_category = GradeCategory.objects.create(
            subject=self.other_schedule.subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Other subject quizzes',
            weight=Decimal('100.00'),
        )
        students = [self.student] + [
            User.objects.create_user(
                username=f'edit_sheet_student_{index:02d}',
                role=User.Role.STUDENT,
            )
            for index in range(1, 50)
        ]
        ScheduleStudent.objects.bulk_create([
            ScheduleStudent(schedule=self.schedule_a, student=student)
            for student in students[1:]
        ])
        item = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Original activity',
            date='2027-08-03',
            points_possible=Decimal('10.00'),
        )
        StudentGradeItemScore.objects.create(
            grade_item=item,
            student=self.student,
            raw_score=Decimal('8.00'),
        )
        self.client.force_authenticate(self.teacher)
        url = f'/api/grades/items/{item.id}/score-sheet/'

        with CaptureQueriesContext(connection) as queries:
            updated = self.client.patch(url, {
                'title': 'Updated activity',
                'date': '2027-08-04',
                'points_possible': '12.00',
                'grade_category': midterm_category.id,
            }, format='json')

        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data['item']['title'], 'Updated activity')
        self.assertEqual(updated.data['item']['date'], '2027-08-04')
        self.assertEqual(updated.data['item']['points_possible'], '12.00')
        self.assertEqual(updated.data['item']['grade_category'], midterm_category.id)
        self.assertEqual(len(updated.data['rows']), 50)
        self.assertLessEqual(len(queries), 65)
        score = StudentGradeItemScore.objects.get(grade_item=item, student=self.student)
        self.assertEqual(score.raw_score, Decimal('8.00'))
        self.assertFalse(StudentCategoryGrade.objects.filter(
            schedule=self.schedule_a,
            grade_category=self.category,
        ).exists())
        moved_grade = StudentCategoryGrade.objects.get(
            schedule=self.schedule_a,
            grade_category=midterm_category,
            student=self.student,
        )
        self.assertEqual(moved_grade.raw_score, Decimal('8.00'))
        self.assertEqual(moved_grade.total_score, Decimal('12.00'))
        prelim_grade = PeriodGrade.objects.get(
            schedule=self.schedule_a,
            grading_period=GradingPeriod.PRELIM,
            student=self.student,
        )
        midterm_grade = PeriodGrade.objects.get(
            schedule=self.schedule_a,
            grading_period=GradingPeriod.MIDTERM,
            student=self.student,
        )
        self.assertEqual(prelim_grade.completion_status, 'PENDING')
        self.assertIsNone(prelim_grade.raw_score)
        self.assertEqual(midterm_grade.completion_status, 'COMPLETE')
        final_grade = FinalGrade.objects.get(schedule=self.schedule_a, student=self.student)
        self.assertEqual(final_grade.completion_status, 'PENDING')
        self.assertIsNone(final_grade.prelim_grade)
        self.assertEqual(final_grade.midterm_grade, midterm_grade.raw_score)

        too_small = self.client.patch(url, {'points_possible': '7.00'}, format='json')
        self.assertEqual(too_small.status_code, 400)
        self.assertIn('points_possible', too_small.data)
        gradebook_too_small = self.client.patch(
            f'/api/grades/items/{item.id}/',
            {'points_possible': '7.00'},
            format='json',
        )
        self.assertEqual(gradebook_too_small.status_code, 400)
        self.assertIn('points_possible', gradebook_too_small.data)
        attendance = self.client.patch(
            url, {'grade_category': attendance_category.id}, format='json',
        )
        self.assertEqual(attendance.status_code, 400)
        foreign = self.client.patch(
            url, {'grade_category': foreign_category.id}, format='json',
        )
        self.assertEqual(foreign.status_code, 400)
        immutable = self.client.patch(
            url, {'schedule': self.schedule_b.id}, format='json',
        )
        self.assertEqual(immutable.status_code, 400)
        item.refresh_from_db()
        self.assertEqual(item.points_possible, Decimal('12.00'))
        self.assertEqual(item.grade_category, midterm_category)

        self.client.force_authenticate(self.student)
        forbidden = self.client.patch(url, {'title': 'Student edit'}, format='json')
        self.assertEqual(forbidden.status_code, 403)
        forbidden_delete = self.client.delete(url)
        self.assertEqual(forbidden_delete.status_code, 403)
        self.assertTrue(GradeItem.objects.filter(pk=item.pk).exists())

        self.client.force_authenticate(self.teacher)
        GradeItem.objects.filter(pk=item.pk).update(source_type=GradeItemSourceType.ATTENDANCE)
        linked = self.client.patch(url, {'title': 'Linked edit'}, format='json')
        self.assertEqual(linked.status_code, 400)
        linked_delete = self.client.delete(url)
        self.assertEqual(linked_delete.status_code, 400)
        self.assertTrue(GradeItem.objects.filter(pk=item.pk).exists())

        GradeItem.objects.filter(pk=item.pk).update(source_type=GradeItemSourceType.MANUAL)
        SubjectSchedule.objects.filter(pk=self.schedule_a.pk).update(is_active=False)
        archived = self.client.patch(url, {'title': 'Archived edit'}, format='json')
        archived_delete = self.client.delete(url)
        self.assertEqual(archived.status_code, 400)
        self.assertEqual(archived_delete.status_code, 400)
        self.assertTrue(GradeItem.objects.filter(pk=item.pk).exists())

    def test_deleting_score_sheet_cascades_scores_and_recomputes_with_bounded_queries(self):
        students = [self.student] + [
            User.objects.create_user(
                username=f'delete_sheet_student_{index:02d}',
                role=User.Role.STUDENT,
            )
            for index in range(1, 50)
        ]
        ScheduleStudent.objects.bulk_create([
            ScheduleStudent(schedule=self.schedule_a, student=student)
            for student in students[1:]
        ])
        item = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Delete activity',
            date='2027-08-03',
            points_possible=Decimal('10.00'),
        )
        StudentGradeItemScore.objects.bulk_create([
            StudentGradeItemScore(
                grade_item=item,
                student=student,
                raw_score=Decimal('8.00'),
            )
            for student in students
        ])
        recompute_grade_target_for_students(
            [student.id for student in students],
            self.category,
            self.schedule_a,
        )
        self.assertEqual(StudentCategoryGrade.objects.filter(
            schedule=self.schedule_a,
            grade_category=self.category,
            completion_status='COMPLETE',
        ).count(), 50)
        item_id = item.id
        self.client.force_authenticate(self.teacher)

        with CaptureQueriesContext(connection) as queries:
            deleted = self.client.delete(f'/api/grades/items/{item_id}/score-sheet/')

        self.assertEqual(deleted.status_code, 204)
        self.assertLessEqual(len(queries), 40)
        self.assertFalse(GradeItem.objects.filter(pk=item_id).exists())
        self.assertFalse(StudentGradeItemScore.objects.filter(grade_item_id=item_id).exists())
        self.assertFalse(StudentCategoryGrade.objects.filter(
            schedule=self.schedule_a,
            grade_category=self.category,
            student__in=students,
        ).exists())
        period_grades = PeriodGrade.objects.filter(
            schedule=self.schedule_a,
            grading_period=GradingPeriod.PRELIM,
            student__in=students,
        )
        self.assertEqual(period_grades.count(), 50)
        self.assertFalse(period_grades.exclude(completion_status='PENDING').exists())

    def test_score_sheet_mark_saves_edits_excuses_and_deletes_one_student(self):
        ScheduleStudent.objects.create(schedule=self.schedule_a, student=self.other_student)
        item = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Runner quiz',
            date='2027-08-03',
            points_possible=Decimal('10.00'),
        )
        self.client.force_authenticate(self.teacher)
        url = f'/api/grades/items/{item.id}/mark/'

        created = self.client.put(
            url,
            {'student': self.student.id, 'raw_score': '8.50', 'status': 'GRADED'},
            format='json',
        )
        self.assertEqual(created.status_code, 200, created.data)
        self.assertEqual(created.data['raw_score'], '8.50')
        self.assertEqual(
            StudentCategoryGrade.objects.get(
                schedule=self.schedule_a,
                student=self.student,
                grade_category=self.category,
            ).raw_score,
            Decimal('8.50'),
        )

        zero = self.client.put(
            url,
            {'student': self.student.id, 'raw_score': '0', 'status': 'GRADED'},
            format='json',
        )
        self.assertEqual(zero.status_code, 200, zero.data)
        self.assertEqual(zero.data['raw_score'], '0.00')
        self.assertEqual(StudentGradeItemScore.objects.filter(
            grade_item=item,
            student=self.student,
        ).count(), 1)

        excused = self.client.put(
            url,
            {
                'student': self.other_student.id,
                'status': 'EXCUSED',
                'remarks': 'Approved absence',
            },
            format='json',
        )
        self.assertEqual(excused.status_code, 200, excused.data)
        self.assertEqual(excused.data['status'], 'EXCUSED')
        self.assertIsNone(excused.data['raw_score'])

        deleted = self.client.delete(
            url,
            {'student': self.student.id},
            format='json',
        )
        self.assertEqual(deleted.status_code, 204)
        self.assertFalse(StudentGradeItemScore.objects.filter(
            grade_item=item,
            student=self.student,
        ).exists())

    def test_score_sheet_mark_validates_pending_scores_and_active_roster(self):
        item = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Runner validation',
            date='2027-08-03',
            points_possible=Decimal('10.00'),
        )
        self.client.force_authenticate(self.teacher)
        url = f'/api/grades/items/{item.id}/mark/'

        blank = self.client.put(
            url,
            {'student': self.student.id, 'raw_score': '', 'status': 'GRADED'},
            format='json',
        )
        self.assertEqual(blank.status_code, 400)
        too_high = self.client.put(
            url,
            {'student': self.student.id, 'raw_score': '11', 'status': 'GRADED'},
            format='json',
        )
        self.assertEqual(too_high.status_code, 400)
        no_reason = self.client.put(
            url,
            {'student': self.student.id, 'status': 'EXCUSED', 'remarks': ''},
            format='json',
        )
        self.assertEqual(no_reason.status_code, 400)
        inactive = self.client.put(
            url,
            {'student': self.other_student.id, 'raw_score': '8', 'status': 'GRADED'},
            format='json',
        )
        self.assertEqual(inactive.status_code, 400)
        self.assertFalse(StudentGradeItemScore.objects.filter(grade_item=item).exists())

    def test_score_sheet_validation_is_atomic(self):
        ScheduleStudent.objects.create(schedule=self.schedule_a, student=self.other_student)
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            '/api/grades/items/score-sheet/',
            {
                'schedule': self.schedule_a.id,
                'grade_category': self.category.id,
                'title': 'Invalid quiz',
                'date': '2027-08-02',
                'points_possible': '10.00',
                'records': [
                    {'student': self.student.id, 'raw_score': '8.50'},
                    {'student': self.other_student.id, 'raw_score': '-1'},
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(GradeItem.objects.filter(title='Invalid quiz').exists())
        self.assertFalse(StudentGradeItemScore.objects.filter(grade_item__title='Invalid quiz').exists())

    def test_score_sheet_update_preserves_inactive_history_and_requires_current_roster(self):
        inactive_enrollment = ScheduleStudent.objects.create(
            schedule=self.schedule_a,
            student=self.other_student,
        )
        item = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Quiz history',
            date='2027-08-01',
            points_possible=Decimal('10.00'),
        )
        StudentGradeItemScore.objects.create(
            grade_item=item,
            student=self.student,
            raw_score=Decimal('5.00'),
        )
        StudentGradeItemScore.objects.create(
            grade_item=item,
            student=self.other_student,
            raw_score=Decimal('7.00'),
        )
        inactive_enrollment.set_active(False, self.teacher)
        self.client.force_authenticate(self.teacher)

        stale = self.client.put(
            f'/api/grades/items/{item.id}/roster/',
            {'records': [
                {'student': self.student.id, 'raw_score': '9.00'},
                {'student': self.other_student.id, 'raw_score': '1.00'},
            ]},
            format='json',
        )
        self.assertEqual(stale.status_code, 400)

        updated = self.client.put(
            f'/api/grades/items/{item.id}/roster/',
            {'records': [{'student': self.student.id, 'raw_score': '9.00'}]},
            format='json',
        )
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(
            StudentGradeItemScore.objects.get(grade_item=item, student=self.student).raw_score,
            Decimal('9.00'),
        )
        self.assertEqual(
            StudentGradeItemScore.objects.get(grade_item=item, student=self.other_student).raw_score,
            Decimal('7.00'),
        )
        inactive_row = next(row for row in updated.data['rows'] if row['student'] == self.other_student.id)
        self.assertFalse(inactive_row['is_active'])

    def test_students_cannot_read_class_score_sheet_rosters(self):
        item = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Private roster',
            date='2027-08-01',
            points_possible=Decimal('10.00'),
        )
        self.client.force_authenticate(self.student)

        response = self.client.get(f'/api/grades/items/{item.id}/roster/')

        self.assertEqual(response.status_code, 403)

    def test_score_sheet_supports_non_attendance_categories_and_filters(self):
        self.client.force_authenticate(self.teacher)
        categories = [self.category]
        for category_type in (
            GradeCategoryChoices.EXAM,
            GradeCategoryChoices.ACTIVITY,
            GradeCategoryChoices.OTHER,
        ):
            categories.append(GradeCategory.objects.create(
                subject=self.subject,
                grading_period=GradingPeriod.PRELIM,
                category=category_type,
                name=f'{category_type.title()} scores',
                weight=Decimal('0.00'),
            ))

        created_ids = []
        for index, category in enumerate(categories, start=1):
            response = self.client.post(
                '/api/grades/items/score-sheet/',
                {
                    'schedule': self.schedule_a.id,
                    'grade_category': category.id,
                    'title': f'Sheet {index}',
                    'date': '2027-08-03',
                    'points_possible': '5.00',
                    'records': [{'student': self.student.id, 'raw_score': '5.00'}],
                },
                format='json',
            )
            self.assertEqual(response.status_code, 201)
            created_ids.append(response.data['item']['id'])

        filtered = self.client.get(
            f'/api/grades/items/?schedule={self.schedule_a.id}'
            '&source_type=MANUAL&period=PRELIM&date=2027-08-03'
        )
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual({item['id'] for item in result_rows(filtered)}, set(created_ids))

    def test_score_sheet_rejects_attendance_categories_and_archived_classes(self):
        attendance_category = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.ATTENDANCE,
            name='Attendance',
            weight=Decimal('0.00'),
        )
        self.client.force_authenticate(self.teacher)
        payload = {
            'schedule': self.schedule_a.id,
            'grade_category': attendance_category.id,
            'title': 'Not score entry',
            'date': '2027-08-03',
            'points_possible': '1.00',
            'records': [{'student': self.student.id, 'raw_score': '1.00'}],
        }

        attendance_response = self.client.post(
            '/api/grades/items/score-sheet/', payload, format='json'
        )
        self.assertEqual(attendance_response.status_code, 400)
        self.schedule_a.archive(self.teacher)
        archived_response = self.client.post(
            '/api/grades/items/score-sheet/',
            {**payload, 'grade_category': self.category.id},
            format='json',
        )
        self.assertEqual(archived_response.status_code, 400)

    def test_deleting_schedule_preserves_grade_history_as_unassigned(self):
        item = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Preserved quiz',
            points_possible=Decimal('10.00'),
        )
        StudentGradeItemScore.objects.create(grade_item=item, student=self.student, raw_score=Decimal('9.00'))

        self.schedule_a.delete()

        item.refresh_from_db()
        self.assertIsNone(item.schedule_id)
        self.assertTrue(StudentCategoryGrade.objects.filter(student=self.student, schedule__isnull=True).exists())
        self.assertTrue(PeriodGrade.objects.filter(student=self.student, schedule__isnull=True).exists())
        self.assertTrue(FinalGrade.objects.filter(student=self.student, schedule__isnull=True).exists())

    def test_moving_item_recomputes_old_and_new_class_totals(self):
        ScheduleStudent.objects.create(schedule=self.schedule_a, student=self.other_student)
        item = GradeItem.objects.create(
            schedule=self.schedule_a,
            grade_category=self.category,
            title='Movable quiz',
            points_possible=Decimal('10.00'),
        )
        StudentGradeItemScore.objects.create(grade_item=item, student=self.student, raw_score=Decimal('9.00'))
        self.client.force_authenticate(self.teacher)

        response = self.client.patch(
            f'/api/grades/items/{item.id}/',
            {'schedule': self.schedule_b.id},
        )

        self.assertEqual(response.status_code, 200)
        self.assertFalse(StudentCategoryGrade.objects.filter(schedule=self.schedule_a, student=self.student).exists())
        self.assertFalse(StudentCategoryGrade.objects.filter(
            schedule=self.schedule_a,
            student=self.other_student,
        ).exists())
        self.assertEqual(
            StudentCategoryGrade.objects.get(schedule=self.schedule_b, student=self.student).raw_score,
            Decimal('9.00'),
        )

        GradeItem.objects.get(pk=item.pk).delete()

        self.assertFalse(StudentCategoryGrade.objects.filter(
            schedule=self.schedule_b,
            student=self.student,
        ).exists())

    def test_excused_item_resolves_without_adding_to_denominator(self):
        first = GradeItem.objects.create(
            schedule=self.schedule_a, grade_category=self.category, title='Required one',
            points_possible=Decimal('10.00'),
        )
        second = GradeItem.objects.create(
            schedule=self.schedule_a, grade_category=self.category, title='Required two',
            points_possible=Decimal('20.00'),
        )
        StudentGradeItemScore.objects.create(
            grade_item=first, student=self.student, raw_score=Decimal('8.00'),
        )
        StudentGradeItemScore.objects.create(
            grade_item=second, student=self.student, status=StudentGradeItemScore.Status.EXCUSED,
            origin=StudentGradeItemScore.Origin.OVERRIDE, override_reason='Approved absence',
        )

        grade = StudentCategoryGrade.objects.get(
            schedule=self.schedule_a, student=self.student, grade_category=self.category,
        )
        self.assertEqual(grade.completion_status, 'COMPLETE')
        self.assertEqual(grade.raw_score, Decimal('8.00'))
        self.assertEqual(grade.total_score, Decimal('10.00'))


class MainActivityBulkAssignmentApiTests(APITestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username='bulk-teacher', password='testpass123', role=User.Role.TEACHER,
        )
        self.student = User.objects.create_user(
            username='bulk-student', password='testpass123', role=User.Role.STUDENT,
        )
        self.subject = Subject.objects.create(code='BULK101', name='Bulk assignment')
        self.other_subject = Subject.objects.create(code='BULK102', name='Other subject')
        school_year = SchoolYear.objects.create(start_year=2030, end_year=2031)
        term = SchoolYearSemester.objects.create(school_year=school_year, semester=Semester.FIRST)
        self.schedule_a = SubjectSchedule.objects.create(
            subject=self.subject, school_year_semester=term, days='MWF',
            start_time='08:00', end_time='09:00', section='A',
        )
        self.schedule_b = SubjectSchedule.objects.create(
            subject=self.subject, school_year_semester=term, days='TTH',
            start_time='09:00', end_time='10:00', section='B',
        )
        self.other_schedule = SubjectSchedule.objects.create(
            subject=self.other_subject, school_year_semester=term, days='MWF',
            start_time='10:00', end_time='11:00', section='C',
        )
        self.prelim_quiz = GradeCategory.objects.create(
            subject=self.subject, grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ, name='Prelim quizzes', weight=Decimal('100.00'),
        )
        self.midterm_quiz = GradeCategory.objects.create(
            subject=self.subject, grading_period=GradingPeriod.MIDTERM,
            category=GradeCategoryChoices.QUIZ, name='Midterm quizzes', weight=Decimal('100.00'),
        )
        self.exam_category = GradeCategory.objects.create(
            subject=self.subject, grading_period=GradingPeriod.FINAL,
            category=GradeCategoryChoices.EXAM, name='Final exam', weight=Decimal('100.00'),
        )
        module = Module.objects.create(
            title='Bulk module', slug='bulk-module', subject=self.subject,
        )
        topic = ModuleTopic.objects.create(module=module, title='Bulk topic')
        lesson = ModuleLesson.objects.create(topic=topic, title='Bulk lesson')
        self.activity = ModuleActivity.objects.create(
            module=module, lesson=lesson, title='Main quiz', instructions='Answer every item.',
            points_possible=Decimal('10.00'), grading_period=GradingPeriod.PRELIM, is_published=True,
        )
        ModuleActivityQuestion.objects.create(
            activity=self.activity,
            question_type=ModuleActivityQuestion.QuestionType.FILL_BLANK,
            prompt='Type ten.', points=Decimal('10.00'), correct_text_answers=['10'],
        )
        self.client.force_authenticate(self.teacher)

    def assign(self, rows):
        return self.client.post(
            '/api/grades/items/assign-main-activity/',
            {'module_activity': self.activity.id, 'assignments': rows},
            format='json',
        )

    def test_bulk_assignment_creates_updates_and_is_idempotent(self):
        rows = [
            {'schedule': self.schedule_a.id, 'grade_category': self.prelim_quiz.id},
            {'schedule': self.schedule_b.id, 'grade_category': self.prelim_quiz.id},
        ]
        created = self.assign(rows)
        repeated = self.assign(rows)

        self.assertEqual(created.status_code, 200)
        self.assertEqual(created.data['created_count'], 2)
        self.assertEqual(created.data['updated_count'], 0)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.data['created_count'], 0)
        self.assertEqual(repeated.data['updated_count'], 2)
        self.assertEqual(GradeItem.objects.filter(module_activity=self.activity).count(), 2)

    def test_bulk_assignment_rejects_category_from_another_period(self):
        self.assign([
            {'schedule': self.schedule_a.id, 'grade_category': self.prelim_quiz.id},
            {'schedule': self.schedule_b.id, 'grade_category': self.prelim_quiz.id},
        ])

        response = self.assign([
            {'schedule': self.schedule_a.id, 'grade_category': self.midterm_quiz.id},
        ])

        self.assertEqual(response.status_code, 400)
        self.assertEqual(
            GradeItem.objects.get(schedule=self.schedule_a, module_activity=self.activity).grade_category,
            self.prelim_quiz,
        )
        self.assertEqual(
            GradeItem.objects.get(schedule=self.schedule_b, module_activity=self.activity).grade_category,
            self.prelim_quiz,
        )

    def test_one_invalid_row_rolls_back_entire_bulk_assignment(self):
        response = self.assign([
            {'schedule': self.schedule_a.id, 'grade_category': self.prelim_quiz.id},
            {'schedule': self.schedule_b.id, 'grade_category': self.exam_category.id},
        ])

        self.assertEqual(response.status_code, 400)
        self.assertFalse(GradeItem.objects.filter(module_activity=self.activity).exists())

    def test_rejects_wrong_subject_archived_duplicate_and_non_teacher(self):
        wrong_subject = self.assign([
            {'schedule': self.other_schedule.id, 'grade_category': self.prelim_quiz.id},
        ])
        duplicate = self.assign([
            {'schedule': self.schedule_a.id, 'grade_category': self.prelim_quiz.id},
            {'schedule': self.schedule_a.id, 'grade_category': self.midterm_quiz.id},
        ])
        self.schedule_b.archive(self.teacher)
        archived = self.assign([
            {'schedule': self.schedule_b.id, 'grade_category': self.prelim_quiz.id},
        ])
        self.client.force_authenticate(self.student)
        forbidden = self.assign([
            {'schedule': self.schedule_a.id, 'grade_category': self.prelim_quiz.id},
        ])

        self.assertEqual(wrong_subject.status_code, 400)
        self.assertEqual(duplicate.status_code, 400)
        self.assertEqual(archived.status_code, 400)
        self.assertEqual(forbidden.status_code, 403)
        self.assertFalse(GradeItem.objects.filter(module_activity=self.activity).exists())

    def test_gradebook_excludes_other_class_and_personal_activity_attempts(self):
        ScheduleStudent.objects.create(schedule=self.schedule_a, student=self.student)
        ScheduleStudent.objects.create(schedule=self.schedule_b, student=self.student)
        assigned = self.assign([
            {'schedule': self.schedule_a.id, 'grade_category': self.prelim_quiz.id},
            {'schedule': self.schedule_b.id, 'grade_category': self.prelim_quiz.id},
        ])
        item_a = next(
            item for item in assigned.data['items']
            if item['schedule'] == self.schedule_a.id
        )
        class_a = ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule_a,
            attempt_number=1,
            score=Decimal('4.00'),
            max_score=Decimal('10.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
        )
        ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule_b,
            attempt_number=1,
            score=Decimal('9.00'),
            max_score=Decimal('10.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
        )
        ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.PERSONAL,
            attempt_number=1,
            score=Decimal('10.00'),
            max_score=Decimal('10.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
        )

        response = self.client.get(
            f'/api/grades/gradebook/?schedule={self.schedule_a.id}'
            f'&period=PRELIM&item={item_a["id"]}',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [attempt['id'] for attempt in response.data['activity_attempts']],
            [class_a.id],
        )
        self.assertEqual(response.data['status_counts']['ONLINE'], 1)
        self.assertNotIn('question_snapshot', response.data['activity_attempts'][0])


class ScalableTeacherGradesApiTests(APITestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username='grades_teacher', password='testpass123', role=User.Role.TEACHER,
        )
        self.student = User.objects.create_user(
            username='overview_student', password='testpass123', role=User.Role.STUDENT,
        )
        school_year = SchoolYear.objects.create(start_year=2030, end_year=2031)
        self.term = SchoolYearSemester.objects.create(
            school_year=school_year, semester=Semester.FIRST,
        )
        self.schedules = []
        for index in range(13):
            subject = Subject.objects.create(
                code=f'PAGE{index:02d}', name=f'Progressive subject {index:02d}',
            )
            self.schedules.append(SubjectSchedule.objects.create(
                subject=subject,
                school_year_semester=self.term,
                days='MWF',
                start_time='08:00',
                end_time='09:00',
                section=f'S{index:02d}',
            ))
        self.category = GradeCategory.objects.create(
            subject=self.schedules[0].subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Progressive quizzes',
            weight=Decimal('100.00'),
        )
        self.item = GradeItem.objects.create(
            schedule=self.schedules[0],
            grade_category=self.category,
            title='Progressive quiz',
            points_possible=Decimal('10.00'),
        )
        self.client.force_authenticate(self.teacher)

    def test_overview_has_stable_twelve_card_pages_and_accurate_aggregates(self):
        ScheduleStudent.objects.create(schedule=self.schedules[0], student=self.student)

        with CaptureQueriesContext(connection) as queries:
            first = self.client.get('/api/grades/teacher-overview/?limit=12&offset=0')
        second = self.client.get('/api/grades/teacher-overview/?limit=12&offset=12')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data['count'], 13)
        self.assertEqual(len(first.data['results']), 12)
        self.assertEqual(first.data['next'], 12)
        self.assertEqual(len(second.data['results']), 1)
        self.assertIsNone(second.data['next'])
        self.assertEqual(first.data['summary']['active_classes'], 13)
        self.assertEqual(first.data['summary']['active_enrollments'], 1)
        self.assertEqual(first.data['summary']['grade_items'], 1)
        self.assertLessEqual(len(queries), 25)

    def test_overview_search_finds_a_class_outside_the_first_page(self):
        response = self.client.get('/api/grades/teacher-overview/?search=PAGE12&limit=12')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['schedule']['id'], self.schedules[12].id)

    def test_student_cannot_access_teacher_overview_or_gradebook(self):
        self.client.force_authenticate(self.student)

        overview = self.client.get('/api/grades/teacher-overview/')
        gradebook = self.client.get(f'/api/grades/gradebook/?schedule={self.schedules[0].id}')

        self.assertEqual(overview.status_code, 403)
        self.assertEqual(gradebook.status_code, 403)

    def test_gradebook_paginates_roster_and_searches_unloaded_students(self):
        students = []
        for index in range(55):
            student = User.objects.create_user(
                username=f'roster_{index:03d}',
                password='testpass123',
                role=User.Role.STUDENT,
                first_name='Learner',
                last_name=f'{index:03d}',
            )
            students.append(student)
            ScheduleStudent.objects.create(schedule=self.schedules[0], student=student)

        with CaptureQueriesContext(connection) as queries:
            first = self.client.get(
                f'/api/grades/gradebook/?schedule={self.schedules[0].id}&period=PRELIM&limit=50',
            )
        second = self.client.get(
            f'/api/grades/gradebook/?schedule={self.schedules[0].id}&period=PRELIM&limit=50&offset=50',
        )
        searched = self.client.get(
            f'/api/grades/gradebook/?schedule={self.schedules[0].id}&search=roster_054&limit=50',
        )

        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data['count'], 55)
        self.assertEqual(first.data['total_count'], 55)
        self.assertEqual(len(first.data['enrollments']), 50)
        self.assertEqual(first.data['next'], 50)
        self.assertEqual(len(second.data['enrollments']), 5)
        self.assertIsNone(second.data['next'])
        loaded_students = [row['student'] for row in first.data['enrollments'] + second.data['enrollments']]
        self.assertEqual(loaded_students, [student.id for student in students])
        self.assertLessEqual(len(queries), 30)
        self.assertEqual(searched.data['count'], 1)
        self.assertEqual(searched.data['enrollments'][0]['student'], students[-1].id)
