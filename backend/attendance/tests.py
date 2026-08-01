from datetime import time

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule

from .models import AttendanceRecord, AttendanceSession


class ClassAttendanceApiTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.teacher = user_model.objects.create_user(
            username='attendance-teacher',
            password='testpass123',
            role=user_model.Role.TEACHER,
        )
        self.student = user_model.objects.create_user(
            username='attendance-student',
            password='testpass123',
            role=user_model.Role.STUDENT,
        )
        self.other_student = user_model.objects.create_user(
            username='other-attendance-student',
            password='testpass123',
            role=user_model.Role.STUDENT,
        )
        subject = Subject.objects.create(code='CC105', name='Information Management')
        school_year = SchoolYear.objects.create(start_year=2028, end_year=2029)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        self.schedule_a = SubjectSchedule.objects.create(
            subject=subject,
            school_year_semester=term,
            days='MWF',
            start_time=time(8),
            end_time=time(9),
            section='BSIT-1A',
        )
        self.schedule_b = SubjectSchedule.objects.create(
            subject=subject,
            school_year_semester=term,
            days='TTH',
            start_time=time(8),
            end_time=time(9),
            section='BSIT-1B',
        )
        ScheduleStudent.objects.create(schedule=self.schedule_a, student=self.student)
        ScheduleStudent.objects.create(schedule=self.schedule_b, student=self.other_student)
        self.client.force_authenticate(self.teacher)

    def create_session(self, schedule):
        response = self.client.post(
            reverse('attendance:attendance-session-list'),
            {
                'date': '2028-08-15',
                'points_possible': '2.00',
                'schedule': schedule.id,
                'title': 'Class attendance',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return AttendanceSession.objects.get(id=response.data['id'])

    def test_sessions_are_separate_for_each_class_schedule(self):
        session_a = self.create_session(self.schedule_a)
        session_b = self.create_session(self.schedule_b)

        self.assertNotEqual(session_a.id, session_b.id)
        self.assertEqual(session_a.subject_id, self.schedule_a.subject_id)
        self.assertEqual(
            session_a.school_year_semester_id,
            self.schedule_a.school_year_semester_id,
        )

    def test_roster_save_is_atomic_and_uses_only_active_class_students(self):
        session = self.create_session(self.schedule_a)

        response = self.client.put(
            reverse('attendance:attendance-session-save-roster', args=[session.id]),
            {
                'records': [
                    {
                        'remarks': 'Arrived after the opening activity',
                        'status': 'LATE',
                        'student': self.student.id,
                    },
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        record = AttendanceRecord.objects.get(session=session, student=self.student)
        self.assertEqual(record.status, 'LATE')
        self.assertEqual(str(record.points_earned), '1.00')
        self.assertFalse(
            AttendanceRecord.objects.filter(
                session=session,
                student=self.other_student,
            ).exists(),
        )

    def test_roster_save_rejects_students_from_another_class(self):
        session = self.create_session(self.schedule_a)

        response = self.client.put(
            reverse('attendance:attendance-session-save-roster', args=[session.id]),
            {
                'records': [
                    {'status': 'PRESENT', 'student': self.other_student.id},
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(AttendanceRecord.objects.filter(session=session).exists())

    def test_deleting_class_preserves_attendance_as_legacy_history(self):
        session = self.create_session(self.schedule_a)

        self.schedule_a.delete()

        session.refresh_from_db()
        self.assertIsNone(session.schedule_id)
        self.assertIsNotNone(session.subject_id)
