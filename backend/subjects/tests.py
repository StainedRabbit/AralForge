from datetime import time

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase

from .models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule


class SubjectScheduleTests(TestCase):
    def setUp(self):
        self.student = get_user_model().objects.create_user(username='student', password='testpass123')
        self.subject = Subject.objects.create(code='CC103', name='Computer Programming 2')
        self.school_year = SchoolYear.objects.create(start_year=2026, end_year=2027)
        self.term = SchoolYearSemester.objects.create(
            school_year=self.school_year,
            semester=Semester.FIRST,
        )

    def test_subject_schedule_display_includes_subject_time_and_term(self):
        schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=self.term,
            days='TTH',
            start_time=time(13, 0),
            end_time=time(14, 30),
        )

        self.assertEqual(str(schedule), 'CC103 TTH 1:00 PM-2:30 PM 1st Semester 2026-2027')

    def test_schedule_student_points_to_login_student(self):
        schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=self.term,
            days='TTH',
            start_time=time(13, 0),
            end_time=time(14, 30),
        )

        schedule_student = ScheduleStudent.objects.create(
            student=self.student,
            schedule=schedule,
        )

        self.assertEqual(schedule_student.schedule.subject, self.subject)
        self.assertEqual(schedule_student.schedule.school_year_semester, self.term)

    def test_schedule_student_rejects_non_student_user(self):
        admin = get_user_model().objects.create_user(
            username='admin',
            password='testpass123',
            role=get_user_model().Role.ADMIN,
        )
        schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=self.term,
            days='TTH',
            start_time=time(13, 0),
            end_time=time(14, 30),
        )

        schedule_student = ScheduleStudent(
            student=admin,
            schedule=schedule,
        )

        with self.assertRaises(ValidationError):
            schedule_student.full_clean()
