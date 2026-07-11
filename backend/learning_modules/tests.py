import tempfile
from unittest.mock import patch
from pathlib import Path
from decimal import Decimal

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from django.test.utils import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from assessments.models import Assessment
from coding.models import ProgrammingProblem
from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule

from .models import (
    Module,
    ModuleAccess,
    ModuleActivity,
    ModuleActivityAnswer,
    ModuleActivityAttempt,
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
        schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='TTH',
            start_time='10:00',
            end_time='11:30',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=schedule, student=self.student)
        self.free_module = Module.objects.create(
            title='Free Topic',
            slug='free-topic',
            subject=self.subject,
            is_paid=False,
            is_published=True,
        )
        self.paid_module = Module.objects.create(
            title='Paid Topic',
            slug='paid-topic',
            is_paid=True,
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
            is_paid=True,
            is_published=True,
        )

    def test_student_sees_enrolled_modules_as_locked_without_payment(self):
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/modules/')

        self.assertEqual(response.status_code, 200)
        ids = {module['id'] for module in response.data}
        self.assertEqual(ids, {self.free_module.id, self.paid_module.id})
        statuses = {module['id']: module['access_status'] for module in response.data}
        self.assertEqual(statuses[self.free_module.id], 'LOCKED')
        self.assertEqual(statuses[self.paid_module.id], 'LOCKED')

    def test_student_sees_paid_module_after_active_grant(self):
        grant = ModuleAccess.objects.create(
            activated_by=self.teacher,
            module=self.paid_module,
            student=self.student,
            payment_status=ModuleAccess.PaymentStatus.PAID,
            is_active=True,
        )
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/modules/')

        self.assertEqual(response.status_code, 200)
        ids = {module['id'] for module in response.data}
        self.assertEqual(ids, {self.free_module.id, self.paid_module.id})
        self.assertEqual(
            grant.expires_at.date(),
            add_calendar_months(grant.activated_at, 5).date(),
        )

    def test_advance_study_grant_bypasses_enrollment_and_payment(self):
        grant = ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.ADVANCE_STUDY,
            activated_by=self.teacher,
            amount_paid=500,
            module=self.advance_module,
            payment_reference='SHOULD-CLEAR',
            payment_status=ModuleAccess.PaymentStatus.PAID,
            student=self.student,
        )
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/modules/')

        self.assertEqual(response.status_code, 200)
        self.assertIn(
            self.advance_module.id,
            {module['id'] for module in response.data},
        )
        grant.refresh_from_db()
        self.assertEqual(grant.amount_paid, 500)
        self.assertEqual(grant.payment_reference, 'SHOULD-CLEAR')
        self.assertEqual(grant.payment_status, ModuleAccess.PaymentStatus.PAID)
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
            {module['id'] for module in response.data},
        )

    def test_payment_and_advance_grants_can_coexist(self):
        payment = ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.PAYMENT,
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

        self.assertNotEqual(payment.id, advance.id)
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
            instructions='Complete this after payment.',
            is_published=True,
        )
        problem = ProgrammingProblem.objects.create(
            module=self.paid_module,
            topic=topic,
            lesson=lesson,
            title='Locked Problem',
            slug='locked-problem',
            description='Solve after payment.',
            is_published=True,
        )
        assessment = Assessment.objects.create(
            module=self.paid_module,
            subject=self.subject,
            title='Locked Mock Exam',
            kind=Assessment.Kind.MOCK_EXAM,
            is_published=True,
        )
        progress = ModuleLessonProgress.objects.create(
            lesson=lesson,
            student=self.student,
            completed_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        topic_response = self.client.get('/api/modules/topics/')
        lesson_response = self.client.get('/api/modules/lessons/')
        activity_response = self.client.get('/api/modules/activities/')
        coding_response = self.client.get('/api/coding/problems/')
        assessment_response = self.client.get('/api/assessments/assessments/')
        progress_response = self.client.get('/api/modules/lesson-progress/')

        self.assertNotIn(topic.id, {item['id'] for item in topic_response.data})
        self.assertNotIn(lesson.id, {item['id'] for item in lesson_response.data})
        self.assertNotIn(activity.id, {item['id'] for item in activity_response.data})
        self.assertNotIn(problem.id, {item['id'] for item in coding_response.data})
        self.assertNotIn(
            assessment.id,
            {item['id'] for item in assessment_response.data},
        )
        self.assertNotIn(progress.id, {item['id'] for item in progress_response.data})

    def test_payment_grant_unlocks_web_module_content(self):
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
        problem = ProgrammingProblem.objects.create(
            module=self.paid_module,
            topic=topic,
            lesson=lesson,
            title='Paid Problem',
            slug='paid-problem',
            description='Solve it.',
            is_published=True,
        )
        assessment = Assessment.objects.create(
            module=self.paid_module,
            subject=self.subject,
            title='Paid Mock Exam',
            kind=Assessment.Kind.MOCK_EXAM,
            is_published=True,
        )
        progress = ModuleLessonProgress.objects.create(
            lesson=lesson,
            student=self.student,
            completed_at=timezone.now(),
        )
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.PAYMENT,
            activated_by=self.teacher,
            module=self.paid_module,
            student=self.student,
        )
        self.client.force_authenticate(self.student)

        for path, expected_id in (
            ('/api/modules/topics/', topic.id),
            ('/api/modules/lessons/', lesson.id),
            ('/api/modules/activities/', activity.id),
            ('/api/coding/problems/', problem.id),
            ('/api/assessments/assessments/', assessment.id),
            ('/api/modules/lesson-progress/', progress.id),
        ):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn(expected_id, {item['id'] for item in response.data})

    def test_enrolled_student_can_download_pdf_before_payment(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                self.paid_module.pdf_file.save(
                    'guide.pdf',
                    ContentFile(b'%PDF-1.4 module guide'),
                )
                self.client.force_authenticate(self.student)
                response = self.client.get(
                    f'/api/modules/modules/{self.paid_module.id}/download-pdf/',
                )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    b''.join(response.streaming_content),
                    b'%PDF-1.4 module guide',
                )

                self.client.force_authenticate(self.other_student)
                denied = self.client.get(
                    f'/api/modules/modules/{self.paid_module.id}/download-pdf/',
                )
                self.assertEqual(denied.status_code, 403)

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
        problem = ProgrammingProblem.objects.create(
            module=self.advance_module,
            topic=topic,
            lesson=lesson,
            title='Advanced Problem',
            slug='advanced-problem',
            description='Solve it.',
            is_published=True,
        )
        assessment = Assessment.objects.create(
            module=self.advance_module,
            subject=self.advance_subject,
            title='Advanced Check',
            kind=Assessment.Kind.PRACTICE,
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
            completed_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        for path, expected_id in (
            ('/api/modules/topics/', topic.id),
            ('/api/modules/lessons/', lesson.id),
            ('/api/modules/activities/', activity.id),
            ('/api/coding/problems/', problem.id),
            ('/api/assessments/assessments/', assessment.id),
            ('/api/modules/lesson-progress/', progress.id),
        ):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 200)
            self.assertIn(expected_id, {item['id'] for item in response.data})

        grant.is_active = False
        grant.save()
        hidden_response = self.client.get('/api/modules/lesson-progress/')
        self.assertNotIn(
            progress.id,
            {item['id'] for item in hidden_response.data},
        )

        grant.is_active = True
        grant.save()
        restored_response = self.client.get('/api/modules/lesson-progress/')
        self.assertIn(
            progress.id,
            {item['id'] for item in restored_response.data},
        )


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
            title='CC 102 Module',
            slug='cc-102-module-tests',
            subject=self.subject,
            is_paid=False,
            is_published=True,
        )
        self.module.subjects.add(self.subject)
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.PAYMENT,
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

    def test_progress_identity_cannot_be_reassigned(self):
        progress = ModuleLessonProgress.objects.create(
            lesson=self.lesson_one,
            student=self.student,
        )
        self.client.force_authenticate(self.student)

        response = self.client.patch(
            f'/api/modules/lesson-progress/{progress.id}/',
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
            {
                'lesson': self.lesson_one.id,
                'student': self.student.id,
                'completed_at': '2026-06-24T08:00:00Z',
            },
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
            attempt_number=1,
            is_submitted=True,
            submitted_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        response = self.client.post(
            '/api/modules/lesson-progress/',
            {
                'lesson': self.lesson_one.id,
                'student': self.student.id,
                'completed_at': '2026-06-24T08:00:00Z',
            },
            format='json',
        )

        self.assertEqual(response.status_code, 201)

    def test_completing_all_lessons_rolls_up_topic_and_module(self):
        self.client.force_authenticate(self.student)

        first_response = self.client.post(
            '/api/modules/lesson-progress/',
            {
                'lesson': self.lesson_one.id,
                'student': self.student.id,
                'completed_at': '2026-06-24T08:00:00Z',
            },
            format='json',
        )
        second_response = self.client.post(
            '/api/modules/lesson-progress/',
            {
                'lesson': self.lesson_two.id,
                'student': self.student.id,
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
            completed_at=timezone.now(),
        )
        ModuleLessonProgress.objects.create(
            lesson=self.lesson_two,
            student=self.student,
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
        )
        self.client.force_authenticate(self.teacher)

        response = self.client.get('/api/modules/lesson-progress/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)


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
            access_type=ModuleAccess.AccessType.PAYMENT,
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
        ids = {item['id'] for item in response.data}
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
            access_type=ModuleAccess.AccessType.PAYMENT,
            activated_by=self.teacher,
            module=self.module,
            student=self.student,
        )

    def fake_module_pdf(self, module):
        module.pdf_file.save(
            'generated-module.pdf',
            ContentFile(b'%PDF-1.4 generated module'),
            save=False,
        )
        module.pdf_generated_at = timezone.now()
        module.pdf_is_outdated = False
        module.save(update_fields=['pdf_file', 'pdf_generated_at', 'pdf_is_outdated'])
        return module

    def fake_lesson_pdf(self, lesson):
        lesson.pdf_file.save(
            'generated-lesson.pdf',
            ContentFile(b'%PDF-1.4 generated lesson'),
            save=False,
        )
        lesson.pdf_generated_at = timezone.now()
        lesson.pdf_is_outdated = False
        lesson.save(update_fields=['pdf_file', 'pdf_generated_at', 'pdf_is_outdated'])
        return lesson

    def test_teacher_can_regenerate_module_pdf(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                self.client.force_authenticate(self.teacher)
                with patch(
                    'learning_modules.views.generate_module_pdf',
                    side_effect=self.fake_module_pdf,
                ):
                    response = self.client.post(
                        f'/api/modules/modules/{self.module.id}/regenerate_pdf/',
                    )

                self.assertEqual(response.status_code, 200)
                self.module.refresh_from_db()
                self.assertTrue(self.module.pdf_file)
                self.assertFalse(self.module.pdf_is_outdated)
                self.assertIsNotNone(self.module.pdf_generated_at)

    def test_teacher_can_regenerate_lesson_pdf(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                self.client.force_authenticate(self.teacher)
                with patch(
                    'learning_modules.views.generate_lesson_pdf',
                    side_effect=self.fake_lesson_pdf,
                ):
                    response = self.client.post(
                        f'/api/modules/lessons/{self.lesson.id}/regenerate_pdf/',
                    )

                self.assertEqual(response.status_code, 200)
                self.lesson.refresh_from_db()
                self.assertTrue(self.lesson.pdf_file)
                self.assertFalse(self.lesson.pdf_is_outdated)
                self.assertIsNotNone(self.lesson.pdf_generated_at)

    def test_lesson_pdf_includes_main_activity_preview_without_answers_or_points(self):
        from learning_modules.services.pdf_generation import generate_lesson_pdf

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
                    return_value=b'%PDF-1.4 generated lesson',
                ) as render_pdf:
                    generate_lesson_pdf(self.lesson)

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

    def test_student_downloads_saved_lesson_pdf(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                self.lesson.pdf_file.save(
                    'lesson.pdf',
                    ContentFile(b'%PDF-1.4 saved lesson'),
                )
                self.lesson.pdf_generated_at = timezone.now()
                self.lesson.pdf_is_outdated = False
                self.lesson.save(update_fields=[
                    'pdf_file',
                    'pdf_generated_at',
                    'pdf_is_outdated',
                ])
                self.client.force_authenticate(self.student)

                response = self.client.get(
                    f'/api/modules/lessons/{self.lesson.id}/download_pdf/',
                )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    b''.join(response.streaming_content),
                    b'%PDF-1.4 saved lesson',
                )
                response.close()

    def test_student_download_does_not_regenerate_outdated_existing_pdf(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                self.lesson.pdf_file.save(
                    'lesson.pdf',
                    ContentFile(b'%PDF-1.4 old lesson'),
                )
                self.lesson.pdf_generated_at = timezone.now()
                self.lesson.pdf_is_outdated = True
                self.lesson.save(update_fields=[
                    'pdf_file',
                    'pdf_generated_at',
                    'pdf_is_outdated',
                ])
                self.client.force_authenticate(self.student)

                with patch(
                    'learning_modules.views.generate_lesson_pdf',
                    side_effect=AssertionError('should not regenerate'),
                ):
                    response = self.client.get(
                        f'/api/modules/lessons/{self.lesson.id}/download_pdf/',
                    )

                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    b''.join(response.streaming_content),
                    b'%PDF-1.4 old lesson',
                )
                response.close()

    def test_student_download_generates_once_when_published_pdf_missing(self):
        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                self.lesson.pdf_file = ''
                self.lesson.pdf_generated_at = None
                self.lesson.pdf_is_outdated = True
                self.lesson.save(update_fields=[
                    'pdf_file',
                    'pdf_generated_at',
                    'pdf_is_outdated',
                ])
                self.client.force_authenticate(self.student)
                with patch(
                    'learning_modules.views.generate_lesson_pdf',
                    side_effect=self.fake_lesson_pdf,
                ) as generate_lesson_pdf:
                    response = self.client.get(
                        f'/api/modules/lessons/{self.lesson.id}/download_pdf/',
                    )

                self.assertEqual(response.status_code, 200)
                b''.join(response.streaming_content)
                response.close()
                self.assertEqual(generate_lesson_pdf.call_count, 1)
                self.lesson.refresh_from_db()
                self.assertTrue(self.lesson.pdf_file)
                self.assertFalse(self.lesson.pdf_is_outdated)

    def test_lesson_edit_marks_generated_pdf_outdated(self):
        self.lesson.pdf_generated_at = timezone.now()
        self.lesson.pdf_is_outdated = False
        self.lesson.save(update_fields=['pdf_generated_at', 'pdf_is_outdated'])

        self.lesson.title = 'Updated Printable Lesson'
        self.lesson.save()

        self.lesson.refresh_from_db()
        self.assertTrue(self.lesson.pdf_is_outdated)

    def test_unpublished_lesson_pdf_is_not_available_to_student(self):
        self.lesson.is_published = False
        self.lesson.save()
        self.client.force_authenticate(self.student)

        response = self.client.get(
            f'/api/modules/lessons/{self.lesson.id}/download_pdf/',
        )

        self.assertEqual(response.status_code, 404)

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
            is_published=True,
        )
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.PAYMENT,
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

    def test_teacher_can_create_lesson_main_activity_question(self):
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

        self.assertEqual(response.status_code, 201)
        self.assertEqual(
            ModuleActivityQuestion.objects.get(id=response.data['id']).activity,
            self.activity,
        )

    def test_student_sees_published_activity_but_not_answer_keys(self):
        question = self.create_question(
            ModuleActivityQuestion.QuestionType.FILL_BLANK,
            1,
            correct_text_answers=['JVM'],
            expected_output='JVM',
            explanation='The JVM runs bytecode.',
        )
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/activity-questions/')

        self.assertEqual(response.status_code, 200)
        row = next(item for item in response.data if item['id'] == question.id)
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
        attempt_response = self.client.post(
            '/api/modules/activity-attempts/',
            {'activity': self.activity.id, 'student': self.student.id},
            format='json',
        )
        answer_response = self.client.post(
            '/api/modules/activity-answers/',
            {
                'attempt': attempt_response.data['id'],
                'question': question.id,
                'selected_choice': wrong_choice.id,
                'text_answer': '',
                'choice_order': [],
                'matching_answer': {},
            },
            format='json',
        )
        self.client.post(
            f'/api/modules/activity-attempts/{attempt_response.data["id"]}/submit/',
        )

        question_response = self.client.get('/api/modules/activity-questions/')
        choice_response = self.client.get('/api/modules/activity-choices/')
        answer_detail_response = self.client.get(
            f'/api/modules/activity-answers/{answer_response.data["id"]}/',
        )

        question_row = next(item for item in question_response.data if item['id'] == question.id)
        correct_choice_row = next(
            item for item in choice_response.data if item['id'] == correct_choice.id
        )
        self.assertNotIn('explanation', question_row)
        self.assertNotIn('is_correct', correct_choice_row)
        self.assertNotIn('is_correct', answer_detail_response.data)
        self.assertNotIn('points_earned', answer_detail_response.data)
        self.assertNotIn('feedback', answer_detail_response.data)

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
            attempt_number=1,
            score=Decimal('0.00'),
            max_score=Decimal('1.00'),
            is_submitted=True,
            submitted_at=timezone.now(),
        )
        ModuleActivityAttempt.objects.create(
            activity=self.activity,
            student=self.student,
            attempt_number=2,
            score=Decimal('0.00'),
            max_score=Decimal('1.00'),
            is_submitted=True,
            submitted_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/activity-questions/')

        row = next(item for item in response.data if item['id'] == question.id)
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
            attempt_number=1,
            score=Decimal('1.00'),
            max_score=Decimal('1.00'),
            is_submitted=True,
            submitted_at=timezone.now(),
        )
        self.client.force_authenticate(self.student)

        question_response = self.client.get('/api/modules/activity-questions/')
        choice_response = self.client.get('/api/modules/activity-choices/')

        question_row = next(item for item in question_response.data if item['id'] == question.id)
        choice_row = next(item for item in choice_response.data if item['id'] == correct_choice.id)
        self.assertEqual(question_row['explanation'], 'The JDK compiles Java.')
        self.assertTrue(choice_row['is_correct'])

    def test_student_attempt_limit_is_enforced(self):
        self.client.force_authenticate(self.student)

        first = self.client.post(
            '/api/modules/activity-attempts/',
            {'activity': self.activity.id, 'student': self.student.id},
            format='json',
        )
        second = self.client.post(
            '/api/modules/activity-attempts/',
            {'activity': self.activity.id, 'student': self.student.id},
            format='json',
        )
        third = self.client.post(
            '/api/modules/activity-attempts/',
            {'activity': self.activity.id, 'student': self.student.id},
            format='json',
        )

        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 201)
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
        attempt_response = self.client.post(
            '/api/modules/activity-attempts/',
            {'activity': self.activity.id, 'student': self.student.id},
            format='json',
        )
        attempt_id = attempt_response.data['id']

        answers = [
            {'question': multiple_choice.id, 'selected_choice': correct_choice.id},
            {'question': true_false.id, 'selected_choice': tf_choice.id},
            {'question': fill_blank.id, 'text_answer': ' bytecode '},
            {'question': ordering.id, 'choice_order': [order_one.id, order_two.id]},
            {'question': matching.id, 'matching_answer': {str(pair.id): 'Runs bytecode'}},
            {'question': code_output.id, 'text_answer': 'Hello'},
        ]
        for answer in answers:
            payload = {
                'attempt': attempt_id,
                'selected_choice': None,
                'text_answer': '',
                'choice_order': [],
                'matching_answer': {},
                **answer,
            }
            response = self.client.post(
                '/api/modules/activity-answers/',
                payload,
                format='json',
            )
            self.assertEqual(response.status_code, 201)

        submit_response = self.client.post(
            f'/api/modules/activity-attempts/{attempt_id}/submit/',
        )

        self.assertEqual(submit_response.status_code, 200)
        self.assertEqual(Decimal(submit_response.data['score']), Decimal('6.00'))
        self.assertEqual(
            ModuleActivityAnswer.objects.filter(
                attempt_id=attempt_id,
                is_correct=True,
            ).count(),
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
            is_submitted=True,
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

        self.assertEqual(response.status_code, 400)
