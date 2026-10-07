from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import StudentProfile
from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule

from .models import AttendanceRecord, AttendanceSession
from .services import finalize_ended_attendance


class AttendanceFinalizationTests(TestCase):
    def setUp(self):
        User = get_user_model()
        self.student_one = User.objects.create_user(
            username='finalize-one', password='testpass123', role=User.Role.STUDENT,
        )
        self.student_two = User.objects.create_user(
            username='finalize-two', password='testpass123', role=User.Role.STUDENT,
        )
        StudentProfile.objects.create(user=self.student_one, student_number='FIN-001')
        StudentProfile.objects.create(user=self.student_two, student_number='FIN-002')
        year = SchoolYear.objects.create(start_year=2030, end_year=2031)
        self.term = SchoolYearSemester.objects.create(school_year=year, semester=Semester.FIRST)
        self.subject = Subject.objects.create(code='FIN101', name='Finalization')
        self.schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=self.term,
            days='MWF',
            start_time=time(8),
            end_time=time(9),
            section='A',
        )
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.student_one)
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.student_two)

    def make_session(self, session_date, title):
        session = AttendanceSession.objects.create(
            schedule=self.schedule,
            subject=self.subject,
            school_year_semester=self.term,
            date=session_date,
            title=title,
        )
        session.roster_students.set([self.student_one, self.student_two])
        return session

    def test_ended_partial_session_marks_only_unrecorded_students_and_deletes_empty_ended_sessions(self):
        now = datetime(2030, 9, 18, 12, tzinfo=ZoneInfo('Asia/Manila'))
        partial = self.make_session(date(2030, 9, 18), 'Partial')
        AttendanceRecord.objects.create(
            session=partial,
            student=self.student_one,
            status=AttendanceRecord.Status.LATE,
            points_earned='0.50',
        )
        empty = self.make_session(date(2030, 9, 17), 'Empty')
        future = self.make_session(date(2030, 9, 19), 'Future')

        result = finalize_ended_attendance(now=now)

        self.assertEqual(result, {'deleted_sessions': 1, 'created_absences': 1})
        self.assertFalse(AttendanceSession.objects.filter(pk=empty.pk).exists())
        self.assertTrue(AttendanceSession.objects.filter(pk=future.pk).exists())
        self.assertEqual(partial.records.get(student=self.student_one).status, AttendanceRecord.Status.LATE)
        absent = partial.records.get(student=self.student_two)
        self.assertEqual(absent.status, AttendanceRecord.Status.ABSENT)
        self.assertEqual(absent.points_earned, 0)

    def test_current_data_cleanup_can_delete_empty_legacy_sessions(self):
        legacy = AttendanceSession.objects.create(
            subject=self.subject,
            school_year_semester=self.term,
            date=date(2029, 1, 1),
            title='Legacy empty',
        )
        now = datetime(2030, 9, 18, 12, tzinfo=ZoneInfo('Asia/Manila'))

        result = finalize_ended_attendance(now=now, delete_all_empty=True)

        self.assertFalse(AttendanceSession.objects.filter(pk=legacy.pk).exists())
        self.assertGreaterEqual(result['deleted_sessions'], 1)


class AttendanceSessionDeleteApiTests(APITestCase):
    def test_teacher_can_delete_session_and_its_statuses(self):
        User = get_user_model()
        teacher = User.objects.create_user(
            username='delete-attendance-teacher', password='testpass123', role=User.Role.TEACHER,
        )
        student = User.objects.create_user(
            username='delete-attendance-student', password='testpass123', role=User.Role.STUDENT,
        )
        year = SchoolYear.objects.create(start_year=2031, end_year=2032)
        term = SchoolYearSemester.objects.create(school_year=year, semester=Semester.FIRST)
        subject = Subject.objects.create(code='DEL101', name='Delete session')
        schedule = SubjectSchedule.objects.create(
            subject=subject,
            school_year_semester=term,
            days='MWF',
            start_time=time(8),
            end_time=time(9),
            section='A',
        )
        session = AttendanceSession.objects.create(
            schedule=schedule,
            subject=subject,
            school_year_semester=term,
            date=date(2031, 9, 1),
        )
        session.roster_students.add(student)
        record = AttendanceRecord.objects.create(
            session=session,
            student=student,
            status=AttendanceRecord.Status.PRESENT,
            points_earned=1,
        )
        self.client.force_authenticate(teacher)

        response = self.client.delete(reverse('attendance:attendance-session-detail', args=[session.pk]))

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(AttendanceSession.objects.filter(pk=session.pk).exists())
        self.assertFalse(AttendanceRecord.objects.filter(pk=record.pk).exists())
