from datetime import time, timedelta
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.core.management import call_command
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase


def result_rows(response):
    return response.data.get('results', response.data) if isinstance(response.data, dict) else response.data

from accounts.models import StudentProfile
from attendance.models import AttendanceRecord
from grades.models import StudentGradeItemScore
from jobs.models import BackgroundJob
from learning_modules.models import (
    ModuleActivityAttempt,
    ModuleActivitySubmission,
    ModuleLessonProgress,
    ModuleProgress,
)
from .models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule
from .tasks import import_roster_job
from .roster_import import validate_roster_rows


class PerformanceSeedCommandTests(TestCase):
    @patch.dict('os.environ', {'ALLOW_PERFORMANCE_SEED': 'true'})
    def test_small_fixture_covers_every_high_growth_table(self):
        output = StringIO()

        call_command(
            'seed_performance',
            students=4,
            schedules=2,
            classes_per_student=2,
            grade_items_per_class=1,
            attendance_sessions_per_class=1,
            lessons_per_module=2,
            confirm=True,
            stdout=output,
        )

        self.assertEqual(ScheduleStudent.objects.count(), 8)
        self.assertEqual(StudentGradeItemScore.objects.count(), 8)
        self.assertEqual(AttendanceRecord.objects.count(), 8)
        self.assertEqual(ModuleProgress.objects.count(), 8)
        self.assertEqual(ModuleLessonProgress.objects.count(), 16)
        self.assertEqual(ModuleActivityAttempt.objects.count(), 8)
        self.assertEqual(ModuleActivitySubmission.objects.count(), 8)
        self.assertIn('8 attendance records', output.getvalue())


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


class SubjectScheduleApiTests(APITestCase):
    def test_roster_task_ignores_failed_running_and_completed_deliveries(self):
        for job_status in (BackgroundJob.Status.FAILED, BackgroundJob.Status.RUNNING, BackgroundJob.Status.SUCCEEDED):
            job = BackgroundJob.objects.create(
                job_type=BackgroundJob.Type.IMPORT, status=job_status,
                payload={}, result={'existing': True},
            )
            with patch('subjects.tasks.prepare_password_hashes') as prepare:
                self.assertEqual(import_roster_job.run(str(job.id)), {'existing': True})
            prepare.assert_not_called()
            job.refresh_from_db()
            self.assertEqual(job.status, job_status)
            self.assertEqual(job.attempts, 0)

    def test_late_roster_task_expires_without_creating_students(self):
        job = BackgroundJob.objects.create(
            job_type=BackgroundJob.Type.IMPORT,
            idempotency_key='roster-import:late', payload={'rows': []},
        )
        BackgroundJob.objects.filter(pk=job.pk).update(created_at=timezone.now() - timedelta(hours=2))
        with patch('subjects.tasks.prepare_password_hashes') as prepare:
            import_roster_job.run(str(job.id))
        prepare.assert_not_called()
        job.refresh_from_db()
        self.assertEqual(job.status, BackgroundJob.Status.FAILED)
        self.assertEqual(job.attempts, 0)
        self.assertEqual(job.payload, {})

    def setUp(self):
        user_model = get_user_model()
        self.teacher = user_model.objects.create_user(
            username='teacher',
            password='testpass123',
            role=user_model.Role.TEACHER,
        )
        self.student = user_model.objects.create_user(
            username='student-api',
            password='testpass123',
            role=user_model.Role.STUDENT,
        )
        self.subject = Subject.objects.create(code='CC104', name='Data Structures')
        school_year = SchoolYear.objects.create(start_year=2027, end_year=2028)
        self.term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )

    def create_schedule(self):
        return SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=self.term,
            days='MWF',
            start_time=time(9, 0),
            end_time=time(10, 0),
        )

    def queue_and_run_roster_import(self, url, rows):
        with patch('subjects.views.import_roster_job.delay') as delayed:
            delayed.return_value = SimpleNamespace(id='test-roster-import')
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(url, {'rows': rows}, format='json')
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        job = BackgroundJob.objects.get(pk=response.data['job']['id'])
        import_roster_job.run(str(job.id))
        job.refresh_from_db()
        return response, job

    def test_used_schedule_cannot_be_permanently_deleted(self):
        schedule = self.create_schedule()
        roster_assignment = ScheduleStudent.objects.create(
            schedule=schedule,
            student=self.student,
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.delete(
            reverse('subjects:subject-schedule-detail', args=[schedule.id]),
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(SubjectSchedule.objects.filter(id=schedule.id).exists())
        self.assertTrue(ScheduleStudent.objects.filter(id=roster_assignment.id).exists())

    def test_teacher_can_delete_unused_schedule(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.teacher)

        response = self.client.delete(
            reverse('subjects:subject-schedule-detail', args=[schedule.id]),
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(SubjectSchedule.objects.filter(id=schedule.id).exists())

    def test_archive_preserves_roster_and_records_audit_actor(self):
        schedule = self.create_schedule()
        enrollment = ScheduleStudent.objects.create(schedule=schedule, student=self.student)
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            reverse('subjects:subject-schedule-archive', args=[schedule.id]),
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        schedule.refresh_from_db()
        self.assertFalse(schedule.is_active)
        self.assertEqual(schedule.archived_by, self.teacher)
        self.assertIsNotNone(schedule.archived_at)
        self.assertTrue(ScheduleStudent.objects.filter(id=enrollment.id).exists())

    def test_student_cannot_delete_schedule(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.student)

        response = self.client.delete(
            reverse('subjects:subject-schedule-detail', args=[schedule.id]),
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(SubjectSchedule.objects.filter(id=schedule.id).exists())

    def post_schedule(self, **overrides):
        payload = {
            'subject': self.subject.id,
            'school_year_semester': self.term.id,
            'days': 'MWF',
            'start_time': '10:00',
            'end_time': '11:00',
            'section': 'A',
            'room': 'Lab 1',
            'is_active': True,
        }
        payload.update(overrides)
        self.client.force_authenticate(self.teacher)
        return self.client.post(
            reverse('subjects:subject-schedule-list'),
            payload,
            format='json',
        )

    def test_api_normalizes_legacy_compact_days(self):
        response = self.post_schedule(days='TTH')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['days'], 'TU,TH')

    def test_api_allows_shared_day_time_overlap(self):
        self.create_schedule()

        response = self.post_schedule(days='MO,WE', start_time='09:30', end_time='10:30')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_api_allows_adjacent_schedule(self):
        self.create_schedule()

        response = self.post_schedule(start_time='10:00', end_time='11:00')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_api_allows_same_time_on_different_days(self):
        self.create_schedule()

        response = self.post_schedule(days='TU,TH', start_time='09:00', end_time='10:00')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_api_allows_same_time_in_different_term(self):
        self.create_schedule()
        second_term = SchoolYearSemester.objects.create(
            school_year=self.term.school_year,
            semester=Semester.SECOND,
        )

        response = self.post_schedule(
            school_year_semester=second_term.id,
            start_time='09:00',
            end_time='10:00',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_api_allows_inactive_overlap(self):
        self.create_schedule()

        response = self.post_schedule(
            start_time='09:30',
            end_time='10:30',
            is_active=False,
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_api_excludes_schedule_being_updated(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.teacher)

        response = self.client.patch(
            reverse('subjects:subject-schedule-detail', args=[schedule.id]),
            {'days': 'MO,WE,FR', 'room': 'Lab 2'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['days'], 'MO,WE,FR')

    def test_student_schedule_list_is_scoped_to_own_enrollments(self):
        own_schedule = self.create_schedule()
        other_schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=self.term,
            days='TU,TH',
            start_time=time(11, 0),
            end_time=time(12, 0),
        )
        ScheduleStudent.objects.create(schedule=own_schedule, student=self.student)
        self.client.force_authenticate(self.student)

        response = self.client.get(reverse('subjects:subject-schedule-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item['id'] for item in result_rows(response)], [own_schedule.id])
        self.assertNotIn(other_schedule.id, [item['id'] for item in result_rows(response)])

    def test_schedule_list_pages_filtered_results_with_stable_offsets(self):
        schedules = [
            SubjectSchedule.objects.create(
                subject=self.subject,
                school_year_semester=self.term,
                days='TU,TH',
                start_time=time(13, 0),
                end_time=time(14, 0),
                section=f'Paged {index:02d}',
            )
            for index in range(12)
        ]
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-list')
        filters = {
            'limit': 10,
            'term': self.term.id,
            'search': 'Paged',
            'status': 'all',
        }

        first_page = self.client.get(url, {**filters, 'offset': 0})
        second_page = self.client.get(url, {**filters, 'offset': 10})

        self.assertEqual(first_page.status_code, status.HTTP_200_OK)
        self.assertEqual(second_page.status_code, status.HTTP_200_OK)
        self.assertEqual(first_page.data['count'], 12)
        self.assertEqual(first_page.data['next'], 10)
        self.assertEqual(second_page.data['next'], None)
        first_ids = [item['id'] for item in first_page.data['results']]
        second_ids = [item['id'] for item in second_page.data['results']]
        self.assertEqual(len(first_ids), 10)
        self.assertEqual(len(second_ids), 2)
        self.assertFalse(set(first_ids) & set(second_ids))
        self.assertEqual(first_ids + second_ids, [schedule.id for schedule in schedules])

    def test_roster_action_pages_students_with_numeric_offsets(self):
        schedule = self.create_schedule()
        user_model = get_user_model()
        students = [self.student]
        for index in range(12):
            students.append(user_model.objects.create_user(
                username=f'paged-student-{index:02d}',
                password='testpass123',
                role=user_model.Role.STUDENT,
            ))
        ScheduleStudent.objects.bulk_create(
            ScheduleStudent(schedule=schedule, student=student)
            for student in students
        )
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-roster', args=[schedule.id])

        first_page = self.client.get(url, {'limit': 10, 'offset': 0, 'status': 'active'})
        second_page = self.client.get(url, {'limit': 10, 'offset': 10, 'status': 'active'})

        self.assertEqual(first_page.status_code, status.HTTP_200_OK)
        self.assertEqual(first_page.data['count'], 13)
        self.assertEqual(first_page.data['total_count'], 13)
        self.assertEqual(len(first_page.data['results']), 10)
        self.assertEqual(first_page.data['next'], 10)
        self.assertIsNone(first_page.data['previous'])
        self.assertEqual(second_page.status_code, status.HTTP_200_OK)
        self.assertEqual(len(second_page.data['results']), 3)
        self.assertIsNone(second_page.data['next'])
        self.assertEqual(second_page.data['previous'], 0)
        first_ids = {item['id'] for item in first_page.data['results']}
        second_ids = {item['id'] for item in second_page.data['results']}
        self.assertFalse(first_ids & second_ids)

    def test_roster_filters_do_not_filter_the_parent_schedule(self):
        schedule = self.create_schedule()
        self.student.first_name = 'Alex'
        self.student.save(update_fields=['first_name'])
        ScheduleStudent.objects.create(schedule=schedule, student=self.student, is_active=False)
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-roster', args=[schedule.id])

        response = self.client.get(url, {'status': 'inactive', 'search': 'Alex'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['student'], self.student.id)

    def test_class_workspace_loads_only_the_requested_section(self):
        from attendance.models import AttendanceRecord, AttendanceSession
        from grades.models import GradeCategory, GradeCategoryChoices, GradeItem, StudentGradeItemScore

        schedule = self.create_schedule()
        ScheduleStudent.objects.create(schedule=schedule, student=self.student)
        session = AttendanceSession.objects.create(
            schedule=schedule,
            subject=self.subject,
            school_year_semester=self.term,
            title='Class attendance',
            date='2027-08-30',
        )

        AttendanceRecord.objects.create(session=session, student=self.student, status='PRESENT')
        category = GradeCategory.objects.create(
            subject=self.subject,
            grading_period='PRELIM',
            category=GradeCategoryChoices.QUIZ,
            name='Quizzes',
            weight=100,
        )
        item = GradeItem.objects.create(
            schedule=schedule,
            grade_category=category,
            title='Quiz 1',
            points_possible=10,
        )
        StudentGradeItemScore.objects.create(grade_item=item, student=self.student, raw_score=9)
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-workspace', args=[schedule.id])

        attendance = self.client.get(url, {'section': 'attendance'})
        scores = self.client.get(url, {'section': 'scores'})
        grades = self.client.get(url, {'section': 'grades'})
        invalid = self.client.get(url)

        self.assertEqual(attendance.status_code, status.HTTP_200_OK)
        self.assertEqual(len(attendance.data['attendance_sessions']), 1)
        self.assertEqual(attendance.data['grade_items'], [])
        self.assertEqual(scores.status_code, status.HTTP_200_OK)
        self.assertEqual(len(scores.data['grade_items']), 1)
        self.assertEqual(scores.data['grade_item_scores'], [])
        self.assertEqual(grades.status_code, status.HTTP_200_OK)
        self.assertEqual(len(grades.data['grade_item_scores']), 1)
        self.assertEqual(invalid.status_code, status.HTTP_400_BAD_REQUEST)

    def test_enroll_students_action_adds_and_reactivates_atomically(self):
        schedule = self.create_schedule()
        enrollment = ScheduleStudent.objects.create(
            schedule=schedule,
            student=self.student,
            is_active=False,
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            reverse('subjects:subject-schedule-enroll-students', args=[schedule.id]),
            {'student_ids': [self.student.id]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['reactivated_count'], 1)
        enrollment.refresh_from_db()
        self.assertTrue(enrollment.is_active)

    def test_create_student_action_creates_account_credentials_and_enrollment_atomically(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            reverse('subjects:subject-schedule-create-student', args=[schedule.id]),
            {
                'student_number': 'NEW-2030-01',
                'first_name': 'Robin',
                'last_name': 'Young',
                'email': 'robin@example.com',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        profile = StudentProfile.objects.select_related('user').get(student_number='NEW-2030-01')
        enrollment = ScheduleStudent.objects.get(schedule=schedule, student=profile.user)
        self.assertTrue(enrollment.is_active)
        self.assertEqual(enrollment.added_by, self.teacher)
        self.assertEqual(profile.user.first_name, 'Robin')
        self.assertEqual(profile.user.last_name, 'Young')
        self.assertEqual(profile.user.email, 'robin@example.com')
        self.assertEqual(profile.user.username, 'NEW-2030-01')
        self.assertTrue(profile.user.must_change_password)
        self.assertTrue(profile.user.check_password('NEW-2030-01'))
        self.assertEqual(response.data['student']['display_name'], 'Robin Young')
        self.assertEqual(response.data['enrollment']['id'], enrollment.id)
        self.assertEqual(response.data['credentials'], {
            'username': 'NEW-2030-01',
            'temporary_password': 'NEW-2030-01',
            'must_change_password': True,
        })

    def test_create_student_action_returns_existing_account_enrollment_status(self):
        schedule = self.create_schedule()
        existing = get_user_model().objects.create_user(
            username='Existing-2030-01',
            first_name='Existing',
            last_name='Learner',
            role=get_user_model().Role.STUDENT,
        )
        profile = StudentProfile.objects.create(
            user=existing,
            student_number='Existing-2030-01',
        )
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-create-student', args=[schedule.id])
        payload = {
            'student_number': 'existing-2030-01',
            'first_name': 'Replacement',
            'last_name': 'Name',
        }

        not_enrolled = self.client.post(url, payload, format='json')
        self.assertEqual(not_enrolled.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(not_enrolled.data['code'], 'student_exists')
        self.assertEqual(not_enrolled.data['student']['id'], existing.id)
        self.assertEqual(not_enrolled.data['student']['enrollment_status'], 'not_enrolled')

        enrollment = ScheduleStudent.objects.create(
            schedule=schedule,
            student=existing,
            is_active=False,
        )
        inactive = self.client.post(url, payload, format='json')
        self.assertEqual(inactive.data['student']['enrollment_status'], 'inactive')

        enrollment.is_active = True
        enrollment.save(update_fields=('is_active',))
        active = self.client.post(url, payload, format='json')
        self.assertEqual(active.data['student']['enrollment_status'], 'active')
        profile.user.refresh_from_db()
        self.assertEqual(profile.user.first_name, 'Existing')

        existing.is_active = False
        existing.save(update_fields=('is_active',))
        unavailable = self.client.post(url, payload, format='json')
        self.assertEqual(unavailable.data['code'], 'student_unavailable')
        self.assertEqual(unavailable.data['student']['enrollment_status'], 'unavailable')

        get_user_model().objects.create_user(
            username='USERNAME-CONFLICT-01',
            role=get_user_model().Role.TEACHER,
        )
        username_conflict = self.client.post(url, {
            'student_number': 'username-conflict-01',
            'first_name': 'Conflict',
            'last_name': 'Account',
        }, format='json')
        self.assertEqual(username_conflict.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(username_conflict.data['code'], 'student_unavailable')
        self.assertNotIn('student', username_conflict.data)

    def test_create_student_action_rejects_invalid_archived_and_unauthorized_requests(self):
        schedule = self.create_schedule()
        url = reverse('subjects:subject-schedule-create-student', args=[schedule.id])
        self.client.force_authenticate(self.teacher)

        for field, value in (
            ('student_number', 'invalid number'),
            ('first_name', ''),
            ('last_name', ''),
            ('email', 'not-an-email'),
        ):
            with self.subTest(field=field):
                payload = {
                    'student_number': 'VALID-2030-01',
                    'first_name': 'Valid',
                    'last_name': 'Student',
                    'email': '',
                }
                payload[field] = value
                response = self.client.post(url, payload, format='json')
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

        schedule.is_active = False
        schedule.save(update_fields=('is_active',))
        archived = self.client.post(url, {
            'student_number': 'ARCHIVED-2030-01',
            'first_name': 'Archived',
            'last_name': 'Student',
        }, format='json')
        self.assertEqual(archived.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(StudentProfile.objects.filter(student_number='ARCHIVED-2030-01').exists())

        schedule.is_active = True
        schedule.save(update_fields=('is_active',))
        self.client.force_authenticate(self.student)
        unauthorized = self.client.post(url, {
            'student_number': 'DENIED-2030-01',
            'first_name': 'Denied',
            'last_name': 'Student',
        }, format='json')
        self.assertEqual(unauthorized.status_code, status.HTTP_403_FORBIDDEN)
        self.assertFalse(StudentProfile.objects.filter(student_number='DENIED-2030-01').exists())

    def test_create_student_action_rolls_back_account_when_enrollment_fails(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.teacher)

        with patch('subjects.views.ScheduleStudent.objects.create', side_effect=RuntimeError('failed enrollment')):
            with self.assertRaises(RuntimeError):
                self.client.post(
                    reverse('subjects:subject-schedule-create-student', args=[schedule.id]),
                    {
                        'student_number': 'ROLLBACK-2030-01',
                        'first_name': 'Rollback',
                        'last_name': 'Student',
                    },
                    format='json',
                )

        self.assertFalse(StudentProfile.objects.filter(student_number='ROLLBACK-2030-01').exists())

    def test_import_roster_matches_existing_accounts_only(self):
        schedule = self.create_schedule()
        StudentProfile.objects.create(
            user=self.student,
            student_number='2027-0001',
        )
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-import-roster', args=[schedule.id])

        invalid_preview = self.client.post(
            url,
            {
                'dry_run': True,
                'rows': [
                    {'student_number': '2027-0001'},
                    {'student_number': 'missing'},
                ],
            },
            format='json',
        )
        self.assertEqual(invalid_preview.status_code, status.HTTP_200_OK)
        self.assertFalse(invalid_preview.data['valid'])
        self.assertFalse(ScheduleStudent.objects.filter(schedule=schedule).exists())

        imported, job = self.queue_and_run_roster_import(
            url, [{'student_number': '2027-0001'}],
        )
        self.assertEqual(imported.data['job']['status'], BackgroundJob.Status.PENDING)
        self.assertEqual(job.status, BackgroundJob.Status.SUCCEEDED)
        self.assertEqual(job.result['added_count'], 1)
        self.assertTrue(
            ScheduleStudent.objects.filter(schedule=schedule, student=self.student).exists(),
        )

    def test_import_roster_creates_missing_student_with_minimal_profile_and_credentials(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-import-roster', args=[schedule.id])
        rows = [{
            'student_number': '2027-NEW-1',
            'first_name': 'New',
            'middle_name': 'Middle',
            'last_name': 'Learner',
            'ignored_column': 'ignored value',
        }]

        preview = self.client.post(url, {'dry_run': True, 'rows': rows}, format='json')
        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertEqual(preview.data['create_count'], 1)
        self.assertEqual(preview.data['rows'][0]['status'], 'create')
        self.assertNotIn('credentials', preview.data)
        self.assertFalse(StudentProfile.objects.filter(student_number='2027-NEW-1').exists())

        imported, job = self.queue_and_run_roster_import(url, rows)
        self.assertEqual(imported.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(job.result['created_count'], 1)
        self.assertEqual(job.result['created_student_numbers'], ['2027-NEW-1'])
        profile = StudentProfile.objects.select_related('user').get(student_number='2027-NEW-1')
        self.assertEqual(profile.user.email, '')
        self.assertEqual(profile.user.first_name, 'New')
        self.assertEqual(profile.user.middle_name, 'Middle')
        self.assertEqual(profile.user.last_name, 'Learner')
        self.assertEqual(profile.user.username, '2027-NEW-1')
        self.assertTrue(profile.user.must_change_password)
        self.assertTrue(profile.user.check_password('2027-NEW-1'))
        self.assertTrue(ScheduleStudent.objects.filter(schedule=schedule, student=profile.user).exists())
        self.assertEqual(job.payload, {'schedule_id': schedule.id})
        self.assertNotIn('password', str(job.result).lower())

    def test_import_roster_cleans_new_student_names_without_changing_identifiers(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-import-roster', args=[schedule.id])
        rows = [{
            'student_number': '2027-mIxEd-01',
            'first_name': '  élise   marIA ',
            'middle_name': 'ana-maE',
            'last_name': "o'connor",
        }]

        preview = self.client.post(url, {'dry_run': True, 'rows': rows}, format='json')

        self.assertEqual(preview.status_code, status.HTTP_200_OK)
        self.assertEqual(
            preview.data['rows'][0]['student_name'],
            "Élise MarIA A. O'Connor",
        )
        self.assertEqual(preview.data['rows'][0]['student_number'], '2027-mIxEd-01')

        imported, job = self.queue_and_run_roster_import(url, rows)

        self.assertEqual(imported.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(job.status, BackgroundJob.Status.SUCCEEDED)
        profile = StudentProfile.objects.select_related('user').get(
            student_number='2027-mIxEd-01',
        )
        self.assertEqual(profile.user.first_name, 'Élise MarIA')
        self.assertEqual(profile.user.middle_name, 'Ana-MaE')
        self.assertEqual(profile.user.last_name, "O'Connor")

    def test_import_roster_accepts_unicode_names_and_rejects_replacement_characters(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-import-roster', args=[schedule.id])

        unicode_preview = self.client.post(url, {
            'dry_run': True,
            'rows': [{
                'student_number': '2027-UNICODE-1',
                'first_name': 'Espa\u00f1ol',
                'last_name': 'Ni\u00f1o',
            }],
        }, format='json')
        self.assertEqual(unicode_preview.status_code, status.HTTP_200_OK)
        self.assertTrue(unicode_preview.data['valid'])
        self.assertEqual(unicode_preview.data['rows'][0]['student_name'], 'Espa\u00f1ol Ni\u00f1o')

        damaged_preview = self.client.post(url, {
            'dry_run': True,
            'rows': [{
                'student_number': '2027-DAMAGED-1',
                'first_name': 'Espa\ufffdol',
                'last_name': 'Student',
            }],
        }, format='json')
        self.assertEqual(damaged_preview.status_code, status.HTTP_200_OK)
        self.assertFalse(damaged_preview.data['valid'])
        self.assertIn('unknown replacement character', damaged_preview.data['rows'][0]['error'])

        damaged_import = self.client.post(url, {
            'rows': [{
                'student_number': '2027-DAMAGED-1',
                'first_name': 'Espa\ufffdol',
                'last_name': 'Student',
            }],
        }, format='json')
        self.assertEqual(damaged_import.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(StudentProfile.objects.filter(student_number='2027-DAMAGED-1').exists())

    def test_import_roster_updates_existing_student_names(self):
        schedule = self.create_schedule()
        existing = get_user_model().objects.create_user(
            username='existing-name',
            first_name='Existing',
            middle_name='De Leon',
            last_name='Student',
            role='STUDENT',
        )
        StudentProfile.objects.create(user=existing, student_number='2027-KEEP-NAME')
        self.client.force_authenticate(self.teacher)

        response, job = self.queue_and_run_roster_import(
            reverse('subjects:subject-schedule-import-roster', args=[schedule.id]),
            [{
                'student_number': '2027-KEEP-NAME',
                'first_name': 'replacement',
                'middle_name': 'Replacement',
                'last_name': 'name',
            }],
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(job.status, BackgroundJob.Status.SUCCEEDED)
        existing.refresh_from_db()
        self.assertEqual(existing.first_name, 'Replacement')
        self.assertEqual(existing.middle_name, 'Replacement')
        self.assertEqual(existing.last_name, 'Name')

    def test_import_roster_updates_already_enrolled_names_and_preserves_blank_fields(self):
        schedule = self.create_schedule()
        self.student.first_name = 'Mary'
        self.student.middle_name = 'Old'
        self.student.last_name = 'Cruz'
        self.student.save()
        original_password = self.student.password
        StudentProfile.objects.create(user=self.student, student_number='NAME-FIX')
        enrollment = ScheduleStudent.objects.create(schedule=schedule, student=self.student)
        rows = [{'student_number': 'NAME-FIX', 'middle_name': 'de leon'}]
        preview = validate_roster_rows(schedule, rows).preview
        self.assertEqual(preview['update_name_count'], 1)
        self.assertEqual(preview['rows'][0]['previous_full_name'], 'Mary Old Cruz')
        self.assertEqual(preview['rows'][0]['student_full_name'], 'Mary De Leon Cruz')
        self.student.refresh_from_db()
        self.assertEqual(self.student.middle_name, 'Old')
        self.client.force_authenticate(self.teacher)
        response, job = self.queue_and_run_roster_import(
            reverse('subjects:subject-schedule-import-roster', args=[schedule.id]), rows,
        )
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(job.status, BackgroundJob.Status.SUCCEEDED)
        self.student.refresh_from_db()
        self.assertEqual(self.student.get_full_name(), 'Mary De Leon Cruz')
        self.assertEqual(self.student.password, original_password)
        self.assertEqual(ScheduleStudent.objects.get(schedule=schedule, student=self.student).pk, enrollment.pk)
        self.assertEqual(validate_roster_rows(schedule, rows).preview['update_name_count'], 0)
        blank = validate_roster_rows(schedule, [{'student_number': 'NAME-FIX', 'middle_name': ''}])
        self.assertEqual(blank.preview['update_name_count'], 0)
        invalid = validate_roster_rows(schedule, [{'student_number': 'NAME-FIX', 'middle_name': 'A' * 151}])
        self.assertFalse(invalid.preview['valid'])

    def test_import_roster_requires_names_for_new_students_and_rolls_back_all_rows(self):
        schedule = self.create_schedule()
        StudentProfile.objects.create(user=self.student, student_number='2027-EXISTING')
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-import-roster', args=[schedule.id])

        response = self.client.post(
            url,
            {'rows': [
                {'student_number': '2027-EXISTING'},
                {'student_number': '2027-MISSING-NAME', 'first_name': 'Only'},
            ]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(ScheduleStudent.objects.filter(schedule=schedule).exists())
        self.assertFalse(StudentProfile.objects.filter(student_number='2027-MISSING-NAME').exists())

    def test_roster_preview_uses_bounded_conflict_queries(self):
        schedule = self.create_schedule()
        rows = [
            {
                'student_number': f'BATCH-{index:04d}',
                'first_name': 'Batch',
                'last_name': 'Student',
            }
            for index in range(51)
        ]

        with CaptureQueriesContext(connection) as queries:
            validation = validate_roster_rows(schedule, rows)

        self.assertTrue(validation.preview['valid'])
        self.assertEqual(validation.preview['create_count'], 51)
        self.assertLessEqual(len(queries), 3)

    def test_duplicate_roster_submissions_reuse_active_job_and_status_endpoint(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.teacher)
        import_url = reverse('subjects:subject-schedule-import-roster', args=[schedule.id])
        status_url = reverse('subjects:subject-schedule-roster-import-status', args=[schedule.id])
        rows = [{'student_number': 'QUEUED-1', 'first_name': 'Queued', 'last_name': 'Student'}]

        with patch('subjects.views.import_roster_job.delay') as delayed:
            delayed.return_value = SimpleNamespace(id='test-roster-import')
            with self.captureOnCommitCallbacks(execute=True):
                first = self.client.post(import_url, {'rows': rows}, format='json')
                second = self.client.post(import_url, {'rows': rows}, format='json')

        self.assertEqual(first.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(second.status_code, status.HTTP_202_ACCEPTED)
        self.assertEqual(first.data['job']['id'], second.data['job']['id'])
        self.assertEqual(BackgroundJob.objects.count(), 1)
        job_status = self.client.get(status_url)
        self.assertEqual(job_status.status_code, status.HTTP_200_OK)
        self.assertEqual(job_status.data['job']['id'], first.data['job']['id'])

    def test_roster_import_reports_broker_failure_without_retaining_names(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-import-roster', args=[schedule.id])

        with patch('subjects.views.import_roster_job.delay', side_effect=ConnectionError('broker unavailable')):
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(url, {
                    'rows': [{
                        'student_number': 'BROKER-1',
                        'first_name': 'Private',
                        'last_name': 'Name',
                    }],
                }, format='json')

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)
        job = BackgroundJob.objects.get(pk=response.data['job']['id'])
        self.assertEqual(job.status, BackgroundJob.Status.FAILED)
        self.assertIn('broker unavailable', job.error)
        self.assertEqual(job.payload, {'schedule_id': schedule.id})

    def test_background_roster_validation_failure_rolls_back_every_row(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-import-roster', args=[schedule.id])
        rows = [
            {'student_number': 'RACE-1', 'first_name': 'First', 'last_name': 'Student'},
            {'student_number': 'RACE-2', 'first_name': 'Second', 'last_name': 'Student'},
        ]

        with patch('subjects.views.import_roster_job.delay') as delayed:
            delayed.return_value = SimpleNamespace(id='test-roster-import')
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(url, {'rows': rows}, format='json')
        get_user_model().objects.create(username='RACE-2', role=get_user_model().Role.TEACHER)
        job = BackgroundJob.objects.get(pk=response.data['job']['id'])

        import_roster_job.run(str(job.id))

        job.refresh_from_db()
        self.assertEqual(job.status, BackgroundJob.Status.FAILED)
        self.assertIn('No students were imported', job.error)
        self.assertFalse(StudentProfile.objects.filter(student_number__in=('RACE-1', 'RACE-2')).exists())
        self.assertFalse(ScheduleStudent.objects.filter(schedule=schedule).exists())
        self.assertEqual(job.payload, {'schedule_id': schedule.id})

    def test_background_roster_database_failure_rolls_back_created_accounts(self):
        schedule = self.create_schedule()
        self.client.force_authenticate(self.teacher)
        url = reverse('subjects:subject-schedule-import-roster', args=[schedule.id])
        rows = [
            {'student_number': 'ROLLBACK-BATCH-1', 'first_name': 'First', 'last_name': 'Student'},
            {'student_number': 'ROLLBACK-BATCH-2', 'first_name': 'Second', 'last_name': 'Student'},
        ]

        with patch('subjects.views.import_roster_job.delay') as delayed:
            delayed.return_value = SimpleNamespace(id='test-roster-import')
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(url, {'rows': rows}, format='json')
        job = BackgroundJob.objects.get(pk=response.data['job']['id'])

        with patch(
            'grades.signals.initialize_enrollment_grades_bulk',
            side_effect=RuntimeError('grade initialization failed'),
        ), self.assertRaises(RuntimeError):
            import_roster_job.run(str(job.id))

        job.refresh_from_db()
        self.assertEqual(job.status, BackgroundJob.Status.FAILED)
        self.assertFalse(StudentProfile.objects.filter(student_number__startswith='ROLLBACK-BATCH').exists())
        self.assertFalse(ScheduleStudent.objects.filter(schedule=schedule).exists())
        self.assertEqual(job.payload, {'schedule_id': schedule.id})

    def test_background_roster_import_initializes_grade_rows_for_new_enrollments(self):
        from grades.models import GradeCategory, GradeCategoryChoices, GradeItem, StudentCategoryGrade

        schedule = self.create_schedule()
        category = GradeCategory.objects.create(
            subject=self.subject,
            grading_period='PRELIM',
            category=GradeCategoryChoices.QUIZ,
            name='Import quizzes',
            weight=100,
        )
        GradeItem.objects.create(
            schedule=schedule,
            grade_category=category,
            title='Import quiz',
            points_possible=10,
        )
        self.client.force_authenticate(self.teacher)

        _, job = self.queue_and_run_roster_import(
            reverse('subjects:subject-schedule-import-roster', args=[schedule.id]),
            [{'student_number': 'GRADE-IMPORT-1', 'first_name': 'Grade', 'last_name': 'Student'}],
        )

        profile = StudentProfile.objects.get(student_number='GRADE-IMPORT-1')
        self.assertEqual(job.status, BackgroundJob.Status.SUCCEEDED)
        self.assertTrue(StudentCategoryGrade.objects.filter(
            schedule=schedule,
            student=profile.user,
            grade_category=category,
        ).exists())

    def test_delete_enrollment_deactivates_instead_of_removing(self):
        schedule = self.create_schedule()
        enrollment = ScheduleStudent.objects.create(schedule=schedule, student=self.student)
        self.client.force_authenticate(self.teacher)

        response = self.client.delete(
            reverse('subjects:schedule-student-detail', args=[enrollment.id]),
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        enrollment.refresh_from_db()
        self.assertFalse(enrollment.is_active)
        self.assertEqual(enrollment.deactivated_by, self.teacher)
