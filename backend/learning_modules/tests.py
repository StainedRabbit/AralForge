import tempfile
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import patch
from unittest import skipUnless
from pathlib import Path
from decimal import Decimal

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import close_old_connections, connection, connections
from django.test import TestCase, TransactionTestCase
from django.test.utils import CaptureQueriesContext, override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase


def result_rows(response):
    return response.data.get('results', response.data) if isinstance(response.data, dict) else response.data

from accounts.models import User
from grades.models import (
    GradeCategory,
    GradeCategoryChoices,
    GradeItem,
    GradeItemSourceType,
    GradingPeriod,
    StudentGradeItemScore,
)
from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule

from .models import (
    LearningContextType,
    Module,
    ModuleAccess,
    ModuleActivity,
    ModuleActivityAnswer,
    ModuleActivityAttempt,
    ModuleActivityExtension,
    ModuleActivityMatchingPair,
    ModuleActivityQuestion,
    ModuleActivityQuestionChoice,
    ModuleActivitySubmission,
    ModuleLesson,
    ModuleLessonExample,
    ModuleLessonProgress,
    ModuleTopic,
    add_calendar_months,
)


class ModuleAccessApiTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            username='module-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.teacher = User.objects.create_user(
            username='module-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.other_student = User.objects.create_user(
            username='module-other-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.subject = Subject.objects.create(code='CC103', name='Intermediate Programming')
        school_year = SchoolYear.objects.create(start_year=2026, end_year=2027)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        self.schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='TTH',
            start_time='10:00',
            end_time='11:30',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.student)
        self.free_module = Module.objects.create(
            title='Free Topic',
            slug='free-topic',
            subject=self.subject,
            is_published=True,
        )
        self.paid_module = Module.objects.create(
            title='Paid Topic',
            slug='paid-topic',
            is_published=True,
        )
        self.paid_module.subjects.add(self.subject)
        self.advance_subject = Subject.objects.create(
            code='CC104',
            name='Advanced Programming',
        )
        self.advance_module = Module.objects.create(
            title='Advanced Programming Module',
            slug='advanced-programming-module',
            subject=self.advance_subject,
            is_published=True,
        )

    def test_student_sees_enrolled_modules_as_locked_without_access(self):
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/modules/')

        self.assertEqual(response.status_code, 200)
        ids = {module['id'] for module in result_rows(response)}
        self.assertEqual(ids, {self.free_module.id, self.paid_module.id})
        statuses = {module['id']: module['access_status'] for module in result_rows(response)}
        self.assertEqual(statuses[self.free_module.id], 'LOCKED')
        self.assertEqual(statuses[self.paid_module.id], 'LOCKED')
        self.assertNotIn('is_paid', result_rows(response)[0])
        self.assertNotIn('price', result_rows(response)[0])

    def test_student_sees_enrolled_module_after_active_grant(self):
        grant = ModuleAccess.objects.create(
            activated_by=self.teacher,
            module=self.paid_module,
            student=self.student,
            is_active=True,
        )
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/modules/')

        self.assertEqual(response.status_code, 200)
        ids = {module['id'] for module in result_rows(response)}
        self.assertEqual(ids, {self.free_module.id, self.paid_module.id})
        self.assertEqual(
            grant.expires_at.date(),
            add_calendar_months(grant.activated_at, 5).date(),
        )

    def test_assessment_api_is_gone_and_module_workspace_has_no_assessment_data(self):
        ModuleAccess.objects.create(
            activated_by=self.teacher,
            module=self.paid_module,
            student=self.student,
            is_active=True,
        )
        self.client.force_authenticate(self.student)

        retired = self.client.get('/api/assessments/')
        workspace = self.client.get(
            f'/api/modules/modules/{self.paid_module.id}/workspace/?schedule={self.schedule.id}',
        )

        self.assertEqual(retired.status_code, 404)
        self.assertEqual(workspace.status_code, 200)
        self.assertNotIn('assessments', workspace.data)

    def test_advance_study_grant_bypasses_enrollment(self):
        grant = ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ADVANCE_STUDY,
            activated_by=self.teacher,
            module=self.advance_module,
            student=self.student,
        )
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/modules/')

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            self.advance_module.id,
            {module['id'] for module in result_rows(response)},
        )
        grant.refresh_from_db()
        self.assertEqual(grant.status, ModuleAccess.Status.ACTIVE)
        self.assertIsNotNone(grant.expires_at)

    def test_expired_advance_grant_does_not_unlock_module(self):
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ADVANCE_STUDY,
            activated_by=self.teacher,
            expires_at=timezone.now() - timezone.timedelta(days=1),
            module=self.advance_module,
            student=self.student,
        )
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/modules/')

        self.assertNotIn(
            self.advance_module.id,
            {module['id'] for module in result_rows(response)},
        )

    def test_enrolled_and_advance_grants_can_coexist(self):
        enrolled = ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ENROLLED,
            activated_by=self.teacher,
            module=self.paid_module,
            student=self.student,
        )
        advance = ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ADVANCE_STUDY,
            activated_by=self.teacher,
            module=self.paid_module,
            student=self.student,
        )

        self.assertNotEqual(enrolled.id, advance.id)
        self.assertEqual(
            ModuleAccess.objects.filter(
                module=self.paid_module,
                student=self.student,
            ).count(),
            2,
        )

    def test_student_cannot_create_advance_study_grant(self):
        self.client.force_authenticate(self.student)

        response = self.client.post(
            '/api/modules/access/',
            {
                'access_type': ModuleAccess.AccessType.ADVANCE_STUDY,
                'module': self.advance_module.id,
                'student': self.student.id,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 403)

    def test_teacher_creates_status_only_enrolled_grant(self):
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            '/api/modules/access/',
            {
                'module': self.paid_module.id,
                'student': self.student.id,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['access_type'], ModuleAccess.AccessType.ENROLLED)
        self.assertEqual(response.data['status'], ModuleAccess.Status.ACTIVE)
        self.assertTrue(response.data['is_available'])
        self.assertIsNotNone(response.data['expires_at'])
        self.assertNotIn('payment_status', response.data)
        self.assertNotIn('amount_paid', response.data)
        self.assertNotIn('payment_reference', response.data)

    def test_teacher_batch_activates_one_class_without_per_student_requests(self):
        classmates = [
            User.objects.create_user(
                username=f'batch_classmate_{index}',
                password='testpass123',
                role=User.Role.STUDENT,
            )
            for index in range(3)
        ]
        for classmate in classmates:
            ScheduleStudent.objects.create(schedule=self.schedule, student=classmate)
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            '/api/modules/access/batch-activate/',
            {'module': self.paid_module.id, 'schedule': self.schedule.id, 'notes': 'Class activation'},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['student_count'], 4)
        self.assertEqual(response.data['created_count'], 4)
        self.assertEqual(ModuleAccess.objects.filter(
            module=self.paid_module,
            access_type=ModuleAccess.AccessType.ENROLLED,
            is_active=True,
        ).count(), 4)

    def test_teacher_reactivates_historical_grant_and_becomes_activator(self):
        historical = ModuleAccess.objects.create(
            activated_by=None,
            expires_at=None,
            is_active=False,
            module=self.paid_module,
            student=self.student,
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.patch(
            f'/api/modules/access/{historical.id}/',
            {'is_active': True},
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        historical.refresh_from_db()
        self.assertTrue(historical.is_active)
        self.assertTrue(historical.is_available)
        self.assertEqual(historical.activated_by, self.teacher)
        self.assertGreater(historical.expires_at, timezone.now())

    def test_access_type_uses_only_active_class_enrollment(self):
        self.schedule.is_active = False
        self.schedule.save(update_fields=['is_active'])
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            '/api/modules/access/',
            {
                'access_type': ModuleAccess.AccessType.ENROLLED,
                'module': self.paid_module.id,
                'student': self.student.id,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            response.data['access_type'],
            ModuleAccess.AccessType.ADVANCE_STUDY,
        )

    def test_locked_enrolled_module_hides_child_content(self):
        topic = ModuleTopic.objects.create(
            module=self.paid_module,
            title='Locked Topic',
            is_published=True,
        )
        lesson = ModuleLesson.objects.create(
            topic=topic,
            title='Locked Lesson',
            is_published=True,
        )
        activity = ModuleActivity.objects.create(
            module=self.paid_module,
            topic=topic,
            title='Locked Activity',
            instructions='Complete this after activation.',
            is_published=True,
        )
        progress = ModuleLessonProgress.objects.create(
            lesson=lesson,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            completed_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        topic_response = self.client.get('/api/modules/topics/')
        lesson_response = self.client.get('/api/modules/lessons/')
        activity_response = self.client.get('/api/modules/activities/')
        progress_response = self.client.get('/api/modules/lesson-progress/')
        workspace_response = self.client.get(
            f'/api/modules/modules/{self.paid_module.id}/workspace/',
        )

        self.assertNotIn(topic.id, {item['id'] for item in result_rows(topic_response)})
        self.assertNotIn(lesson.id, {item['id'] for item in result_rows(lesson_response)})
        self.assertNotIn(activity.id, {item['id'] for item in result_rows(activity_response)})
        self.assertNotIn(progress.id, {item['id'] for item in result_rows(progress_response)})
        self.assertEqual(workspace_response.status_code, 200)
        self.assertEqual(workspace_response.data['topics'], [])
        self.assertEqual(workspace_response.data['lessons'], [])
        self.assertEqual(workspace_response.data['activities'], [])
        self.assertEqual(workspace_response.data['activity_attempts'], [])
        self.assertNotIn('problems', workspace_response.data)
        downloadable = workspace_response.data['module']['downloadable_topics']
        self.assertEqual([item['id'] for item in downloadable], [topic.id])
        self.assertNotIn('overview', downloadable[0])

    def test_enrolled_grant_unlocks_web_module_content(self):
        topic = ModuleTopic.objects.create(
            module=self.paid_module,
            title='Paid Topic',
            is_published=True,
        )
        lesson = ModuleLesson.objects.create(
            topic=topic,
            title='Paid Lesson',
            is_published=True,
        )
        activity = ModuleActivity.objects.create(
            module=self.paid_module,
            topic=topic,
            title='Paid Activity',
            instructions='Complete the activity.',
            is_published=True,
        )
        progress = ModuleLessonProgress.objects.create(
            lesson=lesson,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            completed_at=timezone.now(),
        )
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ENROLLED,
            activated_by=self.teacher,
            module=self.paid_module,
            student=self.student,
        )
        self.client.force_authenticate(self.student)

        for path, expected_id in (
            ('/api/modules/topics/', topic.id),
            ('/api/modules/lessons/', lesson.id),
            ('/api/modules/activities/', activity.id),
            ('/api/modules/lesson-progress/', progress.id),
        ):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn(expected_id, {item['id'] for item in result_rows(response)})

    def test_locked_student_downloads_topic_pdf(self):
        topic = ModuleTopic.objects.create(
            module=self.paid_module,
            title='Downloadable Topic',
            is_published=True,
        )
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                topic.pdf_file.save(
                    'topic.pdf',
                    ContentFile(b'%PDF-1.4 topic guide'),
                )
                self.client.force_authenticate(self.student)
                topic_response = self.client.get(
                    f'/api/modules/topics/{topic.id}/download_pdf/',
                )
                self.assertEqual(topic_response.status_code, 200)
                self.assertEqual(
                    b''.join(topic_response.streaming_content),
                    b'%PDF-1.4 topic guide',
                )

                self.client.force_authenticate(self.other_student)
                denied = self.client.get(
                    f'/api/modules/topics/{topic.id}/download_pdf/',
                )
                self.assertEqual(denied.status_code, 403)

    def test_activated_student_can_download_topic_pdf(self):
        ModuleAccess.objects.create(
            activated_by=self.teacher,
            module=self.paid_module,
            student=self.student,
        )
        topic = ModuleTopic.objects.create(
            module=self.paid_module,
            title='Activated Download Topic',
            is_published=True,
        )
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                topic.pdf_file.save(
                    'topic.pdf',
                    ContentFile(b'%PDF-1.4 topic guide'),
                )
                self.client.force_authenticate(self.student)

                response = self.client.get(
                    f'/api/modules/topics/{topic.id}/download_pdf/',
                )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    b''.join(response.streaming_content),
                    b'%PDF-1.4 topic guide',
                )

    def test_advance_study_unlocks_child_content_and_reactivation_preserves_progress(self):
        topic = ModuleTopic.objects.create(
            module=self.advance_module,
            title='Advanced Topic',
            is_published=True,
        )
        lesson = ModuleLesson.objects.create(
            topic=topic,
            title='Advanced Lesson',
            is_published=True,
        )
        activity = ModuleActivity.objects.create(
            module=self.advance_module,
            topic=topic,
            title='Advanced Activity',
            instructions='Complete the activity.',
            is_published=True,
        )
        grant = ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ADVANCE_STUDY,
            activated_by=self.teacher,
            module=self.advance_module,
            student=self.student,
        )
        progress = ModuleLessonProgress.objects.create(
            lesson=lesson,
            student=self.student,
            context_type=LearningContextType.PERSONAL,
            completed_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        for path, expected_id in (
            ('/api/modules/topics/', topic.id),
            ('/api/modules/lessons/', lesson.id),
            ('/api/modules/activities/', activity.id),
            ('/api/modules/lesson-progress/', progress.id),
        ):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn(expected_id, {item['id'] for item in result_rows(response)})

        grant.is_active = False
        grant.save()
        hidden_response = self.client.get('/api/modules/lesson-progress/')
        self.assertNotIn(
            progress.id,
            {item['id'] for item in result_rows(hidden_response)},
        )

        grant.is_active = True
        grant.save()
        restored_response = self.client.get('/api/modules/lesson-progress/')
        self.assertIn(
            progress.id,
            {item['id'] for item in result_rows(restored_response)},
        )


class ModuleLessonCrudFilteringApiTests(APITestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username='lesson-filter-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.subject = Subject.objects.create(
            code='FLT101',
            name='Filtered Lessons',
        )
        self.module = Module.objects.create(
            title='Filtered Lesson Module',
            slug='filtered-lesson-module',
            subject=self.subject,
        )
        self.topic = ModuleTopic.objects.create(
            module=self.module,
            title='Selected Topic',
            order=1,
        )
        other_subject = Subject.objects.create(
            code='FLT102',
            name='Unrelated Lessons',
        )
        other_module = Module.objects.create(
            title='Unrelated Lesson Module',
            slug='unrelated-lesson-module',
            subject=other_subject,
        )
        other_topic = ModuleTopic.objects.create(
            module=other_module,
            title='Unrelated Topic',
            order=1,
        )
        ModuleLesson.objects.bulk_create([
            ModuleLesson(
                topic=other_topic,
                title=f'Unrelated Lesson {index}',
                order=index,
            )
            for index in range(1, 106)
        ])
        self.client.force_authenticate(self.teacher)

    def test_created_lesson_is_returned_by_topic_and_module_filters(self):
        create_response = self.client.post(
            '/api/modules/lessons/',
            {
                'topic': self.topic.id,
                'title': 'Saved Through The Editor',
                'order': 1,
                'is_published': False,
            },
            format='json',
        )

        self.assertEqual(create_response.status_code, 201)
        lesson_id = create_response.data['id']
        self.assertTrue(ModuleLesson.objects.filter(pk=lesson_id).exists())

        topic_response = self.client.get(
            f'/api/modules/lessons/?topic={self.topic.id}&limit=100',
        )
        module_response = self.client.get(
            f'/api/modules/lessons/?module={self.module.id}&limit=100',
        )

        self.assertEqual(topic_response.status_code, 200)
        self.assertEqual(module_response.status_code, 200)
        self.assertEqual(topic_response.data['count'], 1)
        self.assertEqual(module_response.data['count'], 1)
        self.assertEqual(result_rows(topic_response)[0]['id'], lesson_id)
        self.assertEqual(result_rows(module_response)[0]['id'], lesson_id)


class ModuleTeacherSummaryApiTests(APITestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username='summary-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.student = User.objects.create_user(
            username='summary-student',
            password='testpass123',
            first_name='Ana',
            last_name='Reyes',
            role=User.Role.STUDENT,
        )
        self.locked_student = User.objects.create_user(
            username='summary-locked',
            password='testpass123',
            first_name='Ben',
            last_name='Santos',
            role=User.Role.STUDENT,
        )
        self.expired_student = User.objects.create_user(
            username='summary-expired',
            password='testpass123',
            first_name='Cia',
            last_name='Dela Cruz',
            role=User.Role.STUDENT,
        )
        self.revoked_student = User.objects.create_user(
            username='summary-revoked',
            password='testpass123',
            first_name='Dan',
            last_name='Garcia',
            role=User.Role.STUDENT,
        )
        self.subject = Subject.objects.create(code='CC201', name='Data Structures')
        school_year = SchoolYear.objects.create(start_year=2026, end_year=2027)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='MWF',
            start_time='07:30',
            end_time='09:00',
            section='A',
        )
        for student in (
            self.student,
            self.locked_student,
            self.expired_student,
            self.revoked_student,
        ):
            ScheduleStudent.objects.create(schedule=schedule, student=student)
        self.module = Module.objects.create(
            title='Teacher Summary Module',
            slug='teacher-summary-module',
            subject=self.subject,
            is_published=True,
        )
        self.module.subjects.add(self.subject)
        self.topic = ModuleTopic.objects.create(
            module=self.module,
            title='Summary Topic',
            is_published=True,
        )
        self.lesson_one = ModuleLesson.objects.create(
            topic=self.topic,
            title='Lesson One',
            order=1,
            is_published=True,
        )
        self.lesson_two = ModuleLesson.objects.create(
            topic=self.topic,
            title='Lesson Two',
            order=2,
            is_published=True,
        )
        self.activity_one = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            title='Activity One',
            instructions='Submit work.',
            is_published=True,
        )
        self.activity_two = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            title='Activity Two',
            instructions='Submit more work.',
            is_published=True,
        )

    def test_teacher_can_fetch_module_summary(self):
        ModuleAccess.objects.create(
            activated_by=self.teacher,
            module=self.module,
            student=self.student,
        )
        ModuleLessonProgress.objects.create(
            lesson=self.lesson_one,
            student=self.student,
            completed_at=timezone.now(),
        )
        ModuleLessonProgress.objects.create(
            lesson=self.lesson_two,
            student=self.student,
        )
        ModuleActivitySubmission.objects.create(
            activity=self.activity_one,
            student=self.student,
            score=90,
            graded_at=timezone.now(),
        )
        ModuleActivitySubmission.objects.create(
            activity=self.activity_two,
            student=self.student,
            text_answer='Needs review.',
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.get(
            f'/api/modules/modules/{self.module.id}/teacher-summary/',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['total_students'], 4)
        self.assertEqual(response.data['total_lessons'], 2)
        self.assertEqual(response.data['total_activities'], 2)
        row = next(
            item
            for item in response.data['students']
            if item['student_id'] == self.student.id
        )
        self.assertEqual(row['access_status'], 'ACTIVE')
        self.assertEqual(row['lesson_progress']['started_count'], 2)
        self.assertEqual(row['lesson_progress']['completed_count'], 1)
        self.assertEqual(row['lesson_progress']['percent_complete'], 50)
        self.assertEqual(row['activity_submissions']['submitted_count'], 2)
        self.assertEqual(row['activity_submissions']['pending_count'], 0)
        self.assertEqual(row['activity_submissions']['graded_count'], 1)
        self.assertEqual(row['activity_submissions']['ungraded_count'], 1)

    def test_student_cannot_fetch_module_summary(self):
        self.client.force_authenticate(self.student)

        response = self.client.get(
            f'/api/modules/modules/{self.module.id}/teacher-summary/',
        )

        self.assertEqual(response.status_code, 403)

    def test_summary_reports_locked_expired_and_revoked_access(self):
        ModuleAccess.objects.create(
            activated_by=self.teacher,
            expires_at=timezone.now() - timezone.timedelta(days=1),
            module=self.module,
            student=self.expired_student,
        )
        ModuleAccess.objects.create(
            is_active=False,
            module=self.module,
            student=self.revoked_student,
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.get(
            f'/api/modules/modules/{self.module.id}/teacher-summary/',
        )

        statuses = {
            item['student_id']: item['access_status']
            for item in response.data['students']
        }
        self.assertEqual(statuses[self.locked_student.id], 'LOCKED')
        self.assertEqual(statuses[self.expired_student.id], 'EXPIRED')
        self.assertEqual(statuses[self.revoked_student.id], 'REVOKED')
        self.assertEqual(response.data['active_access_count'], 0)

    def test_teacher_summary_paginates_with_bounded_queries(self):
        extra_students = [
            User(
                username=f'summary_scale_{index:03d}',
                role=User.Role.STUDENT,
                first_name='Scale',
                last_name=f'{index:03d}',
            )
            for index in range(60)
        ]
        User.objects.bulk_create(extra_students)
        ModuleAccess.objects.bulk_create([
            ModuleAccess(
                activated_by=self.teacher,
                expires_at=timezone.now() + timezone.timedelta(days=30),
                module=self.module,
                student=student,
            )
            for student in extra_students
        ])
        self.client.force_authenticate(self.teacher)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get(
                f'/api/modules/modules/{self.module.id}/teacher-summary/?limit=30&access_status=AVAILED',
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 60)
        self.assertEqual(len(response.data['students']), 30)
        self.assertEqual(response.data['next'], 30)
        self.assertLessEqual(len(queries), 20)

    def test_teacher_summary_cursor_pages_are_stable(self):
        from urllib.parse import urlsplit

        extra_students = [
            User(
                username=f'cursor_summary_{index:03d}',
                role=User.Role.STUDENT,
                first_name='Cursor',
                last_name=f'{index:03d}',
            )
            for index in range(8)
        ]
        User.objects.bulk_create(extra_students)
        ModuleAccess.objects.bulk_create([
            ModuleAccess(
                activated_by=self.teacher,
                expires_at=timezone.now() + timezone.timedelta(days=30),
                module=self.module,
                student=student,
            )
            for student in extra_students
        ])
        self.client.force_authenticate(self.teacher)

        first = self.client.get(
            f'/api/modules/modules/{self.module.id}/teacher-summary/',
            {'access_status': 'AVAILED', 'limit': 3, 'pagination': 'cursor'},
        )
        next_url = urlsplit(first.data['next'])
        second = self.client.get(f'{next_url.path}?{next_url.query}')

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        first_ids = {row['student_id'] for row in first.data['students']}
        second_ids = {row['student_id'] for row in second.data['students']}
        self.assertEqual(len(first_ids), 3)
        self.assertEqual(len(second_ids), 3)
        self.assertFalse(first_ids & second_ids)

    def test_compact_module_list_does_not_query_per_module(self):
        modules = [
            Module(
                title=f'Scale module {index:03d}',
                slug=f'scale-module-{index:03d}',
                is_published=True,
            )
            for index in range(100)
        ]
        Module.objects.bulk_create(modules)
        ModuleTopic.objects.bulk_create([
            ModuleTopic(module=module, title='Published topic', is_published=True)
            for module in modules
        ])
        self.client.force_authenticate(self.teacher)

        with CaptureQueriesContext(connection) as queries:
            response = self.client.get('/api/modules/modules/?view=summary&limit=100')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(result_rows(response)), 100)
        self.assertLessEqual(len(queries), 8)


class ModuleLessonProgressApiTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            username='lesson-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.other_student = User.objects.create_user(
            username='other-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.teacher = User.objects.create_user(
            username='lesson-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.subject = Subject.objects.create(code='CC102', name='Java Programming')
        school_year = SchoolYear.objects.create(start_year=2026, end_year=2027)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        self.schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='MWF',
            start_time='08:00',
            end_time='09:00',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.student)
        self.module = Module.objects.create(
            title='CC 102 Module',
            slug='cc-102-module-tests',
            subject=self.subject,
            is_published=True,
        )
        self.module.subjects.add(self.subject)
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ENROLLED,
            activated_by=self.teacher,
            module=self.module,
            student=self.student,
        )
        self.topic = ModuleTopic.objects.create(
            module=self.module,
            title='Java Foundations',
            order=1,
            is_published=True,
        )
        self.lesson_one = ModuleLesson.objects.create(
            topic=self.topic,
            title='Lesson One',
            order=1,
            teacher_notes='Private note',
            remediation='Private remediation',
            enrichment='Private enrichment',
            acquisition='Private teaching flow',
            is_published=True,
        )
        self.lesson_two = ModuleLesson.objects.create(
            topic=self.topic,
            title='Lesson Two',
            order=2,
            is_published=True,
        )

    def test_student_lesson_response_hides_teacher_planning_fields(self):
        self.client.force_authenticate(self.student)

        response = self.client.get(f'/api/modules/lessons/{self.lesson_one.id}/')

        self.assertEqual(response.status_code, 200)
        for field in (
            'acquisition',
            'making_meaning',
            'transfer',
            'teacher_notes',
            'answer_key',
            'expected_outputs',
            'common_misconceptions',
            'teaching_tips',
            'remediation',
            'enrichment',
        ):
            self.assertNotIn(field, response.data)

    def test_lesson_contract_excludes_removed_sections(self):
        removed_fields = {
            'apply_what_you_learned',
            'evidence_of_learning',
            'key_terms',
            'reflection',
            'rubric',
        }
        self.client.force_authenticate(self.teacher)

        response = self.client.get(f'/api/modules/lessons/{self.lesson_one.id}/')

        self.assertEqual(response.status_code, 200)
        self.assertTrue(removed_fields.isdisjoint(response.data))
        model_fields = {field.name for field in ModuleLesson._meta.get_fields()}
        self.assertTrue(removed_fields.isdisjoint(model_fields))

    def test_teacher_can_duplicate_lesson_after_section_removal(self):
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            f'/api/modules/lessons/{self.lesson_one.id}/duplicate/',
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['title'], 'Copy of Lesson One')
        self.assertEqual(response.data['learning_targets'], self.lesson_one.learning_targets)
        for field in (
            'apply_what_you_learned',
            'evidence_of_learning',
            'key_terms',
            'reflection',
            'rubric',
        ):
            self.assertNotIn(field, response.data)

    def test_student_cannot_create_progress_for_another_student(self):
        self.client.force_authenticate(self.student)

        response = self.client.post(
            '/api/modules/lesson-progress/',
            {
                'lesson': self.lesson_one.id,
                'student': self.other_student.id,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)


class PaperMainActivityEntryApiTests(APITestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username='paper-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.student = User.objects.create_user(
            username='paper-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.other_student = User.objects.create_user(
            username='paper-other',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.unenrolled_student = User.objects.create_user(
            username='paper-unenrolled',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.subject = Subject.objects.create(code='PAPER101', name='Paper Quiz Subject')
        school_year = SchoolYear.objects.create(start_year=2028, end_year=2029)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        self.schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='MWF',
            start_time='08:00',
            end_time='09:00',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.student)
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.other_student)
        self.module = Module.objects.create(
            title='Paper Quiz Module',
            slug='paper-quiz-module',
            subject=self.subject,
            is_published=True,
        )
        self.module.subjects.add(self.subject)
        topic = ModuleTopic.objects.create(
            module=self.module,
            title='Paper Topic',
            is_published=True,
        )
        lesson = ModuleLesson.objects.create(
            topic=topic,
            title='Paper Lesson',
            is_published=True,
        )
        self.activity = ModuleActivity.objects.create(
            module=self.module,
            topic=topic,
            lesson=lesson,
            title='Period Quiz',
            instructions='Answer every question.',
            points_possible=Decimal('12.00'),
            max_attempts=1,
            is_published=True,
        )
        self.category = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Prelim Quizzes',
            weight=Decimal('100.00'),
        )
        self.item = GradeItem.objects.create(
            schedule=self.schedule,
            grade_category=self.category,
            title=self.activity.title,
            points_possible=self.activity.points_possible,
            source_type=GradeItemSourceType.MODULE_ACTIVITY,
            module_activity=self.activity,
        )
        ModuleActivityQuestion.objects.create(
            activity=self.activity,
            question_type=ModuleActivityQuestion.QuestionType.FILL_BLANK,
            prompt='Type JVM.',
            points=Decimal('12.00'),
            correct_text_answers=['JVM'],
        )

    def paper_payload(self, rows=None):
        return {
            'grade_item': self.item.id,
            'scores': rows if rows is not None else [
                {'student': self.student.id, 'score': '9.00'},
            ],
        }

    def test_teacher_records_batch_and_corrects_score_without_answers(self):
        abandoned = ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            self.paper_payload([
                {'student': self.student.id, 'score': '9.00'},
                {'student': self.other_student.id, 'score': '0.00'},
            ]),
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['created_count'], 2)
        self.assertEqual(response.data['updated_count'], 0)
        first = next(row for row in response.data['attempts'] if row['student'] == self.student.id)
        self.assertEqual(first['submission_method'], 'PAPER')
        self.assertEqual(first['attempt_number'], 2)
        self.assertEqual(Decimal(first['score']), Decimal('9.00'))
        self.assertEqual(Decimal(first['max_score']), Decimal('12.00'))
        self.assertEqual(first['recorded_by'], self.teacher.id)
        self.assertEqual(first['paper_grade_item'], self.item.id)
        self.assertFalse(ModuleAccess.objects.filter(student=self.student, module=self.module).exists())
        attempt = ModuleActivityAttempt.objects.get(pk=first['id'])
        self.assertFalse(attempt.answers.exists())
        score = StudentGradeItemScore.objects.get(
            grade_item=self.item,
            student=self.student,
        )
        self.assertEqual(score.raw_score, Decimal('9.00'))
        self.assertEqual(score.origin, StudentGradeItemScore.Origin.AUTOMATIC)
        zero = StudentGradeItemScore.objects.get(
            grade_item=self.item,
            student=self.other_student,
        )
        self.assertEqual(zero.raw_score, Decimal('0.00'))

        update = self.client.put(
            f'/api/modules/activity-attempts/{attempt.id}/paper-score/',
            {'score': '6.50'},
            format='json',
        )

        self.assertEqual(update.status_code, 200, update.data)
        self.assertEqual(Decimal(update.data['score']), Decimal('6.50'))
        score.refresh_from_db()
        self.assertEqual(score.raw_score, Decimal('6.50'))
        self.assertTrue(ModuleActivityAttempt.objects.filter(pk=abandoned.pk).exists())

        upsert = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            self.paper_payload([{'student': self.student.id, 'score': '5.25'}]),
            format='json',
        )
        self.assertEqual(upsert.status_code, 200, upsert.data)
        self.assertEqual(upsert.data['created_count'], 0)
        self.assertEqual(upsert.data['updated_count'], 1)
        self.assertEqual(upsert.data['attempts'][0]['id'], attempt.id)
        self.assertEqual(Decimal(upsert.data['attempts'][0]['score']), Decimal('5.25'))

    def test_paper_scores_require_teacher_enrollment_and_no_online_submission(self):
        self.client.force_authenticate(self.student)
        forbidden = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            self.paper_payload(),
            format='json',
        )
        self.assertEqual(forbidden.status_code, 403)

        self.client.force_authenticate(self.teacher)
        unenrolled = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            self.paper_payload([
                {'student': self.unenrolled_student.id, 'score': '8.00'},
            ]),
            format='json',
        )
        self.assertEqual(unenrolled.status_code, 400)

        ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.other_student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
            submission_method=ModuleActivityAttempt.SubmissionMethod.ONLINE,
            score=Decimal('6.00'),
            max_score=Decimal('6.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        online_duplicate = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            self.paper_payload([
                {'student': self.other_student.id, 'score': '8.00'},
            ]),
            format='json',
        )
        self.assertEqual(online_duplicate.status_code, 400)

    def test_paper_score_blocks_abandoned_online_attempt_submission(self):
        grant = ModuleAccess.objects.create(
            activated_by=self.teacher,
            module=self.module,
            student=self.student,
            is_active=True,
        )
        self.assertTrue(grant.is_available)
        abandoned = ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
        )
        self.client.force_authenticate(self.teacher)
        paper = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            self.paper_payload(),
            format='json',
        )
        self.assertEqual(paper.status_code, 200, paper.data)

        self.client.force_authenticate(self.student)
        submit = self.client.post(
            f'/api/modules/activity-attempts/{abandoned.id}/submit/?schedule={self.schedule.id}',
        )
        self.assertEqual(submit.status_code, 403)
        create = self.client.post(
            f'/api/modules/activities/{self.activity.id}/start-attempt/?schedule={self.schedule.id}',
            {},
            format='json',
        )
        self.assertEqual(create.status_code, 409)
        self.assertTrue(create.data['state']['paper_terminal'])
        abandoned.refresh_from_db()
        self.assertEqual(abandoned.status, ModuleActivityAttempt.Status.SUPERSEDED)

    def test_paper_score_batch_rejects_invalid_rows_atomically(self):
        self.client.force_authenticate(self.teacher)
        invalid = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            self.paper_payload([
                {'student': self.student.id, 'score': '9.00'},
                {'student': self.other_student.id, 'score': '12.01'},
            ]),
            format='json',
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertFalse(ModuleActivityAttempt.objects.filter(
            submission_method=ModuleActivityAttempt.SubmissionMethod.PAPER,
        ).exists())

        duplicate_response = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            self.paper_payload([
                {'student': self.student.id, 'score': '8.00'},
                {'student': self.student.id, 'score': '7.00'},
            ]),
            format='json',
        )
        self.assertEqual(duplicate_response.status_code, 400)
        self.assertFalse(ModuleActivityAttempt.objects.filter(
            student=self.student,
            submission_method=ModuleActivityAttempt.SubmissionMethod.PAPER,
        ).exists())

        manual_item = GradeItem.objects.create(
            schedule=self.schedule,
            grade_category=self.category,
            title='Manual item',
            points_possible=Decimal('12.00'),
            source_type=GradeItemSourceType.MANUAL,
        )
        wrong_item = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            {
                'grade_item': manual_item.id,
                'scores': [{'student': self.student.id, 'score': '8.00'}],
            },
            format='json',
        )
        self.assertEqual(wrong_item.status_code, 400)

        self.schedule.is_active = False
        self.schedule.save(update_fields=['is_active'])
        archived = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            self.paper_payload(),
            format='json',
        )
        self.assertEqual(archived.status_code, 400)
        self.assertFalse(ModuleActivityAttempt.objects.filter(
            submission_method=ModuleActivityAttempt.SubmissionMethod.PAPER,
        ).exists())

    def test_equivalent_online_and_paper_scores_normalize_identically(self):
        online_student = User.objects.create_user(
            username='paper-online-equivalent',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        ScheduleStudent.objects.create(schedule=self.schedule, student=online_student)
        ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=online_student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
            submission_method=ModuleActivityAttempt.SubmissionMethod.ONLINE,
            score=Decimal('7.50'),
            max_score=Decimal('12.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        self.client.force_authenticate(self.teacher)
        paper = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            self.paper_payload([
                {'student': self.student.id, 'score': '7.50'},
            ]),
            format='json',
        )
        self.assertEqual(paper.status_code, 200, paper.data)
        online_score = StudentGradeItemScore.objects.get(
            grade_item=self.item,
            student=online_student,
        )
        paper_score = StudentGradeItemScore.objects.get(
            grade_item=self.item,
            student=self.student,
        )
        self.assertEqual(online_score.raw_score, paper_score.raw_score)

    def test_paper_score_is_scoped_to_exact_class_item(self):
        second_schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=self.schedule.school_year_semester,
            days='TTH',
            start_time='09:00',
            end_time='10:00',
            section='B',
        )
        ScheduleStudent.objects.create(schedule=second_schedule, student=self.student)
        second_item = GradeItem.objects.create(
            schedule=second_schedule,
            grade_category=self.category,
            title=self.activity.title,
            points_possible=self.activity.points_possible,
            source_type=GradeItemSourceType.MODULE_ACTIVITY,
            module_activity=self.activity,
        )
        self.client.force_authenticate(self.teacher)
        response = self.client.post(
            '/api/modules/activity-attempts/paper-scores/',
            self.paper_payload(),
            format='json',
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(StudentGradeItemScore.objects.filter(
            grade_item=self.item,
            student=self.student,
            raw_score=Decimal('9.00'),
        ).exists())
        self.assertFalse(StudentGradeItemScore.objects.filter(
            grade_item=second_item,
            student=self.student,
        ).exists())

    def test_grade_item_api_rejects_duplicate_activity_link_for_same_class(self):
        self.client.force_authenticate(self.teacher)
        duplicate = self.client.post(
            '/api/grades/items/',
            {
                'schedule': self.schedule.id,
                'grade_category': self.category.id,
                'title': self.activity.title,
                'points_possible': '12.00',
                'source_type': GradeItemSourceType.MODULE_ACTIVITY,
                'module_activity': self.activity.id,
            },
            format='json',
        )
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn('module_activity', duplicate.data)


class ModuleLessonProgressContinuationApiTests(APITestCase):
    def setUp(self):
        ModuleLessonProgressApiTests.setUp(self)

    def completion_payload(self, lesson=None):
        return {
            'lesson': (lesson or self.lesson_one).id,
            'student': self.student.id,
            'context_type': LearningContextType.CLASS,
            'schedule': self.schedule.id,
            'completed_at': '2026-06-24T08:00:00Z',
        }

    def test_progress_identity_cannot_be_reassigned(self):
        progress = ModuleLessonProgress.objects.create(
            lesson=self.lesson_one,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
        )
        self.client.force_authenticate(self.student)

        response = self.client.patch(
            f'/api/modules/lesson-progress/{progress.id}/?schedule={self.schedule.id}',
            {'lesson': self.lesson_two.id},
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        progress.refresh_from_db()
        self.assertEqual(progress.lesson, self.lesson_one)

    def test_student_cannot_complete_lesson_before_main_activity_submission(self):
        activity = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            lesson=self.lesson_one,
            title='Main Activity',
            instructions='Answer the check.',
            activity_type=ModuleActivity.ActivityType.INTERACTIVE,
            is_published=True,
        )
        ModuleActivityQuestion.objects.create(
            activity=activity,
            question_type=ModuleActivityQuestion.QuestionType.FILL_BLANK,
            prompt='What language are we learning?',
            correct_text_answers=['Java'],
            points=1,
        )
        self.client.force_authenticate(self.student)

        response = self.client.post(
            '/api/modules/lesson-progress/',
            self.completion_payload(),
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('Finish the Main Activity', str(response.data))

    def test_student_can_complete_lesson_after_main_activity_submission(self):
        activity = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            lesson=self.lesson_one,
            title='Main Activity',
            instructions='Answer the check.',
            activity_type=ModuleActivity.ActivityType.INTERACTIVE,
            is_published=True,
        )
        ModuleActivityAttempt.objects.create(
            activity=activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
            status=ModuleActivityAttempt.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        response = self.client.post(
            '/api/modules/lesson-progress/',
            self.completion_payload(),
            format='json',
        )

        self.assertEqual(response.status_code, 201)

    def test_student_can_complete_after_reaching_passing_score(self):
        activity = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            lesson=self.lesson_one,
            title='Passing activity',
            instructions='Reach the target.',
            activity_type=ModuleActivity.ActivityType.INTERACTIVE,
            max_attempts=2,
            passing_score=Decimal('1.00'),
            is_published=True,
        )
        ModuleActivityAttempt.objects.create(
            activity=activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
            score=Decimal('1.00'),
            max_score=Decimal('1.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        response = self.client.post(
            '/api/modules/lesson-progress/',
            self.completion_payload(),
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)

    def test_student_cannot_complete_after_failed_attempt_with_retry_remaining(self):
        activity = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            lesson=self.lesson_one,
            title='Retry activity',
            instructions='Reach the target.',
            activity_type=ModuleActivity.ActivityType.INTERACTIVE,
            max_attempts=2,
            passing_score=Decimal('1.00'),
            is_published=True,
        )
        ModuleActivityAttempt.objects.create(
            activity=activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
            score=Decimal('0.00'),
            max_score=Decimal('1.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        response = self.client.post(
            '/api/modules/lesson-progress/',
            self.completion_payload(),
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('finish all attempts', str(response.data))

    def test_student_can_complete_after_failed_attempts_are_exhausted(self):
        activity = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            lesson=self.lesson_one,
            title='Exhausted activity',
            instructions='Reach the target.',
            activity_type=ModuleActivity.ActivityType.INTERACTIVE,
            max_attempts=2,
            passing_score=Decimal('1.00'),
            is_published=True,
        )
        for attempt_number in (1, 2):
            ModuleActivityAttempt.objects.create(
                activity=activity,
                student=self.student,
                context_type=LearningContextType.CLASS,
                schedule=self.schedule,
                attempt_number=attempt_number,
                score=Decimal('0.00'),
                max_score=Decimal('1.00'),
                status=ModuleActivityAttempt.Status.SUBMITTED,
                submitted_at=timezone.now(),
            )
        self.client.force_authenticate(self.student)

        response = self.client.post(
            '/api/modules/lesson-progress/',
            self.completion_payload(),
            format='json',
        )

        self.assertEqual(response.status_code, 201, response.data)

    def test_completing_all_lessons_rolls_up_topic_and_module(self):
        self.client.force_authenticate(self.student)

        first_response = self.client.post(
            '/api/modules/lesson-progress/',
            self.completion_payload(),
            format='json',
        )
        second_response = self.client.post(
            '/api/modules/lesson-progress/',
            {
                **self.completion_payload(self.lesson_two),
                'completed_at': '2026-06-24T09:00:00Z',
            },
            format='json',
        )

        self.assertEqual(first_response.status_code, 201)
        self.assertEqual(second_response.status_code, 201)
        self.assertIsNotNone(
            self.topic.progress.get(student=self.student).completed_at
        )
        self.assertIsNotNone(
            self.module.progress.get(student=self.student).completed_at
        )

    def test_publishing_a_new_lesson_reopens_completion(self):
        ModuleLessonProgress.objects.create(
            lesson=self.lesson_one,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            completed_at=timezone.now(),
        )
        ModuleLessonProgress.objects.create(
            lesson=self.lesson_two,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            completed_at=timezone.now(),
        )

        ModuleLesson.objects.create(
            topic=self.topic,
            title='Lesson Three',
            order=3,
            is_published=True,
        )

        self.assertIsNone(
            self.topic.progress.get(student=self.student).completed_at
        )
        self.assertIsNone(
            self.module.progress.get(student=self.student).completed_at
        )

    def test_teacher_can_inspect_student_lesson_progress(self):
        ModuleLessonProgress.objects.create(
            lesson=self.lesson_one,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.get('/api/modules/lesson-progress/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(result_rows(response)), 1)


class LearningContextMainActivityApiTests(APITestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username='context-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.student = User.objects.create_user(
            username='context-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.other_student = User.objects.create_user(
            username='context-other-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.subject = Subject.objects.create(code='CTX101', name='Learning contexts')
        school_year = SchoolYear.objects.create(start_year=2045, end_year=2046)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
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
        ScheduleStudent.objects.create(schedule=self.schedule_a, student=self.student)
        ScheduleStudent.objects.create(schedule=self.schedule_b, student=self.student)
        self.module = Module.objects.create(
            title='Context module',
            slug='context-module',
            subject=self.subject,
            is_published=True,
        )
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ENROLLED,
            activated_by=self.teacher,
            module=self.module,
            student=self.student,
        )
        self.topic = ModuleTopic.objects.create(
            module=self.module,
            title='Context topic',
            is_published=True,
        )
        self.lesson = ModuleLesson.objects.create(
            topic=self.topic,
            title='Context lesson',
            is_published=True,
        )
        self.activity = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            lesson=self.lesson,
            title='Context Main Activity',
            instructions='Complete in the selected context.',
            max_attempts=2,
            grading_period=ModuleActivity.GradingPeriod.PRELIM,
            is_published=True,
        )
        self.question = ModuleActivityQuestion.objects.create(
            activity=self.activity,
            question_type=ModuleActivityQuestion.QuestionType.FILL_BLANK,
            prompt='Name the active context.',
            correct_text_answers=['class'],
            explanation='Each class keeps a separate record.',
            points=Decimal('1.00'),
        )

    def create_attempt(self, *, schedule=None, context_type=LearningContextType.CLASS,
                       attempt_number=1, student=None, score='0.00'):
        return ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=student or self.student,
            context_type=context_type,
            schedule=schedule,
            attempt_number=attempt_number,
            score=Decimal(score),
            max_score=Decimal('1.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )

    def test_module_workspace_scopes_attempts_and_returns_context_metadata(self):
        attempt_a = self.create_attempt(schedule=self.schedule_a)
        self.create_attempt(schedule=self.schedule_b)
        self.create_attempt(context_type=LearningContextType.LEGACY, schedule=None)
        self.client.force_authenticate(self.student)

        response = self.client.get(
            f'/api/modules/modules/{self.module.id}/workspace/?schedule={self.schedule_a.id}',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [row['id'] for row in response.data['activity_attempts']],
            [attempt_a.id],
        )
        self.assertEqual(response.data['learning_context'], {
            'context_type': LearningContextType.CLASS,
            'schedule': self.schedule_a.id,
            'label': 'CTX101 A',
        })
        self.assertEqual(
            response.data['legacy_history_counts'],
            {str(self.activity.id): 1},
        )

    def test_review_unlock_does_not_leak_between_classes(self):
        self.create_attempt(schedule=self.schedule_a, attempt_number=1)
        self.create_attempt(schedule=self.schedule_a, attempt_number=2)
        self.create_attempt(schedule=self.schedule_b, attempt_number=1)
        self.client.force_authenticate(self.student)

        unlocked = self.client.get(
            f'/api/modules/activity-questions/?schedule={self.schedule_a.id}',
        )
        locked = self.client.get(
            f'/api/modules/activity-questions/?schedule={self.schedule_b.id}',
        )
        unlocked_row = next(
            row for row in result_rows(unlocked) if row['id'] == self.question.id
        )
        locked_row = next(
            row for row in result_rows(locked) if row['id'] == self.question.id
        )

        self.assertEqual(unlocked_row['correct_text_answers'], ['class'])
        self.assertEqual(unlocked_row['explanation'], 'Each class keeps a separate record.')
        self.assertNotIn('correct_text_answers', locked_row)
        self.assertNotIn('explanation', locked_row)

    def test_personal_study_workspace_excludes_class_and_legacy_attempts(self):
        personal_student = User.objects.create_user(
            username='context-personal-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ADVANCE_STUDY,
            activated_by=self.teacher,
            expires_at=timezone.now() + timezone.timedelta(days=30),
            module=self.module,
            student=personal_student,
        )
        personal = self.create_attempt(
            context_type=LearningContextType.PERSONAL,
            schedule=None,
            student=personal_student,
        )
        self.create_attempt(
            context_type=LearningContextType.LEGACY,
            schedule=None,
            student=personal_student,
        )
        self.client.force_authenticate(personal_student)

        response = self.client.get(
            f'/api/modules/modules/{self.module.id}/workspace/?context=PERSONAL',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(
            [row['id'] for row in response.data['activity_attempts']],
            [personal.id],
        )
        self.assertEqual(response.data['learning_context']['context_type'], 'PERSONAL')
        self.assertEqual(response.data['learning_context']['label'], 'Personal Study')

    def test_legacy_history_is_read_only_student_owned_and_summary_only(self):
        own = self.create_attempt(
            context_type=LearningContextType.LEGACY,
            schedule=None,
        )
        own.question_snapshot = [{'id': self.question.id, 'correct_text_answers': ['secret']}]
        own.draft_answers = {str(self.question.id): {'text_answer': 'secret'}}
        own.save(update_fields=['question_snapshot', 'draft_answers'])
        self.create_attempt(
            context_type=LearningContextType.LEGACY,
            schedule=None,
            student=self.other_student,
        )
        self.client.force_authenticate(self.student)

        response = self.client.get(
            f'/api/modules/activities/{self.activity.id}/legacy-history/',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row['id'] for row in response.data['attempts']], [own.id])
        self.assertNotIn('question_snapshot', response.data['attempts'][0])
        self.assertNotIn('draft_answers', response.data['attempts'][0])


class ModuleLessonExampleApiTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            username='example-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.teacher = User.objects.create_user(
            username='example-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.subject = Subject.objects.create(code='CC102X', name='Examples Subject')
        school_year = SchoolYear.objects.create(start_year=2026, end_year=2027)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='MWF',
            start_time='08:00',
            end_time='09:00',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=schedule, student=self.student)
        self.module = Module.objects.create(
            title='Examples Module',
            slug='examples-module',
            subject=self.subject,
            is_published=True,
        )
        self.topic = ModuleTopic.objects.create(
            module=self.module,
            title='Examples Topic',
            is_published=True,
        )
        self.lesson = ModuleLesson.objects.create(
            topic=self.topic,
            title='Examples Lesson',
            is_published=True,
        )
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ENROLLED,
            activated_by=self.teacher,
            module=self.module,
            student=self.student,
        )

    def svg_upload(self, name='example.svg'):
        return SimpleUploadedFile(
            name,
            b'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            content_type='image/svg+xml',
        )

    def test_teacher_can_upload_svg_lesson_example(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                self.client.force_authenticate(self.teacher)

                response = self.client.post(
                    '/api/modules/lesson-examples/',
                    {
                        'lesson': self.lesson.id,
                        'order': 1,
                        'title': 'Example One',
                        'alt_text': 'Flowchart example',
                        'body': 'Read the diagram.',
                        'common_mistake': 'Wrong shape.',
                        'mini_check': 'Which symbol is used?',
                        'is_published': 'true',
                        'image': self.svg_upload(),
                    },
                    format='multipart',
                )

                self.assertEqual(response.status_code, 201)
                self.assertTrue(response.data['image'].endswith('.svg'))
                self.assertEqual(response.data['body'], 'Read the diagram.')
                self.assertNotIn('mini_check', response.data)
                model_fields = {
                    field.name for field in ModuleLessonExample._meta.get_fields()
                }
                self.assertNotIn('mini_check', model_fields)

    def test_student_can_read_published_examples_after_access(self):
        example = ModuleLessonExample.objects.create(
            lesson=self.lesson,
            order=1,
            title='Visible Example',
            body='Student can see this.',
            is_published=True,
        )
        ModuleLessonExample.objects.create(
            lesson=self.lesson,
            order=2,
            title='Hidden Example',
            is_published=False,
        )
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/lesson-examples/')

        self.assertEqual(response.status_code, 200)
        ids = {item['id'] for item in result_rows(response)}
        self.assertIn(example.id, ids)
        self.assertEqual(len(ids), 1)

    def test_student_cannot_create_lesson_example(self):
        self.client.force_authenticate(self.student)

        response = self.client.post(
            '/api/modules/lesson-examples/',
            {
                'lesson': self.lesson.id,
                'order': 1,
                'title': 'Blocked Example',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 403)

    def test_teacher_can_reorder_and_delete_lesson_example(self):
        example = ModuleLessonExample.objects.create(
            lesson=self.lesson,
            order=1,
            title='Editable Example',
        )
        self.client.force_authenticate(self.teacher)

        patch_response = self.client.patch(
            f'/api/modules/lesson-examples/{example.id}/',
            {'order': 5, 'title': 'Updated Example'},
            format='json',
        )
        delete_response = self.client.delete(
            f'/api/modules/lesson-examples/{example.id}/',
        )

        self.assertEqual(patch_response.status_code, 200)
        self.assertEqual(patch_response.data['order'], 5)
        self.assertEqual(delete_response.status_code, 204)
        self.assertFalse(ModuleLessonExample.objects.filter(id=example.id).exists())


class PrintablePdfApiTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            username='pdf-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.teacher = User.objects.create_user(
            username='pdf-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.subject = Subject.objects.create(code='PDF101', name='Printable PDF')
        self.module = Module.objects.create(
            title='Printable Module',
            slug='printable-module',
            subject=self.subject,
            is_published=True,
        )
        self.topic = ModuleTopic.objects.create(
            module=self.module,
            title='Printable Topic',
            is_published=True,
        )
        self.lesson = ModuleLesson.objects.create(
            topic=self.topic,
            title='Printable Lesson',
            learning_targets='Read the printable lesson.',
            is_published=True,
        )
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ENROLLED,
            activated_by=self.teacher,
            module=self.module,
            student=self.student,
        )

    def fake_topic_pdf(self, topic):
        topic.pdf_file.save(
            'generated-topic.pdf',
            ContentFile(b'%PDF-1.4 generated topic'),
            save=False,
        )
        topic.pdf_generated_at = timezone.now()
        topic.pdf_is_outdated = False
        topic.save(update_fields=['pdf_file', 'pdf_generated_at', 'pdf_is_outdated'])
        return topic

    def test_published_topic_pdf_generation_runs_after_commit(self):
        with patch('learning_modules.models.safe_generate_topic_pdf') as generate_pdf:
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                topic = ModuleTopic.objects.create(
                    module=self.module,
                    title='Deferred Printable Topic',
                    is_published=True,
                )
                generate_pdf.assert_not_called()

            self.assertEqual(len(callbacks), 1)
            generate_pdf.assert_called_once_with(topic)

    def test_printable_lesson_sections_exclude_removed_fields(self):
        from learning_modules.services.pdf_generation import lesson_context

        section_titles = {
            section['title']
            for section in lesson_context(self.lesson)['sections']
        }

        self.assertIn("What We'll Learn", section_titles)
        self.assertTrue({
            'Words We\'ll Use',
            'Now We Apply',
            'How Our Work Will Be Checked',
            'Let\'s Reflect',
            'How We Show Learning',
        }.isdisjoint(section_titles))

    def test_retired_module_and_lesson_pdf_endpoints_return_not_found(self):
        self.client.force_authenticate(self.teacher)

        for method, path in (
            ('get', f'/api/modules/modules/{self.module.id}/download-pdf/'),
            ('post', f'/api/modules/modules/{self.module.id}/regenerate_pdf/'),
            ('get', f'/api/modules/lessons/{self.lesson.id}/download_pdf/'),
            ('post', f'/api/modules/lessons/{self.lesson.id}/regenerate_pdf/'),
        ):
            response = getattr(self.client, method)(path)
            self.assertEqual(response.status_code, 404)

    def test_module_and_lesson_payloads_exclude_retired_pdf_fields(self):
        self.client.force_authenticate(self.teacher)

        module_response = self.client.get(f'/api/modules/modules/{self.module.id}/')
        lesson_response = self.client.get(f'/api/modules/lessons/{self.lesson.id}/')

        self.assertEqual(module_response.status_code, 200)
        self.assertEqual(lesson_response.status_code, 200)
        for payload in (module_response.data, lesson_response.data):
            self.assertTrue({
                'pdf_file',
                'pdf_generated_at',
                'pdf_is_outdated',
                'has_pdf',
            }.isdisjoint(payload))

    def test_teacher_can_regenerate_topic_pdf(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                self.client.force_authenticate(self.teacher)
                with patch(
                    'learning_modules.services.pdf_generation.generate_topic_pdf',
                    side_effect=self.fake_topic_pdf,
                ):
                    with self.captureOnCommitCallbacks(execute=True):
                        response = self.client.post(
                            f'/api/modules/topics/{self.topic.id}/regenerate_pdf/',
                        )

                self.assertEqual(response.status_code, 202)
                self.assertIn('job', response.data)
                self.topic.refresh_from_db()
                self.assertTrue(self.topic.pdf_file)
                self.assertFalse(self.topic.pdf_is_outdated)
                self.assertIsNotNone(self.topic.pdf_generated_at)

    def test_topic_pdf_contains_published_lessons_and_blank_main_activity(self):
        from learning_modules.services.pdf_generation import generate_topic_pdf

        self.lesson.teacher_notes = 'hidden teacher note'
        self.lesson.answer_key = 'hidden answer key'
        self.lesson.save()
        unpublished_lesson = ModuleLesson.objects.create(
            topic=self.topic,
            title='Hidden Draft Lesson',
            is_published=False,
        )
        activity = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            lesson=self.lesson,
            title='Printable Main Activity',
            instructions='Complete the blank worksheet.',
            is_published=True,
        )
        question = ModuleActivityQuestion.objects.create(
            activity=activity,
            question_type=ModuleActivityQuestion.QuestionType.MULTIPLE_CHOICE,
            prompt='Which answer is correct?',
            explanation='hidden explanation',
            points=25,
        )
        ModuleActivityQuestionChoice.objects.create(
            question=question,
            text='Visible option',
            is_correct=True,
        )

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                with patch(
                    'learning_modules.services.pdf_generation.render_pdf',
                    return_value=b'%PDF-1.4 generated topic',
                ) as render_pdf:
                    generate_topic_pdf(self.topic)

        html = render_pdf.call_args.args[0]
        self.assertIn(self.topic.title, html)
        self.assertIn(self.lesson.title, html)
        self.assertIn('Printable Main Activity', html)
        self.assertIn('Which answer is correct?', html)
        self.assertIn('Visible option', html)
        self.assertNotIn(unpublished_lesson.title, html)
        self.assertNotIn('hidden teacher note', html)
        self.assertNotIn('hidden answer key', html)
        self.assertNotIn('hidden explanation', html)
        self.assertNotIn('25 pts', html)

    def test_main_activity_question_change_invalidates_topic_pdf(self):
        activity = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            lesson=self.lesson,
            title='Main Activity',
            instructions='Answer the questions.',
            is_published=True,
        )
        generated_at = timezone.now()
        ModuleTopic.objects.filter(pk=self.topic.pk).update(
            pdf_generated_at=generated_at,
            pdf_is_outdated=False,
        )

        ModuleActivityQuestion.objects.create(
            activity=activity,
            question_type=ModuleActivityQuestion.QuestionType.FILL_BLANK,
            prompt='A newly added printable question',
        )

        self.topic.refresh_from_db()
        self.assertTrue(self.topic.pdf_is_outdated)

    def test_topic_pdf_includes_main_activity_formats_without_answers_or_points(self):
        from learning_modules.services.pdf_generation import generate_topic_pdf

        activity = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            lesson=self.lesson,
            title='Main Activity Worksheet',
            instructions='Answer these on the website after reviewing.',
            activity_type=ModuleActivity.ActivityType.INTERACTIVE,
            points_possible=99,
            max_attempts=5,
            is_published=True,
        )
        multiple_choice = ModuleActivityQuestion.objects.create(
            activity=activity,
            question_type=ModuleActivityQuestion.QuestionType.MULTIPLE_CHOICE,
            prompt='Which tool compiles Java?',
            explanation='hidden teacher explanation',
            points=10,
        )
        ModuleActivityQuestionChoice.objects.create(
            question=multiple_choice,
            text='JDK',
            is_correct=True,
            order=1,
        )
        ModuleActivityQuestionChoice.objects.create(
            question=multiple_choice,
            text='JVM',
            is_correct=False,
            order=2,
        )
        ModuleActivityQuestion.objects.create(
            activity=activity,
            question_type=ModuleActivityQuestion.QuestionType.FILL_BLANK,
            prompt='Type the reserved word.',
            correct_text_answers=['secret-answer'],
            points=10,
        )
        ordering = ModuleActivityQuestion.objects.create(
            activity=activity,
            question_type=ModuleActivityQuestion.QuestionType.ORDERING,
            prompt='Put the steps in order.',
            points=10,
        )
        ModuleActivityQuestionChoice.objects.create(
            question=ordering,
            text='Compile',
            order=1,
        )
        ModuleActivityQuestionChoice.objects.create(
            question=ordering,
            text='Run',
            order=2,
        )
        matching = ModuleActivityQuestion.objects.create(
            activity=activity,
            question_type=ModuleActivityQuestion.QuestionType.MATCHING,
            prompt='Match the Java terms.',
            points=10,
        )
        ModuleActivityMatchingPair.objects.create(
            question=matching,
            left_text='JDK',
            right_text='Compiler tools',
            order=1,
        )
        ModuleActivityQuestion.objects.create(
            activity=activity,
            question_type=ModuleActivityQuestion.QuestionType.CODE_OUTPUT,
            prompt='Write the output.',
            code_snippet='System.out.println("Hi");',
            expected_output='secret-output',
            points=10,
        )

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                with patch(
                    'learning_modules.services.pdf_generation.render_pdf',
                    return_value=b'%PDF-1.4 generated topic',
                ) as render_pdf:
                    generate_topic_pdf(self.topic)

        html = render_pdf.call_args.args[0]
        self.assertIn('Main Activity Worksheet', html)
        self.assertIn('Which tool compiles Java?', html)
        self.assertIn('JDK', html)
        self.assertIn('JVM', html)
        self.assertIn('Type the reserved word.', html)
        self.assertIn('System.out.println(&quot;Hi&quot;);', html)
        self.assertIn('print-choice-box', html)
        self.assertIn('print-rank-box', html)
        self.assertIn('answer-lines', html)
        self.assertIn('<th>Match</th>', html)
        self.assertNotIn('secret-answer', html)
        self.assertNotIn('secret-output', html)
        self.assertNotIn('hidden teacher explanation', html)
        self.assertNotIn('99 pts', html)
        self.assertNotIn('attempt', html.lower())

    def test_lesson_edit_marks_topic_pdf_outdated(self):
        self.topic.pdf_generated_at = timezone.now()
        self.topic.pdf_is_outdated = False
        self.topic.save(update_fields=['pdf_generated_at', 'pdf_is_outdated'])

        self.lesson.title = 'Updated Printable Lesson'
        self.lesson.save()

        self.topic.refresh_from_db()
        self.assertTrue(self.topic.pdf_is_outdated)

    def test_markdown_image_paths_are_rewritten_for_pdf(self):
        from learning_modules.services.pdf_generation import markdown_html

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                image_path = Path(media_root) / 'lesson.png'
                image_path.write_bytes(b'not a real image for this unit test')

                html = markdown_html('![Diagram](/media/lesson.png)')

                self.assertIn('src="file:///', html)
                self.assertIn('lesson.png', html)

    def test_markdown_lists_and_lesson_asset_images_are_pdf_ready(self):
        from learning_modules.services.pdf_generation import markdown_html, normalize_markdown

        raw_markdown = (
            '![Java toolchain guide](/lesson-assets/cc102/java-toolchain.svg)\n'
            'What this lesson means:\n'
            '* Java is a programming language.\n'
            '* Java uses the JDK and JVM.\n'
            'Use `javac` to compile.'
        )

        normalized = normalize_markdown(raw_markdown)
        html = markdown_html(raw_markdown)

        self.assertIn('java-toolchain.svg)\n\nWhat this lesson means:', normalized)
        self.assertIn('What this lesson means:\n\n* Java is a programming language.', normalized)
        self.assertIn('<img', html)
        self.assertIn('java-toolchain.svg', html)
        self.assertIn('src="file:///', html)
        self.assertIn('<p>What this lesson means:</p>', html)
        self.assertIn('<ul>', html)
        self.assertIn('<li>Java is a programming language.</li>', html)
        self.assertIn('<li>Java uses the JDK and JVM.</li>', html)
        self.assertIn('<code>javac</code>', html)

    def test_lesson_example_uploaded_svg_is_included_in_pdf_context(self):
        from learning_modules.services.pdf_generation import lesson_context

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                example = ModuleLessonExample.objects.create(
                    lesson=self.lesson,
                    order=1,
                    title='SVG Flowchart',
                    alt_text='Flowchart diagram',
                    body='Study the diagram.',
                    is_published=True,
                )
                example.image.save(
                    'flowchart.svg',
                    ContentFile(b'<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
                )

                context = lesson_context(self.lesson)

                examples_section = next(
                    section
                    for section in context['sections']
                    if section['title'] == "Let's Look at Examples"
                )
                example_context = examples_section['examples'][0]
                self.assertEqual(example_context['image']['alt_text'], 'Flowchart diagram')
                self.assertIn('flowchart.svg', example_context['image']['src'])
                self.assertTrue(example_context['image']['src'].startswith('file:///'))
                self.assertNotIn('mini_check', example_context)


class LessonMainActivityApiTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            username='activity-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.teacher = User.objects.create_user(
            username='activity-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.subject = Subject.objects.create(code='ACT101', name='Interactive Activities')
        school_year = SchoolYear.objects.create(start_year=2038, end_year=2039)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        self.schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='MWF',
            start_time='13:00',
            end_time='14:00',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.student)
        self.module = Module.objects.create(
            title='Activity Module',
            slug='activity-module',
            subject=self.subject,
            is_published=True,
        )
        self.topic = ModuleTopic.objects.create(
            module=self.module,
            title='Activity Topic',
            is_published=True,
        )
        self.lesson = ModuleLesson.objects.create(
            topic=self.topic,
            title='Activity Lesson',
            is_published=True,
        )
        self.activity = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            lesson=self.lesson,
            title='Main Activity',
            instructions='Answer each item.',
            points_possible=10,
            max_attempts=2,
            grading_period=ModuleActivity.GradingPeriod.PRELIM,
            is_published=True,
        )
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ENROLLED,
            activated_by=self.teacher,
            module=self.module,
            student=self.student,
        )

    def create_question(self, question_type, order, **kwargs):
        return ModuleActivityQuestion.objects.create(
            activity=self.activity,
            question_type=question_type,
            prompt=f'{question_type} prompt',
            points=Decimal('1.00'),
            order=order,
            **kwargs,
        )

    def attempt_payload(self):
        return {
            'activity': self.activity.id,
            'student': self.student.id,
            'context_type': LearningContextType.CLASS,
            'schedule': self.schedule.id,
        }

    def context_url(self, path):
        separator = '&' if '?' in path else '?'
        return f'{path}{separator}schedule={self.schedule.id}'

    def start_attempt(self):
        return self.client.post(
            self.context_url(
                f'/api/modules/activities/{self.activity.id}/start-attempt/'
            ),
            {},
            format='json',
        )

    def test_teacher_must_use_atomic_save_for_lesson_main_activity_question(self):
        self.client.force_authenticate(self.teacher)

        response = self.client.post(
            '/api/modules/activity-questions/',
            {
                'activity': self.activity.id,
                'question_type': ModuleActivityQuestion.QuestionType.FILL_BLANK,
                'prompt': 'Name the JVM.',
                'points': '2.00',
                'order': 1,
                'correct_text_answers': ['Java Virtual Machine'],
                'is_published': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.activity.questions.exists())

    def test_student_sees_published_activity_but_not_answer_keys(self):
        question = self.create_question(
            ModuleActivityQuestion.QuestionType.FILL_BLANK,
            1,
            correct_text_answers=['JVM'],
            expected_output='JVM',
            explanation='The JVM runs bytecode.',
        )
        self.client.force_authenticate(self.student)

        response = self.client.get(self.context_url('/api/modules/activity-questions/'))

        self.assertEqual(response.status_code, 200)
        row = next(item for item in result_rows(response) if item['id'] == question.id)
        self.assertNotIn('correct_text_answers', row)
        self.assertNotIn('expected_output', row)
        self.assertNotIn('explanation', row)

    def test_student_still_cannot_see_answer_keys_after_non_perfect_attempt_with_retries_left(self):
        question = self.create_question(
            ModuleActivityQuestion.QuestionType.MULTIPLE_CHOICE,
            1,
            explanation='The JDK includes the compiler.',
        )
        correct_choice = ModuleActivityQuestionChoice.objects.create(
            question=question,
            text='JDK',
            is_correct=True,
            order=1,
        )
        wrong_choice = ModuleActivityQuestionChoice.objects.create(
            question=question,
            text='HTML',
            is_correct=False,
            order=2,
        )
        self.client.force_authenticate(self.student)
        attempt_response = self.start_attempt()
        attempt = attempt_response.data['attempt']
        answer_response = self.client.patch(
            self.context_url(
                f'/api/modules/activity-attempts/{attempt["id"]}/draft/'
            ),
            {
                'base_revision': attempt['draft_revision'],
                'answers': {str(question.id): {
                    'selected_choice': wrong_choice.id,
                    'text_answer': '',
                    'choice_order': [],
                    'matching_answer': {},
                }},
            },
            format='json',
        )
        submit_response = self.client.post(
            self.context_url(
                f'/api/modules/activity-attempts/{attempt["id"]}/submit/'
            ),
            {'draft_revision': answer_response.data['draft_revision']},
            format='json',
        )

        question_response = self.client.get(self.context_url('/api/modules/activity-questions/'))
        choice_response = self.client.get(self.context_url('/api/modules/activity-choices/'))
        attempt_detail_response = self.client.get(
            self.context_url(f'/api/modules/activity-attempts/{attempt["id"]}/'),
        )

        question_row = next(item for item in result_rows(question_response) if item['id'] == question.id)
        correct_choice_row = next(
            item for item in result_rows(choice_response) if item['id'] == correct_choice.id
        )
        self.assertNotIn('explanation', question_row)
        self.assertNotIn('is_correct', correct_choice_row)
        self.assertEqual(submit_response.status_code, 200, submit_response.data)
        saved_answer = attempt_detail_response.data['draft_answers'][str(question.id)]
        self.assertNotIn('is_correct', saved_answer)
        self.assertNotIn('points_earned', saved_answer)
        self.assertNotIn('feedback', saved_answer)

    def test_student_can_see_answer_keys_after_attempts_are_exhausted(self):
        question = self.create_question(
            ModuleActivityQuestion.QuestionType.FILL_BLANK,
            1,
            correct_text_answers=['JVM'],
            expected_output='JVM',
            explanation='The JVM runs bytecode.',
        )
        ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
            score=Decimal('0.00'),
            max_score=Decimal('1.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=2,
            score=Decimal('0.00'),
            max_score=Decimal('1.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        response = self.client.get(self.context_url('/api/modules/activity-questions/'))

        row = next(item for item in result_rows(response) if item['id'] == question.id)
        self.assertEqual(row['correct_text_answers'], ['JVM'])
        self.assertEqual(row['expected_output'], 'JVM')
        self.assertEqual(row['explanation'], 'The JVM runs bytecode.')

    def test_student_can_see_answer_keys_after_perfect_score(self):
        question = self.create_question(
            ModuleActivityQuestion.QuestionType.MULTIPLE_CHOICE,
            1,
            explanation='The JDK compiles Java.',
        )
        correct_choice = ModuleActivityQuestionChoice.objects.create(
            question=question,
            text='JDK',
            is_correct=True,
            order=1,
        )
        ModuleActivityQuestionChoice.objects.create(
            question=question,
            text='JVM',
            is_correct=False,
            order=2,
        )
        ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
            score=Decimal('1.00'),
            max_score=Decimal('1.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        question_response = self.client.get(self.context_url('/api/modules/activity-questions/'))
        choice_response = self.client.get(self.context_url('/api/modules/activity-choices/'))

        question_row = next(item for item in result_rows(question_response) if item['id'] == question.id)
        choice_row = next(item for item in result_rows(choice_response) if item['id'] == correct_choice.id)
        self.assertEqual(question_row['explanation'], 'The JDK compiles Java.')
        self.assertTrue(choice_row['is_correct'])

    def test_student_attempt_limit_is_enforced(self):
        self.client.force_authenticate(self.student)

        first = self.start_attempt()
        first_submit = self.client.post(
            self.context_url(
                f'/api/modules/activity-attempts/{first.data["attempt"]["id"]}/submit/'
            ),
            {'draft_revision': first.data['attempt']['draft_revision']},
            format='json',
        )
        second = self.start_attempt()
        second_submit = self.client.post(
            self.context_url(
                f'/api/modules/activity-attempts/{second.data["attempt"]["id"]}/submit/'
            ),
            {'draft_revision': second.data['attempt']['draft_revision']},
            format='json',
        )
        third = self.start_attempt()

        self.assertEqual(first.status_code, 201)
        self.assertEqual(first_submit.status_code, 200)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(second_submit.status_code, 200)
        self.assertEqual(third.status_code, 400)

    def test_auto_grades_all_mvp_question_types(self):
        multiple_choice = self.create_question(
            ModuleActivityQuestion.QuestionType.MULTIPLE_CHOICE,
            1,
        )
        correct_choice = ModuleActivityQuestionChoice.objects.create(
            question=multiple_choice,
            text='JDK',
            is_correct=True,
            order=1,
        )
        ModuleActivityQuestionChoice.objects.create(
            question=multiple_choice,
            text='HTML',
            is_correct=False,
            order=2,
        )
        true_false = self.create_question(
            ModuleActivityQuestion.QuestionType.TRUE_FALSE,
            2,
        )
        tf_choice = ModuleActivityQuestionChoice.objects.create(
            question=true_false,
            text='True',
            is_correct=True,
            order=1,
        )
        fill_blank = self.create_question(
            ModuleActivityQuestion.QuestionType.FILL_BLANK,
            3,
            correct_text_answers=['bytecode'],
        )
        ordering = self.create_question(
            ModuleActivityQuestion.QuestionType.ORDERING,
            4,
        )
        order_one = ModuleActivityQuestionChoice.objects.create(
            question=ordering,
            text='Compile',
            order=1,
        )
        order_two = ModuleActivityQuestionChoice.objects.create(
            question=ordering,
            text='Run',
            order=2,
        )
        matching = self.create_question(
            ModuleActivityQuestion.QuestionType.MATCHING,
            5,
        )
        pair = ModuleActivityMatchingPair.objects.create(
            question=matching,
            left_text='JVM',
            right_text='Runs bytecode',
            order=1,
        )
        code_output = self.create_question(
            ModuleActivityQuestion.QuestionType.CODE_OUTPUT,
            6,
            expected_output='Hello',
        )
        self.client.force_authenticate(self.student)
        attempt_response = self.start_attempt()
        attempt_id = attempt_response.data['attempt']['id']

        answers = {
            str(multiple_choice.id): {
                'selected_choice': correct_choice.id,
                'text_answer': '',
                'choice_order': [],
                'matching_answer': {},
            },
            str(true_false.id): {
                'selected_choice': tf_choice.id,
                'text_answer': '',
                'choice_order': [],
                'matching_answer': {},
            },
            str(fill_blank.id): {
                'selected_choice': None,
                'text_answer': ' bytecode ',
                'choice_order': [],
                'matching_answer': {},
            },
            str(ordering.id): {
                'selected_choice': None,
                'text_answer': '',
                'choice_order': [order_one.id, order_two.id],
                'matching_answer': {},
            },
            str(matching.id): {
                'selected_choice': None,
                'text_answer': '',
                'choice_order': [],
                'matching_answer': {str(pair.id): 'Runs bytecode'},
            },
            str(code_output.id): {
                'selected_choice': None,
                'text_answer': 'Hello',
                'choice_order': [],
                'matching_answer': {},
            },
        }
        draft_response = self.client.patch(
            self.context_url(f'/api/modules/activity-attempts/{attempt_id}/draft/'),
            {'base_revision': 0, 'answers': answers},
            format='json',
        )
        self.assertEqual(draft_response.status_code, 200, draft_response.data)

        submit_response = self.client.post(
            self.context_url(f'/api/modules/activity-attempts/{attempt_id}/submit/'),
            {'draft_revision': draft_response.data['draft_revision']},
            format='json',
        )

        self.assertEqual(submit_response.status_code, 200)
        self.assertEqual(
            Decimal(submit_response.data['attempt']['score']),
            Decimal('6.00'),
        )
        self.assertEqual(
            sum(
                answer.get('is_correct') is True
                for answer in submit_response.data['attempt']['draft_answers'].values()
            ),
            6,
        )

    def test_student_cannot_edit_submitted_attempt_answer(self):
        question = self.create_question(
            ModuleActivityQuestion.QuestionType.FILL_BLANK,
            1,
            correct_text_answers=['JVM'],
        )
        attempt = ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            attempt_number=1,
            status=ModuleActivityAttempt.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        answer = ModuleActivityAnswer.objects.create(
            attempt=attempt,
            question=question,
            text_answer='JVM',
        )
        self.client.force_authenticate(self.student)

        response = self.client.patch(
            f'/api/modules/activity-answers/{answer.id}/',
            {'text_answer': 'Changed'},
            format='json',
        )

        self.assertEqual(response.status_code, 403)

    def test_student_generic_answer_writes_are_disabled_for_open_attempts(self):
        question = self.create_question(
            ModuleActivityQuestion.QuestionType.FILL_BLANK,
            1,
            correct_text_answers=['JVM'],
        )
        self.client.force_authenticate(self.student)
        started = self.start_attempt()
        attempt_id = started.data['attempt']['id']

        created = self.client.post(
            '/api/modules/activity-answers/',
            {
                'attempt': attempt_id,
                'question': question.id,
                'text_answer': 'JVM',
            },
            format='json',
        )
        answer = ModuleActivityAnswer.objects.create(
            attempt_id=attempt_id,
            question=question,
            text_answer='original',
        )
        updated = self.client.patch(
            f'/api/modules/activity-answers/{answer.id}/',
            {'text_answer': 'changed'},
            format='json',
        )
        deleted = self.client.delete(f'/api/modules/activity-answers/{answer.id}/')

        self.assertEqual(created.status_code, 403)
        self.assertEqual(updated.status_code, 403)
        self.assertEqual(deleted.status_code, 403)
        answer.refresh_from_db()
        self.assertEqual(answer.text_answer, 'original')

    def test_lesson_main_activity_generic_write_routes_require_atomic_save(self):
        question = self.create_question(
            ModuleActivityQuestion.QuestionType.MATCHING,
            1,
        )
        choice = ModuleActivityQuestionChoice.objects.create(
            question=question,
            text='Choice',
            order=1,
        )
        pair = ModuleActivityMatchingPair.objects.create(
            question=question,
            left_text='Left',
            right_text='Right',
            order=1,
        )
        original_revision = self.activity.revision
        self.client.force_authenticate(self.teacher)

        responses = [
            self.client.patch(
                f'/api/modules/activities/{self.activity.id}/',
                {'title': 'Bypass'},
                format='json',
            ),
            self.client.patch(
                f'/api/modules/activity-questions/{question.id}/',
                {'prompt': 'Bypass'},
                format='json',
            ),
            self.client.post(
                '/api/modules/activity-choices/',
                {'question': question.id, 'text': 'Bypass', 'order': 2},
                format='json',
            ),
            self.client.patch(
                f'/api/modules/activity-choices/{choice.id}/',
                {'text': 'Bypass'},
                format='json',
            ),
            self.client.post(
                '/api/modules/activity-matching-pairs/',
                {
                    'question': question.id,
                    'left_text': 'Bypass',
                    'right_text': 'Bypass',
                    'order': 2,
                },
                format='json',
            ),
            self.client.patch(
                f'/api/modules/activity-matching-pairs/{pair.id}/',
                {'right_text': 'Bypass'},
                format='json',
            ),
        ]

        self.assertTrue(all(item.status_code == 400 for item in responses), responses)
        self.activity.refresh_from_db()
        question.refresh_from_db()
        choice.refresh_from_db()
        pair.refresh_from_db()
        self.assertEqual(self.activity.title, 'Main Activity')
        self.assertEqual(self.activity.revision, original_revision)
        self.assertNotEqual(question.prompt, 'Bypass')
        self.assertNotEqual(choice.text, 'Bypass')
        self.assertNotEqual(pair.right_text, 'Bypass')

    def test_non_lesson_activity_keeps_legacy_generic_authoring(self):
        legacy = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            title='Legacy activity',
            instructions='Legacy workflow.',
            activity_type=ModuleActivity.ActivityType.INTERACTIVE,
        )
        self.client.force_authenticate(self.teacher)

        updated = self.client.patch(
            f'/api/modules/activities/{legacy.id}/',
            {'title': 'Legacy activity updated'},
            format='json',
        )
        question = self.client.post(
            '/api/modules/activity-questions/',
            {
                'activity': legacy.id,
                'question_type': ModuleActivityQuestion.QuestionType.FILL_BLANK,
                'prompt': 'Legacy question',
                'points': '1.00',
                'correct_text_answers': ['yes'],
            },
            format='json',
        )

        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(question.status_code, 201, question.data)
        legacy.refresh_from_db()
        self.assertEqual(legacy.title, 'Legacy activity updated')

    def test_atomic_editor_save_updates_activity_and_questions_together(self):
        self.client.force_authenticate(self.teacher)
        response = self.client.put(
            '/api/modules/activities/atomic-save/',
            {
                'id': self.activity.id,
                'expected_revision': self.activity.revision,
                'module': self.module.id,
                'topic': self.topic.id,
                'lesson': self.lesson.id,
                'title': 'Reliable Main Activity',
                'instructions': 'Complete every question.',
                'activity_type': 'INTERACTIVE',
                'order': 1,
                'max_attempts': 3,
                'passing_score': '1.00',
                'is_published': True,
                'questions': [{
                    'question_type': 'fill_blank',
                    'prompt': 'Name the runtime.',
                    'points': '2.00',
                    'order': 1,
                    'correct_text_answers': ['JVM'],
                    'is_published': True,
                    'choices': [],
                    'matching_pairs': [],
                }],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200)
        self.activity.refresh_from_db()
        self.assertEqual(self.activity.title, 'Reliable Main Activity')
        self.assertEqual(self.activity.points_possible, Decimal('2.00'))
        self.assertEqual(self.activity.questions.count(), 1)
        self.assertEqual(response.data['activity']['id'], self.activity.id)
        self.assertEqual(response.data['activity']['grading_period'], GradingPeriod.PRELIM)
        self.assertEqual(len(response.data['questions']), 1)
        self.assertEqual(response.data['questions'][0]['prompt'], 'Name the runtime.')
        self.assertEqual(response.data['choices'], [])
        self.assertEqual(response.data['matching_pairs'], [])

    def test_atomic_editor_create_requires_grading_period(self):
        lesson = ModuleLesson.objects.create(
            topic=self.topic,
            title='Activity without period',
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.put(
            '/api/modules/activities/atomic-save/',
            {
                'module': self.module.id,
                'topic': self.topic.id,
                'lesson': lesson.id,
                'title': 'Missing period',
                'instructions': 'Complete every question.',
                'activity_type': 'INTERACTIVE',
                'questions': [],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.assertIn('grading_period', response.data)
        self.assertFalse(ModuleActivity.objects.filter(lesson=lesson).exists())

    def test_atomic_period_change_reassigns_link_and_preserves_score(self):
        school_year = SchoolYear.objects.create(start_year=2041, end_year=2042)
        term = SchoolYearSemester.objects.create(school_year=school_year, semester=Semester.FIRST)
        schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='MWF',
            start_time='08:00',
            end_time='09:00',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=schedule, student=self.student)
        prelim = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Prelim quizzes',
            weight=Decimal('100.00'),
        )
        midterm = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.MIDTERM,
            category=GradeCategoryChoices.QUIZ,
            name='Midterm quizzes',
            weight=Decimal('100.00'),
        )
        item = GradeItem.objects.create(
            schedule=schedule,
            grade_category=prelim,
            title=self.activity.title,
            points_possible=Decimal('10.00'),
            source_type=GradeItemSourceType.MODULE_ACTIVITY,
            module_activity=self.activity,
        )
        score = StudentGradeItemScore.objects.create(
            grade_item=item,
            student=self.student,
            raw_score=Decimal('8.00'),
        )
        question = self.create_question(
            ModuleActivityQuestion.QuestionType.FILL_BLANK,
            1,
            correct_text_answers=['JVM'],
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.put(
            '/api/modules/activities/atomic-save/',
            {
                'id': self.activity.id,
                'expected_revision': self.activity.revision,
                'grading_period': GradingPeriod.MIDTERM,
                'period_reassignments': [{
                    'schedule': schedule.id,
                    'grade_category': midterm.id,
                }],
                'is_published': True,
                'questions': [{
                    'id': question.id,
                    'question_type': 'fill_blank',
                    'prompt': question.prompt,
                    'points': '1.00',
                    'order': 1,
                    'correct_text_answers': ['JVM'],
                    'is_published': True,
                    'choices': [],
                    'matching_pairs': [],
                }],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.activity.refresh_from_db()
        item.refresh_from_db()
        score.refresh_from_db()
        self.assertEqual(self.activity.grading_period, GradingPeriod.MIDTERM)
        self.assertEqual(item.grade_category, midterm)
        self.assertEqual(score.raw_score, Decimal('8.00'))

    def test_atomic_period_change_rolls_back_invalid_replacement(self):
        school_year = SchoolYear.objects.create(start_year=2041, end_year=2042)
        term = SchoolYearSemester.objects.create(school_year=school_year, semester=Semester.FIRST)
        schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='TTH',
            start_time='09:00',
            end_time='10:00',
            section='B',
        )
        prelim = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Prelim quizzes',
            weight=Decimal('100.00'),
        )
        item = GradeItem.objects.create(
            schedule=schedule,
            grade_category=prelim,
            title=self.activity.title,
            points_possible=Decimal('10.00'),
            source_type=GradeItemSourceType.MODULE_ACTIVITY,
            module_activity=self.activity,
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.put(
            '/api/modules/activities/atomic-save/',
            {
                'id': self.activity.id,
                'expected_revision': self.activity.revision,
                'title': 'Must roll back',
                'grading_period': GradingPeriod.MIDTERM,
                'period_reassignments': [{
                    'schedule': schedule.id,
                    'grade_category': prelim.id,
                }],
                'questions': [],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.activity.refresh_from_db()
        item.refresh_from_db()
        self.assertEqual(self.activity.title, 'Main Activity')
        self.assertEqual(self.activity.grading_period, GradingPeriod.PRELIM)
        self.assertEqual(item.grade_category, prelim)

    def test_atomic_editor_save_rolls_back_when_publishing_invalid_question(self):
        self.client.force_authenticate(self.teacher)
        response = self.client.put(
            '/api/modules/activities/atomic-save/',
            {
                'id': self.activity.id,
                'expected_revision': self.activity.revision,
                'title': 'Should not persist',
                'is_published': True,
                'questions': [{
                    'question_type': 'multiple_choice',
                    'prompt': 'Broken item',
                    'points': '1.00',
                    'is_published': True,
                    'choices': [{'text': 'Only choice', 'is_correct': True}],
                }],
            },
            format='json',
        )

        self.assertEqual(response.status_code, 400)
        self.activity.refresh_from_db()
        self.assertEqual(self.activity.title, 'Main Activity')
        self.assertEqual(self.activity.questions.count(), 0)

    def test_student_cannot_use_atomic_editor_save(self):
        self.client.force_authenticate(self.student)
        response = self.client.put(
            '/api/modules/activities/atomic-save/',
            {'id': self.activity.id, 'title': 'Unauthorized', 'questions': []},
            format='json',
        )
        self.assertEqual(response.status_code, 403)

    def test_student_extension_management_endpoint_is_retired(self):
        self.client.force_authenticate(self.teacher)

        response = self.client.put(
            f'/api/modules/activities/{self.activity.id}/extensions/',
            {
                'student': self.student.id,
                'due_at': (timezone.now() + timezone.timedelta(hours=2)).isoformat(),
            },
            format='json',
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(ModuleActivityExtension.objects.filter(activity=self.activity).exists())

    def test_attempt_draft_is_saved_once_and_graded_from_frozen_snapshot(self):
        question = self.create_question(ModuleActivityQuestion.QuestionType.MULTIPLE_CHOICE, 1)
        original = ModuleActivityQuestionChoice.objects.create(
            question=question, text='JVM', is_correct=True, order=1,
        )
        replacement = ModuleActivityQuestionChoice.objects.create(
            question=question, text='Browser', is_correct=False, order=2,
        )
        self.client.force_authenticate(self.student)
        created = self.start_attempt()
        attempt_id = created.data['attempt']['id']

        original.is_correct = False
        original.save(update_fields=['is_correct'])
        replacement.is_correct = True
        replacement.save(update_fields=['is_correct'])
        draft = self.client.put(
            self.context_url(f'/api/modules/activity-attempts/{attempt_id}/draft/'),
            {
                'base_revision': created.data['attempt']['draft_revision'],
                'answers': {str(question.id): {
                    'selected_choice': original.id,
                    'text_answer': '',
                    'choice_order': [],
                    'matching_answer': {},
                }},
            },
            format='json',
        )
        submitted = self.client.post(
            self.context_url(f'/api/modules/activity-attempts/{attempt_id}/submit/'),
            {'draft_revision': draft.data['draft_revision']},
            format='json',
        )

        self.assertEqual(draft.status_code, 200)
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(Decimal(submitted.data['attempt']['score']), Decimal('1.00'))

    def test_lesson_activity_ignores_hidden_global_window(self):
        self.activity.due_at = timezone.now() - timezone.timedelta(hours=1)
        self.activity.save(update_fields=['due_at'])
        self.client.force_authenticate(self.student)
        started = self.start_attempt()
        repeated = self.start_attempt()

        self.activity.refresh_from_db()
        self.assertIsNone(self.activity.due_at)
        self.assertEqual(started.status_code, 201, started.data)
        self.assertEqual(repeated.status_code, 200)
        self.assertFalse(repeated.data['created'])
        self.assertEqual(
            repeated.data['attempt']['id'],
            started.data['attempt']['id'],
        )

    def test_passing_score_unlocks_review_without_exhausting_attempts(self):
        self.activity.passing_score = Decimal('0.50')
        self.activity.save(update_fields=['passing_score'])
        question = self.create_question(
            ModuleActivityQuestion.QuestionType.FILL_BLANK,
            1,
            correct_text_answers=['JVM'],
            explanation='Runtime explanation.',
        )
        ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
            score=Decimal('1.00'),
            max_score=Decimal('1.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
            submitted_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)
        response = self.client.get(self.context_url('/api/modules/activity-questions/'))
        row = next(item for item in result_rows(response) if item['id'] == question.id)
        self.assertEqual(row['explanation'], 'Runtime explanation.')

    def test_attempt_summary_endpoints_omit_frozen_answers_and_full_retrieve_keeps_them(self):
        attempt = ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
            question_snapshot=[{'id': 99, 'correct_text_answers': ['secret']}],
            draft_answers={'99': {'text_answer': 'private draft', 'feedback': 'private'}},
        )
        self.client.force_authenticate(self.student)

        workspace = self.client.get(
            self.context_url(f'/api/modules/modules/{self.module.id}/workspace/')
        )
        summary_list = self.client.get(
            self.context_url('/api/modules/activity-attempts/?view=summary')
        )
        unscoped_summary_list = self.client.get(
            '/api/modules/activity-attempts/?view=summary'
        )
        default_list = self.client.get(
            self.context_url('/api/modules/activity-attempts/')
        )
        detail = self.client.get(
            self.context_url(f'/api/modules/activity-attempts/{attempt.id}/')
        )

        self.assertEqual(workspace.status_code, 200)
        self.assertEqual(result_rows(unscoped_summary_list), [])
        workspace_row = workspace.data['activity_attempts'][0]
        summary_row = result_rows(summary_list)[0]
        for row in (workspace_row, summary_row):
            self.assertNotIn('question_snapshot', row)
            self.assertNotIn('draft_answers', row)
        self.assertNotIn('question_snapshot', result_rows(default_list)[0])
        self.assertNotIn('draft_answers', result_rows(default_list)[0])
        self.assertIn('question_snapshot', detail.data)
        self.assertIn('draft_answers', detail.data)

    def test_teacher_editor_workspace_is_lesson_scoped_and_student_is_forbidden(self):
        question = self.create_question(ModuleActivityQuestion.QuestionType.MULTIPLE_CHOICE, 1)
        choice = ModuleActivityQuestionChoice.objects.create(
            question=question,
            text='JVM',
            is_correct=True,
            order=1,
        )
        other_lesson = ModuleLesson.objects.create(
            topic=self.topic,
            title='Other lesson',
            is_published=True,
        )
        other_activity = ModuleActivity.objects.create(
            module=self.module,
            topic=self.topic,
            lesson=other_lesson,
            title='Other activity',
        )
        self.create_question(ModuleActivityQuestion.QuestionType.FILL_BLANK, 2)
        ModuleActivityQuestion.objects.create(
            activity=other_activity,
            question_type=ModuleActivityQuestion.QuestionType.FILL_BLANK,
            prompt='Outside the requested lesson',
            points=Decimal('1.00'),
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.get(
            f'/api/modules/lessons/{self.lesson.id}/main-activity-workspace/',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['activity']['id'], self.activity.id)
        self.assertEqual(
            {row['activity'] for row in response.data['questions']},
            {self.activity.id},
        )
        self.assertIn(choice.id, {row['id'] for row in response.data['choices']})
        self.assertNotIn(
            'Outside the requested lesson',
            {row['prompt'] for row in response.data['questions']},
        )

        self.client.force_authenticate(self.student)
        forbidden = self.client.get(
            f'/api/modules/lessons/{self.lesson.id}/main-activity-workspace/',
        )
        self.assertEqual(forbidden.status_code, 403)

    def test_grading_workspace_is_activity_scoped(self):
        school_year = SchoolYear.objects.create(start_year=2026, end_year=2027)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        schedule = self.schedule
        enrollment = ScheduleStudent.objects.get(schedule=schedule, student=self.student)
        category = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Activity quizzes',
            weight=Decimal('100.00'),
        )
        item = GradeItem.objects.create(
            schedule=schedule,
            grade_category=category,
            title=self.activity.title,
            points_possible=self.activity.points_possible,
            source_type=GradeItemSourceType.MODULE_ACTIVITY,
            module_activity=self.activity,
        )
        outside_subject = Subject.objects.create(code='OUT101', name='Outside')
        outside_schedule = SubjectSchedule.objects.create(
            subject=outside_subject,
            school_year_semester=term,
            days='T',
            start_time='09:00',
            end_time='10:00',
            section='B',
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.get(
            f'/api/modules/activities/{self.activity.id}/grading-workspace/',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual({row['id'] for row in response.data['schedules']}, {schedule.id})
        self.assertEqual({row['id'] for row in response.data['enrollments']}, {enrollment.id})
        self.assertEqual({row['id'] for row in response.data['grade_categories']}, {category.id})
        self.assertEqual({row['id'] for row in response.data['grade_items']}, {item.id})
        self.assertNotIn('extensions', response.data)
        self.assertNotIn(outside_schedule.id, {row['id'] for row in response.data['schedules']})

    def test_start_is_idempotent_and_generic_student_create_is_disabled(self):
        self.client.force_authenticate(self.student)

        first = self.start_attempt()
        repeated = self.start_attempt()
        generic = self.client.post(
            '/api/modules/activity-attempts/',
            self.attempt_payload(),
            format='json',
        )
        generic_update = self.client.patch(
            self.context_url(
                f'/api/modules/activity-attempts/{first.data["attempt"]["id"]}/'
            ),
            {'attempt_number': 99},
            format='json',
        )
        generic_delete = self.client.delete(
            self.context_url(
                f'/api/modules/activity-attempts/{first.data["attempt"]["id"]}/'
            ),
        )

        self.assertEqual(first.status_code, 201, first.data)
        self.assertTrue(first.data['created'])
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.assertFalse(repeated.data['created'])
        self.assertEqual(first.data['attempt']['id'], repeated.data['attempt']['id'])
        self.assertEqual(generic.status_code, 403)
        self.assertEqual(generic_update.status_code, 403)
        self.assertEqual(generic_delete.status_code, 403)
        self.assertEqual(
            ModuleActivityAttempt.objects.filter(
                activity=self.activity,
                student=self.student,
                status=ModuleActivityAttempt.Status.IN_PROGRESS,
            ).count(),
            1,
        )

    def test_draft_revision_blocks_stale_tabs_and_delayed_saves(self):
        question = self.create_question(
            ModuleActivityQuestion.QuestionType.FILL_BLANK,
            1,
            correct_text_answers=['JVM'],
        )
        self.client.force_authenticate(self.student)
        started = self.start_attempt()
        attempt_id = started.data['attempt']['id']
        path = self.context_url(f'/api/modules/activity-attempts/{attempt_id}/draft/')
        answer = {
            str(question.id): {
                'selected_choice': None,
                'text_answer': 'JVM',
                'choice_order': [],
                'matching_answer': {},
            },
        }

        with patch('grades.signals.sync_activity_attempt_target') as grade_sync:
            saved = self.client.patch(
                path,
                {'base_revision': 0, 'answers': answer},
                format='json',
            )
        stale = self.client.patch(
            path,
            {'base_revision': 0, 'answers': answer},
            format='json',
        )
        submitted = self.client.post(
            self.context_url(f'/api/modules/activity-attempts/{attempt_id}/submit/'),
            {'draft_revision': saved.data['draft_revision']},
            format='json',
        )
        repeated = self.client.post(
            self.context_url(f'/api/modules/activity-attempts/{attempt_id}/submit/'),
            {'draft_revision': saved.data['draft_revision']},
            format='json',
        )
        delayed = self.client.patch(
            path,
            {'base_revision': saved.data['draft_revision'], 'answers': answer},
            format='json',
        )

        self.assertEqual(saved.status_code, 200, saved.data)
        self.assertEqual(saved.data['draft_revision'], 1)
        grade_sync.assert_not_called()
        self.assertEqual(stale.status_code, 409, stale.data)
        self.assertEqual(submitted.status_code, 200, submitted.data)
        self.assertEqual(repeated.status_code, 200, repeated.data)
        self.assertEqual(delayed.status_code, 400, delayed.data)
        self.assertEqual(submitted.data['attempt']['draft_answers'][str(question.id)]['text_answer'], 'JVM')

    def test_workspace_attempt_detail_and_draft_queries_do_not_grow_per_question(self):
        self.create_question(
            ModuleActivityQuestion.QuestionType.FILL_BLANK,
            1,
            correct_text_answers=['one'],
        )
        self.client.force_authenticate(self.student)
        first = self.start_attempt()
        first_id = first.data['attempt']['id']

        with CaptureQueriesContext(connection) as small_workspace_queries:
            small_workspace = self.client.get(
                self.context_url(f'/api/modules/modules/{self.module.id}/workspace/')
            )
        with CaptureQueriesContext(connection) as small_detail_queries:
            small_detail = self.client.get(
                self.context_url(f'/api/modules/activity-attempts/{first_id}/')
            )
        with CaptureQueriesContext(connection) as small_draft_queries:
            small_draft = self.client.patch(
                self.context_url(f'/api/modules/activity-attempts/{first_id}/draft/'),
                {'base_revision': 0, 'answers': {}},
                format='json',
            )
        self.client.post(
            self.context_url(f'/api/modules/activity-attempts/{first_id}/submit/'),
            {'draft_revision': small_draft.data['draft_revision']},
            format='json',
        )

        for index in range(2, 32):
            self.create_question(
                ModuleActivityQuestion.QuestionType.FILL_BLANK,
                index,
                correct_text_answers=[str(index)],
            )
        second = self.start_attempt()
        second_id = second.data['attempt']['id']

        with CaptureQueriesContext(connection) as large_workspace_queries:
            large_workspace = self.client.get(
                self.context_url(f'/api/modules/modules/{self.module.id}/workspace/')
            )
        with CaptureQueriesContext(connection) as large_detail_queries:
            large_detail = self.client.get(
                self.context_url(f'/api/modules/activity-attempts/{second_id}/')
            )
        with CaptureQueriesContext(connection) as large_draft_queries:
            large_draft = self.client.patch(
                self.context_url(f'/api/modules/activity-attempts/{second_id}/draft/'),
                {'base_revision': 0, 'answers': {}},
                format='json',
            )

        for api_response in (
            small_workspace,
            small_detail,
            small_draft,
            large_workspace,
            large_detail,
            large_draft,
        ):
            self.assertEqual(api_response.status_code, 200, api_response.data)
        self.assertLessEqual(
            len(large_workspace_queries),
            len(small_workspace_queries) + 2,
        )
        self.assertLessEqual(len(large_detail_queries), len(small_detail_queries) + 1)
        self.assertLessEqual(len(large_draft_queries), len(small_draft_queries) + 1)

    def test_ordering_snapshot_hides_canonical_order_and_is_stable(self):
        question = self.create_question(ModuleActivityQuestion.QuestionType.ORDERING, 1)
        choices = [
            ModuleActivityQuestionChoice.objects.create(
                question=question,
                text=f'Step {index}',
                order=index,
            )
            for index in range(1, 7)
        ]
        self.client.force_authenticate(self.student)
        started = self.start_attempt()
        attempt_id = started.data['attempt']['id']
        path = self.context_url(f'/api/modules/activity-attempts/{attempt_id}/')

        first = self.client.get(path)
        refreshed = self.client.get(path)
        snapshot = first.data['question_snapshot'][0]
        first_ids = [choice['id'] for choice in snapshot['choices']]

        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data['question_snapshot'], refreshed.data['question_snapshot'])
        self.assertTrue(all('order' not in choice for choice in snapshot['choices']))
        self.assertTrue(all('is_correct' not in choice for choice in snapshot['choices']))
        self.assertCountEqual(first_ids, [choice.id for choice in choices])

        invalid = self.client.patch(
            self.context_url(f'/api/modules/activity-attempts/{attempt_id}/draft/'),
            {
                'base_revision': 0,
                'answers': {str(question.id): {
                    'selected_choice': None,
                    'text_answer': '',
                    'choice_order': first_ids[:-1],
                    'matching_answer': {},
                }},
            },
            format='json',
        )
        self.assertEqual(invalid.status_code, 400, invalid.data)

    def test_randomized_presentation_differs_between_attempts_and_true_false_is_stable(self):
        multiple_choice = self.create_question(
            ModuleActivityQuestion.QuestionType.MULTIPLE_CHOICE,
            1,
        )
        ordering = self.create_question(
            ModuleActivityQuestion.QuestionType.ORDERING,
            2,
        )
        matching = self.create_question(
            ModuleActivityQuestion.QuestionType.MATCHING,
            3,
        )
        true_false = self.create_question(
            ModuleActivityQuestion.QuestionType.TRUE_FALSE,
            4,
        )
        for index in range(8):
            ModuleActivityQuestionChoice.objects.create(
                question=multiple_choice,
                text=f'MCQ {index}',
                is_correct=index == 0,
                order=index,
            )
            ModuleActivityQuestionChoice.objects.create(
                question=ordering,
                text=f'Order {index}',
                order=index,
            )
            ModuleActivityMatchingPair.objects.create(
                question=matching,
                left_text=f'Left {index}',
                right_text=f'Right {index}',
                order=index,
            )
        true_false_choices = [
            ModuleActivityQuestionChoice.objects.create(
                question=true_false,
                text=text,
                is_correct=text == 'True',
                order=index,
            )
            for index, text in enumerate(('True', 'False'))
        ]
        self.client.force_authenticate(self.student)

        first = self.start_attempt()
        first_snapshot = {
            question['id']: question
            for question in first.data['attempt']['question_snapshot']
        }
        self.client.post(
            self.context_url(
                f'/api/modules/activity-attempts/{first.data["attempt"]["id"]}/submit/'
            ),
            {'draft_revision': first.data['attempt']['draft_revision']},
            format='json',
        )
        second = self.start_attempt()
        second_snapshot = {
            question['id']: question
            for question in second.data['attempt']['question_snapshot']
        }

        choice_ids = lambda snapshot, question_id: [
            choice['id'] for choice in snapshot[question_id]['choices']
        ]
        self.assertNotEqual(
            choice_ids(first_snapshot, multiple_choice.id),
            choice_ids(second_snapshot, multiple_choice.id),
        )
        self.assertNotEqual(
            choice_ids(first_snapshot, ordering.id),
            choice_ids(second_snapshot, ordering.id),
        )
        self.assertNotEqual(
            first_snapshot[matching.id]['matching_options'],
            second_snapshot[matching.id]['matching_options'],
        )
        expected_true_false = [choice.id for choice in true_false_choices]
        self.assertEqual(
            choice_ids(first_snapshot, true_false.id),
            expected_true_false,
        )
        self.assertEqual(
            choice_ids(second_snapshot, true_false.id),
            expected_true_false,
        )

    def test_stale_teacher_revision_returns_conflict_without_overwrite(self):
        self.client.force_authenticate(self.teacher)
        first = self.client.put(
            '/api/modules/activities/atomic-save/',
            {
                'id': self.activity.id,
                'expected_revision': self.activity.revision,
                'title': 'First editor wins',
                'is_published': False,
                'questions': [],
            },
            format='json',
        )
        stale = self.client.put(
            '/api/modules/activities/atomic-save/',
            {
                'id': self.activity.id,
                'expected_revision': self.activity.revision,
                'title': 'Stale editor overwrite',
                'is_published': False,
                'questions': [],
            },
            format='json',
        )

        self.assertEqual(first.status_code, 200, first.data)
        self.assertEqual(first.data['activity']['revision'], self.activity.revision + 1)
        self.assertEqual(stale.status_code, 409, stale.data)
        self.activity.refresh_from_db()
        self.assertEqual(self.activity.title, 'First editor wins')

    def test_best_attempt_uses_percentage_across_revisions(self):
        from learning_modules.services.activity_state import evaluate_main_activity_state

        lower_points_better_percentage = ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=1,
            score=Decimal('8.00'),
            max_score=Decimal('10.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
        )
        ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            context_type=LearningContextType.CLASS,
            schedule=self.schedule,
            attempt_number=2,
            score=Decimal('9.00'),
            max_score=Decimal('20.00'),
            status=ModuleActivityAttempt.Status.SUBMITTED,
        )

        state = evaluate_main_activity_state(
            self.activity,
            self.activity.attempts.all(),
        )

        self.assertEqual(state['best_attempt_id'], lower_points_better_percentage.id)
        self.assertEqual(state['best_percentage'], '80.0')


@skipUnless(
    connection.vendor == 'postgresql',
    'Row-lock concurrency tests require PostgreSQL.',
)
class MainActivityPostgresConcurrencyTests(TransactionTestCase):
    reset_sequences = True

    def setUp(self):
        self.teacher = User.objects.create_user(
            username='concurrent-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.student = User.objects.create_user(
            username='concurrent-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        subject = Subject.objects.create(code='LOCK101', name='Locking activity')
        year = SchoolYear.objects.create(start_year=2050, end_year=2051)
        term = SchoolYearSemester.objects.create(
            school_year=year,
            semester=Semester.FIRST,
        )
        self.schedule = SubjectSchedule.objects.create(
            subject=subject,
            school_year_semester=term,
            days='MWF',
            start_time='08:00',
            end_time='09:00',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.student)
        self.module = Module.objects.create(
            title='Locking module',
            slug='locking-module',
            subject=subject,
            is_published=True,
        )
        topic = ModuleTopic.objects.create(
            module=self.module,
            title='Locking topic',
            is_published=True,
        )
        self.lesson = ModuleLesson.objects.create(
            topic=topic,
            title='Locking lesson',
            is_published=True,
        )
        self.activity = ModuleActivity.objects.create(
            module=self.module,
            topic=topic,
            lesson=self.lesson,
            title='Locking Main Activity',
            instructions='Exercise transactional paths.',
            points_possible=Decimal('1.00'),
            max_attempts=3,
            grading_period=ModuleActivity.GradingPeriod.PRELIM,
            is_published=True,
        )
        self.question = ModuleActivityQuestion.objects.create(
            activity=self.activity,
            question_type=ModuleActivityQuestion.QuestionType.FILL_BLANK,
            prompt='Type lock.',
            points=Decimal('1.00'),
            correct_text_answers=['lock'],
        )
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ENROLLED,
            activated_by=self.teacher,
            module=self.module,
            student=self.student,
        )

    def parallel_requests(self, call):
        def run(index):
            close_old_connections()
            client = APIClient()
            client.force_authenticate(self.student)
            try:
                return call(client, index)
            finally:
                # Worker threads own separate database connections. They must be
                # closed explicitly: close_old_connections() keeps healthy
                # persistent connections alive and can make PostgreSQL refuse to
                # drop the test database during suite teardown.
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as executor:
            return list(executor.map(run, range(2)))

    def start_path(self):
        return (
            f'/api/modules/activities/{self.activity.id}/start-attempt/'
            f'?schedule={self.schedule.id}'
        )

    def test_duplicate_start_requests_return_one_attempt(self):
        responses = self.parallel_requests(
            lambda client, _index: client.post(self.start_path(), {}, format='json')
        )

        self.assertEqual(sorted(item.status_code for item in responses), [200, 201])
        self.assertEqual(
            {item.data['attempt']['id'] for item in responses},
            {ModuleActivityAttempt.objects.get().id},
        )
        self.assertEqual(ModuleActivityAttempt.objects.count(), 1)

    def test_simultaneous_drafts_accept_only_one_revision(self):
        client = APIClient()
        client.force_authenticate(self.student)
        started = client.post(self.start_path(), {}, format='json')
        attempt_id = started.data['attempt']['id']
        path = (
            f'/api/modules/activity-attempts/{attempt_id}/draft/'
            f'?schedule={self.schedule.id}'
        )
        responses = self.parallel_requests(
            lambda thread_client, index: thread_client.patch(
                path,
                {
                    'base_revision': 0,
                    'answers': {str(self.question.id): {
                        'selected_choice': None,
                        'text_answer': f'answer-{index}',
                        'choice_order': [],
                        'matching_answer': {},
                    }},
                },
                format='json',
            )
        )

        self.assertEqual(sorted(item.status_code for item in responses), [200, 409])
        attempt = ModuleActivityAttempt.objects.get(pk=attempt_id)
        self.assertEqual(attempt.draft_revision, 1)
        self.assertIn(
            attempt.draft_answers[str(self.question.id)]['text_answer'],
            {'answer-0', 'answer-1'},
        )

    def test_draft_submit_race_never_overwrites_submitted_data(self):
        client = APIClient()
        client.force_authenticate(self.student)
        started = client.post(self.start_path(), {}, format='json')
        attempt_id = started.data['attempt']['id']
        draft_path = (
            f'/api/modules/activity-attempts/{attempt_id}/draft/'
            f'?schedule={self.schedule.id}'
        )
        submit_path = (
            f'/api/modules/activity-attempts/{attempt_id}/submit/'
            f'?schedule={self.schedule.id}'
        )

        def race(thread_client, index):
            if index == 0:
                return thread_client.patch(
                    draft_path,
                    {
                        'base_revision': 0,
                        'answers': {str(self.question.id): {
                            'selected_choice': None,
                            'text_answer': 'late draft',
                            'choice_order': [],
                            'matching_answer': {},
                        }},
                    },
                    format='json',
                )
            return thread_client.post(
                submit_path,
                {'draft_revision': 0},
                format='json',
            )

        responses = self.parallel_requests(race)
        statuses = {item.status_code for item in responses}
        self.assertTrue(statuses in ({200, 409}, {200, 400}), responses)
        attempt = ModuleActivityAttempt.objects.get(pk=attempt_id)
        if attempt.status == ModuleActivityAttempt.Status.SUBMITTED:
            self.assertNotEqual(
                attempt.draft_answers.get(str(self.question.id), {}).get('text_answer'),
                'late draft',
            )
        else:
            self.assertEqual(attempt.draft_revision, 1)

    def test_repeated_submit_and_stale_editor_requests_are_serialized(self):
        client = APIClient()
        client.force_authenticate(self.student)
        started = client.post(self.start_path(), {}, format='json')
        attempt_id = started.data['attempt']['id']
        submit_path = (
            f'/api/modules/activity-attempts/{attempt_id}/submit/'
            f'?schedule={self.schedule.id}'
        )
        submitted = self.parallel_requests(
            lambda thread_client, _index: thread_client.post(
                submit_path,
                {'draft_revision': 0},
                format='json',
            )
        )
        self.assertEqual([item.status_code for item in submitted], [200, 200])

        expected_revision = self.activity.revision

        def edit(_student_client, index):
            teacher_client = APIClient()
            teacher_client.force_authenticate(self.teacher)
            return teacher_client.put(
                '/api/modules/activities/atomic-save/',
                {
                    'id': self.activity.id,
                    'expected_revision': expected_revision,
                    'title': f'Concurrent edit {index}',
                    'grading_period': ModuleActivity.GradingPeriod.PRELIM,
                    'is_published': True,
                    'questions': [{
                        'id': self.question.id,
                        'question_type': self.question.question_type,
                        'prompt': self.question.prompt,
                        'points': '1.00',
                        'order': 1,
                        'correct_text_answers': ['lock'],
                        'is_published': True,
                        'choices': [],
                        'matching_pairs': [],
                    }],
                },
                format='json',
            )

        edited = self.parallel_requests(edit)
        self.assertEqual(sorted(item.status_code for item in edited), [200, 409])
        self.activity.refresh_from_db()
        self.assertEqual(self.activity.revision, expected_revision + 1)


class SubmissionReviewApiTests(APITestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username='review-teacher',
            password='testpass123',
            role=User.Role.TEACHER,
        )
        self.student = User.objects.create_user(
            username='review-student',
            password='testpass123',
            first_name='Review',
            last_name='Student',
            role=User.Role.STUDENT,
        )
        self.subject = Subject.objects.create(code='REV101', name='Submission Review')
        school_year = SchoolYear.objects.create(start_year=2039, end_year=2040)
        self.term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        self.schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=self.term,
            days='MO',
            start_time='09:00',
            end_time='10:00',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.student)
        self.module = Module.objects.create(
            subject=self.subject,
            title='Review Module',
            slug='review-module',
        )
        self.activity = ModuleActivity.objects.create(
            module=self.module,
            title='Written Reflection',
            instructions='Submit a reflection.',
            activity_type=ModuleActivity.ActivityType.TEXT,
            points_possible=Decimal('50.00'),
        )
        self.submission = ModuleActivitySubmission.objects.create(
            activity=self.activity,
            student=self.student,
            text_answer='My reflection.',
        )

    def test_teacher_can_review_unlinked_submission(self):
        self.client.force_authenticate(self.teacher)

        response = self.client.get(
            f'/api/modules/submissions/{self.submission.id}/review/',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['student_name'], 'Review Student')
        self.assertEqual(response.data['activity_title'], 'Written Reflection')
        self.assertEqual(response.data['module_title'], 'Review Module')
        self.assertEqual(response.data['text_answer'], 'My reflection.')
        self.assertEqual(response.data['linked_grade_items'], [])

    def test_student_cannot_open_submission_review(self):
        self.client.force_authenticate(self.student)

        response = self.client.get(
            f'/api/modules/submissions/{self.submission.id}/review/',
        )

        self.assertEqual(response.status_code, 403)
        grade_response = self.client.post(
            f'/api/modules/submissions/{self.submission.id}/grade/',
            {'score': '10.00'},
            format='json',
        )
        self.assertEqual(grade_response.status_code, 403)

    def test_grade_action_validates_score_and_synchronizes_linked_gradebook(self):
        category = GradeCategory.objects.create(
            subject=self.subject,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Reflections',
            weight=Decimal('100.00'),
        )
        item = GradeItem.objects.create(
            schedule=self.schedule,
            grade_category=category,
            title=self.activity.title,
            points_possible=self.activity.points_possible,
            source_type=GradeItemSourceType.MODULE_ACTIVITY,
            module_activity=self.activity,
        )
        self.client.force_authenticate(self.teacher)

        invalid = self.client.post(
            f'/api/modules/submissions/{self.submission.id}/grade/',
            {'score': '51.00', 'feedback': 'Too high'},
            format='json',
        )
        self.assertEqual(invalid.status_code, 400)
        self.assertIn('score', invalid.data)

        response = self.client.post(
            f'/api/modules/submissions/{self.submission.id}/grade/',
            {'score': '42.00', 'feedback': 'Clear and thoughtful.'},
            format='json',
        )

        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(len(response.data['linked_grade_items']), 1)
        self.submission.refresh_from_db()
        self.assertEqual(self.submission.score, Decimal('42.00'))
        self.assertEqual(self.submission.feedback, 'Clear and thoughtful.')
        self.assertIsNotNone(self.submission.graded_at)
        score = StudentGradeItemScore.objects.get(
            grade_item=item,
            student=self.student,
        )
        self.assertEqual(score.raw_score, Decimal('42.00'))
        self.assertEqual(score.origin, StudentGradeItemScore.Origin.AUTOMATIC)
        dashboard = self.client.get('/api/overview/dashboard/')
        self.assertEqual(dashboard.data['metrics']['attention_count'], 0)
