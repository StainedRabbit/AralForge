from datetime import time

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import TestCase
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase


def result_rows(response):
    return response.data.get('results', response.data) if isinstance(response.data, dict) else response.data

from accounts.models import StudentProfile
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


class SubjectScheduleApiTests(APITestCase):
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

        imported = self.client.post(
            url,
            {'rows': [{'student_number': '2027-0001'}]},
            format='json',
        )
        self.assertEqual(imported.status_code, status.HTTP_200_OK)
        self.assertEqual(imported.data['added_count'], 1)
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

        imported = self.client.post(url, {'rows': rows}, format='json')
        self.assertEqual(imported.status_code, status.HTTP_200_OK)
        self.assertEqual(imported.data['created_count'], 1)
        credential = imported.data['credentials'][0]
        profile = StudentProfile.objects.select_related('user').get(student_number='2027-NEW-1')
        self.assertEqual(profile.user.email, '')
        self.assertEqual(profile.user.first_name, 'New Middle')
        self.assertEqual(profile.user.last_name, 'Learner')
        self.assertEqual(profile.user.username, '2027-NEW-1')
        self.assertTrue(profile.user.must_change_password)
        self.assertEqual(credential['temporary_password'], '2027-NEW-1')
        self.assertTrue(profile.user.check_password(credential['temporary_password']))
        self.assertTrue(ScheduleStudent.objects.filter(schedule=schedule, student=profile.user).exists())

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
            "Élise MarIA Ana-MaE O'Connor",
        )
        self.assertEqual(preview.data['rows'][0]['student_number'], '2027-mIxEd-01')

        imported = self.client.post(url, {'rows': rows}, format='json')

        self.assertEqual(imported.status_code, status.HTTP_200_OK)
        profile = StudentProfile.objects.select_related('user').get(
            student_number='2027-mIxEd-01',
        )
        self.assertEqual(profile.user.first_name, 'Élise MarIA Ana-MaE')
        self.assertEqual(profile.user.last_name, "O'Connor")

    def test_import_roster_does_not_overwrite_existing_student_names(self):
        schedule = self.create_schedule()
        existing = get_user_model().objects.create_user(
            username='existing-name',
            first_name='Existing',
            last_name='Student',
            role='STUDENT',
        )
        StudentProfile.objects.create(user=existing, student_number='2027-KEEP-NAME')
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            reverse('subjects:subject-schedule-import-roster', args=[schedule.id]),
            {
                'rows': [{
                    'student_number': '2027-KEEP-NAME',
                    'first_name': 'replacement',
                    'last_name': 'name',
                }],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        existing.refresh_from_db()
        self.assertEqual(existing.first_name, 'Existing')
        self.assertEqual(existing.last_name, 'Student')

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
