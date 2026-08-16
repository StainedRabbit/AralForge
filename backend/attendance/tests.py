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

    def test_start_session_is_idempotent_and_returns_fresh_records_and_roster(self):
        url = reverse('attendance:attendance-session-start-session')
        payload = {
            'date': '2028-08-16',
            'points_possible': '1.00',
            'schedule': self.schedule_a.id,
            'title': 'Class attendance',
        }

        created = self.client.post(url, payload, format='json')
        session = AttendanceSession.objects.get(id=created.data['session']['id'])
        AttendanceRecord.objects.create(
            session=session,
            student=self.student,
            status='PRESENT',
            points_earned='1.00',
        )
        resumed = self.client.post(url, payload, format='json')

        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertTrue(created.data['created'])
        self.assertEqual(created.data['session']['roster_students'], [self.student.id])
        self.assertEqual(resumed.status_code, status.HTTP_200_OK)
        self.assertFalse(resumed.data['created'])
        self.assertEqual(len(resumed.data['records']), 1)
        self.assertEqual(AttendanceSession.objects.filter(schedule=self.schedule_a, date='2028-08-16').count(), 1)

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

    def test_mark_student_is_idempotent_and_calculates_points(self):
        session = self.create_session(self.schedule_a)
        url = reverse('attendance:attendance-session-mark-student', args=[session.id])

        present = self.client.put(
            url,
            {'status': 'PRESENT', 'student': self.student.id},
            format='json',
        )
        late = self.client.put(
            url,
            {'status': 'LATE', 'student': self.student.id},
            format='json',
        )

        self.assertEqual(present.status_code, status.HTTP_200_OK)
        self.assertEqual(present.data['points_earned'], '2.00')
        self.assertEqual(late.status_code, status.HTTP_200_OK)
        self.assertEqual(late.data['points_earned'], '1.00')
        self.assertEqual(
            AttendanceRecord.objects.filter(session=session, student=self.student).count(),
            1,
        )
        self.assertEqual(
            AttendanceRecord.objects.get(session=session, student=self.student).status,
            'LATE',
        )

    def test_marking_non_excused_clears_an_existing_excuse_reason(self):
        session = self.create_session(self.schedule_a)
        url = reverse('attendance:attendance-session-mark-student', args=[session.id])
        self.client.put(
            url,
            {
                'remarks': 'Medical appointment',
                'status': 'EXCUSED',
                'student': self.student.id,
            },
            format='json',
        )

        response = self.client.put(
            url,
            {'remarks': '', 'status': 'PRESENT', 'student': self.student.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        record = AttendanceRecord.objects.get(session=session, student=self.student)
        self.assertEqual(record.status, 'PRESENT')
        self.assertEqual(record.remarks, '')
        self.assertEqual(str(record.points_earned), '2.00')

    def test_mark_student_requires_active_class_enrollment(self):
        session = self.create_session(self.schedule_a)

        response = self.client.put(
            reverse('attendance:attendance-session-mark-student', args=[session.id]),
            {'status': 'PRESENT', 'student': self.other_student.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(AttendanceRecord.objects.filter(session=session).exists())

    def test_snapshot_student_can_be_edited_after_enrollment_is_deactivated(self):
        session = self.create_session(self.schedule_a)
        enrollment = ScheduleStudent.objects.get(schedule=self.schedule_a, student=self.student)
        enrollment.is_active = False
        enrollment.save(update_fields=['is_active'])

        response = self.client.put(
            reverse('attendance:attendance-session-mark-student', args=[session.id]),
            {'status': 'PRESENT', 'student': self.student.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_delete_mark_is_idempotent_for_undo(self):
        session = self.create_session(self.schedule_a)
        AttendanceRecord.objects.create(
            session=session,
            student=self.student,
            status='PRESENT',
            points_earned='2.00',
        )
        url = reverse('attendance:attendance-session-mark-student', args=[session.id])

        first = self.client.delete(url, {'student': self.student.id}, format='json')
        second = self.client.delete(url, {'student': self.student.id}, format='json')

        self.assertEqual(first.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(second.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(AttendanceRecord.objects.filter(session=session).exists())

    def test_direct_record_writes_calculate_points_server_side(self):
        session = self.create_session(self.schedule_a)
        created = self.client.post(
            reverse('attendance:attendance-record-list'),
            {
                'points_earned': '99.00',
                'session': session.id,
                'status': 'LATE',
                'student': self.student.id,
            },
            format='json',
        )
        record = AttendanceRecord.objects.get(id=created.data['id'])
        updated = self.client.patch(
            reverse('attendance:attendance-record-detail', args=[record.id]),
            {'points_earned': '99.00', 'status': 'ABSENT'},
            format='json',
        )

        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        self.assertEqual(created.data['points_earned'], '1.00')
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        self.assertEqual(updated.data['points_earned'], '0.00')

    def test_excused_status_requires_remarks_for_all_write_paths(self):
        session = self.create_session(self.schedule_a)

        mark_response = self.client.put(
            reverse('attendance:attendance-session-mark-student', args=[session.id]),
            {'remarks': '   ', 'status': 'EXCUSED', 'student': self.student.id},
            format='json',
        )
        roster_response = self.client.put(
            reverse('attendance:attendance-session-save-roster', args=[session.id]),
            {
                'records': [
                    {'remarks': '', 'status': 'EXCUSED', 'student': self.student.id},
                ],
            },
            format='json',
        )
        record_response = self.client.post(
            reverse('attendance:attendance-record-list'),
            {
                'remarks': '',
                'session': session.id,
                'status': 'EXCUSED',
                'student': self.student.id,
            },
            format='json',
        )

        self.assertEqual(mark_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(roster_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(record_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(AttendanceRecord.objects.filter(session=session).exists())

    def test_student_cannot_mark_attendance(self):
        session = self.create_session(self.schedule_a)
        self.client.force_authenticate(self.student)

        response = self.client.put(
            reverse('attendance:attendance-session-mark-student', args=[session.id]),
            {'status': 'PRESENT', 'student': self.student.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(AttendanceRecord.objects.filter(session=session).exists())

    def test_deleting_class_preserves_attendance_as_legacy_history(self):
        session = self.create_session(self.schedule_a)

        self.schedule_a.delete()

        session.refresh_from_db()
        self.assertIsNone(session.schedule_id)
        self.assertIsNotNone(session.subject_id)
