from datetime import timedelta

from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import StudentProfile
from attendance.models import AttendanceRecord, AttendanceSession
from learning_modules.models import Module, ModuleActivity, ModuleActivitySubmission
from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule
from subjects.scheduling import WEEKDAY_CODES


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
        self.assertNotIn('problem_count', response.data['metrics'])
        self.assertNotIn('blank_count', response.data['metrics'])
        self.assertLessEqual(len(queries), 25)

    def test_teacher_navigation_reports_teacher_role(self):
        self.client.force_authenticate(self.teacher)
        response = self.client.get(reverse('overview:navigation'))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['role'], 'teacher')

    def test_teacher_dashboard_prioritizes_attention_and_todays_classes(self):
        today = timezone.localdate()
        today_code = WEEKDAY_CODES[today.weekday()]
        school_year = SchoolYear.objects.create(start_year=2038, end_year=2039)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
            is_active=True,
        )
        subject = Subject.objects.create(code='OV101', name='Overview Design')
        partial_class = SubjectSchedule.objects.create(
            subject=subject,
            school_year_semester=term,
            days=today_code,
            start_time='08:00',
            end_time='09:00',
            section='A',
            room='Room 1',
        )
        complete_class = SubjectSchedule.objects.create(
            subject=subject,
            school_year_semester=term,
            days=today_code,
            start_time='10:00',
            end_time='11:00',
            section='B',
        )
        empty_class = SubjectSchedule.objects.create(
            subject=subject,
            school_year_semester=term,
            days=today_code,
            start_time='13:00',
            end_time='14:00',
            section='C',
        )
        second_student = get_user_model().objects.create_user(
            username='overview-second-student',
            password='testpass123',
            first_name='Second',
            last_name='Student',
            role=get_user_model().Role.STUDENT,
        )
        ScheduleStudent.objects.create(schedule=partial_class, student=self.student)
        ScheduleStudent.objects.create(schedule=partial_class, student=second_student)
        ScheduleStudent.objects.create(schedule=complete_class, student=self.student)

        partial_session = AttendanceSession.objects.create(
            schedule=partial_class,
            subject=subject,
            school_year_semester=term,
            title='Class attendance',
            date=today,
        )
        partial_session.roster_students.set((self.student, second_student))
        AttendanceRecord.objects.create(
            session=partial_session,
            student=self.student,
            status=AttendanceRecord.Status.PRESENT,
        )
        complete_session = AttendanceSession.objects.create(
            schedule=complete_class,
            subject=subject,
            school_year_semester=term,
            title='Class attendance',
            date=today,
        )
        complete_session.roster_students.set((self.student,))
        AttendanceRecord.objects.create(
            session=complete_session,
            student=self.student,
            status=AttendanceRecord.Status.PRESENT,
        )
        future_session = AttendanceSession.objects.create(
            schedule=partial_class,
            subject=subject,
            school_year_semester=term,
            title='Future attendance',
            date=today + timedelta(days=1),
        )

        module = Module.objects.create(
            subject=subject,
            title='Overview Module',
            slug='overview-module',
        )
        activity = ModuleActivity.objects.create(
            module=module,
            title='Reflection',
            instructions='Write a reflection.',
            activity_type=ModuleActivity.ActivityType.TEXT,
        )
        submission = ModuleActivitySubmission.objects.create(
            activity=activity,
            student=second_student,
            text_answer='Needs feedback.',
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.get(reverse('overview:dashboard'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['metrics'], {
            'attention_count': 1,
            'today_class_count': 3,
            'attendance_complete_count': 1,
            'active_class_count': 3,
            'active_student_count': 2,
        })
        self.assertEqual(response.data['attention_items'][0]['id'], submission.id)
        self.assertEqual(response.data['attention_items'][0]['student_name'], 'Second Student')
        self.assertEqual(response.data['attention_items'][0]['activity_title'], 'Reflection')
        self.assertEqual(
            [item['attendance_status'] for item in response.data['today_classes']],
            ['IN_PROGRESS', 'COMPLETE', 'NOT_STARTED'],
        )
        recent_attendance_ids = {
            item['attendance_session_id']
            for item in response.data['recent_activity']
            if item['kind'] == 'ATTENDANCE'
        }
        self.assertIn(partial_session.id, recent_attendance_ids)
        self.assertNotIn(future_session.id, recent_attendance_ids)
        self.assertNotIn('ungraded_submissions', response.data)
        self.assertNotIn('recent_module_access', response.data)

    def test_teacher_dashboard_handles_no_active_classes(self):
        self.client.force_authenticate(self.teacher)

        response = self.client.get(reverse('overview:dashboard'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['metrics']['today_class_count'], 0)
        self.assertEqual(response.data['metrics']['attendance_complete_count'], 0)
        self.assertEqual(response.data['today_classes'], [])

    def test_coding_api_is_removed(self):
        self.client.force_authenticate(self.student)
        response = self.client.get('/api/coding/problems/')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


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
        self.assertEqual(response.data['metrics']['active_student_count'], 0)
        self.assertEqual(response.data['metrics']['attention_count'], 0)
        self.assertLessEqual(len(queries), 25)
