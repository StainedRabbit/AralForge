import csv
from datetime import time
from io import StringIO

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework.test import APITestCase

from accounts.models import StudentProfile, User
from grades.models import FinalGrade, GradeCategory, GradeItem, PeriodGrade, StudentCategoryGrade, StudentGradeItemScore
from .models import SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule, ScheduleStudent


class DetailedGradesExportTests(APITestCase):
    def setUp(self):
        teacher = User.objects.create_user(username='export-teacher', role='TEACHER')
        self.client.force_authenticate(teacher)
        subject = Subject.objects.create(code='CSV', name='Export subject')
        term = SchoolYearSemester.objects.create(
            school_year=SchoolYear.objects.create(start_year=2026, end_year=2027), semester=Semester.FIRST)
        self.schedule = SubjectSchedule.objects.create(subject=subject, school_year_semester=term,
                                                      days='MO', start_time=time(8), end_time=time(9), section='A')
        self.students = User.objects.bulk_create([
            User(username=f'CSV-{i:03}', first_name='Élise', middle_name='De Leon', last_name=f'Student {i:03}')
            for i in range(51)])
        StudentProfile.objects.bulk_create([StudentProfile(user=u, student_number=u.username) for u in self.students])
        ScheduleStudent.objects.bulk_create([ScheduleStudent(schedule=self.schedule, student=u, is_active=i != 50)
                                            for i, u in enumerate(self.students)])
        self.categories = GradeCategory.objects.bulk_create([
            GradeCategory(subject=subject, grading_period=p, category=c, name=c, weight=100)
            for p, c in zip(('PRELIM', 'MIDTERM', 'PREFINAL', 'FINAL'), ('QUIZ', 'EXAM', 'ACTIVITY', 'ATTENDANCE'))])
        self.items = GradeItem.objects.bulk_create([
            GradeItem(schedule=self.schedule, grade_category=c, title='Same, "title"', points_possible=20)
            for c in self.categories] + [GradeItem(schedule=self.schedule, grade_category=self.categories[0],
                                                 title='Same, "title"', points_possible=20)])
        StudentGradeItemScore.objects.bulk_create([
            StudentGradeItemScore(student=self.students[0], grade_item=self.items[0], raw_score=0, origin='OVERRIDE'),
            StudentGradeItemScore(student=self.students[0], grade_item=self.items[1], status='EXCUSED'),
        ])
        StudentCategoryGrade.objects.bulk_create([
            StudentCategoryGrade(student=self.students[0], schedule=self.schedule, subject=subject,
                                 grade_category=self.categories[0], raw_score=0, total_score=20,
                                 transmuted_grade=60, weighted_score=60, completion_status='COMPLETE')])
        PeriodGrade.objects.bulk_create([PeriodGrade(student=self.students[0], schedule=self.schedule,
                                                     subject=subject, grading_period=c.grading_period,
                                                     raw_score=80+i, completion_status='COMPLETE')
                                        for i, c in enumerate(self.categories)])
        FinalGrade.objects.bulk_create([FinalGrade(student=self.students[0], schedule=self.schedule,
                                                   subject=subject, final_grade=81.5,
                                                   completion_status='COMPLETE', remarks='=unsafe')])
        self.url = reverse('subjects:subject-schedule-detailed-grades-csv', args=[self.schedule.id])

    def test_complete_stored_details_and_bounded_read_queries(self):
        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b'\xef\xbb\xbf'))
        self.assertIn('detailed-grades.csv', response['Content-Disposition'])
        self.assertLess(len(queries), 15)
        self.assertFalse(any(q['sql'].lstrip().upper().startswith(('UPDATE', 'INSERT', 'DELETE')) for q in queries))
        rows = list(csv.DictReader(StringIO(response.content.decode('utf-8-sig'))))
        self.assertEqual(len(rows), 51)
        row = rows[0]
        self.assertEqual(row['Student'], 'Élise De Leon Student 000')
        score_key = next(key for key in row if f'item {self.items[0].id},' in key and key.endswith('/ Score'))
        self.assertEqual(float(row[score_key]), 0)
        self.assertEqual(row[score_key.replace('/ Score', '/ Status')], 'GRADED')
        self.assertIn('EXCUSED', row.values())
        self.assertIn('PENDING', row.values())
        for i, label in enumerate(('Prelim', 'Midterm', 'Prefinal', 'Final')):
            self.assertEqual(float(row[f'{label} period grade']), 80+i)
        self.assertEqual(float(row['Overall course grade']), 81.5)
        self.assertEqual(row['Remarks'], "'=unsafe")
        self.assertEqual(rows[-1]['Status'], 'Inactive')
        self.assertEqual(rows[-1]['Overall course grade'], '')

    def test_filters_and_permissions(self):
        for params, expected in (({'status': 'active'}, 50), ({'status': 'inactive'}, 1),
                                 ({'search': 'De Leon'}, 51), ({'search': 'CSV-050'}, 1),
                                 ({'search': 'not-found'}, 0)):
            response = self.client.get(self.url, params)
            self.assertEqual(len(list(csv.DictReader(StringIO(response.content.decode('utf-8-sig'))))), expected)
        self.client.force_authenticate(self.students[0])
        self.assertEqual(self.client.get(self.url).status_code, 403)
        self.client.force_authenticate(None)
        self.assertIn(self.client.get(self.url).status_code, (401, 403))
