from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.test import override_settings
from django.conf import settings
from unittest import skipUnless
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule

from .models import LegalAcknowledgment, PrivacyRequest, PurgeRun


@skipUnless(settings.ADVANCED_PRIVACY_FEATURES, 'Advanced privacy workflows are dormant.')
class PrivacyAccountabilityTests(APITestCase):
    def setUp(self):
        User = get_user_model()
        self.student = User.objects.create_user(
            username='privacy-student', password='StrongPass!482', role=User.Role.STUDENT,
        )
        self.other_student = User.objects.create_user(
            username='other-student', password='StrongPass!482', role=User.Role.STUDENT,
        )
        self.dpo = User.objects.create_user(
            username='school-dpo', password='StrongPass!482', role=User.Role.PRIVACY_OFFICER,
        )
        self.admin = User.objects.create_user(
            username='privacy-admin', password='StrongPass!482', role=User.Role.ADMIN,
        )

    def authenticate(self, user):
        self.client.force_authenticate(user)

    def test_current_legal_documents_are_acknowledged_idempotently(self):
        self.authenticate(self.student)
        initial = self.client.get('/api/privacy/legal-status/')
        self.assertEqual(initial.status_code, status.HTTP_200_OK)
        self.assertFalse(initial.data['complete'])
        self.assertEqual(len(initial.data['documents']), 3)

        for document in initial.data['documents']:
            first = self.client.post('/api/privacy/acknowledgments/', {
                'document': document['document'], 'version': document['version'],
            })
            second = self.client.post('/api/privacy/acknowledgments/', {
                'document': document['document'], 'version': document['version'],
            })
            self.assertEqual(first.status_code, status.HTTP_201_CREATED)
            self.assertEqual(second.status_code, status.HTTP_201_CREATED)
            self.assertEqual(first.data['id'], second.data['id'])

        self.assertTrue(self.client.get('/api/privacy/legal-status/').data['complete'])
        acknowledgment = LegalAcknowledgment.objects.first()
        acknowledgment.version = 'changed'
        with self.assertRaises(ValidationError):
            acknowledgment.save()
        with self.assertRaises(ValidationError):
            acknowledgment.delete()

    def test_student_requests_are_isolated_and_internal_notes_are_hidden(self):
        self.authenticate(self.student)
        created = self.client.post('/api/privacy/requests/', {
            'request_type': 'ACCESS',
            'details': 'Please provide access to the personal records held about me.',
        })
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        request_id = created.data['id']

        self.authenticate(self.other_student)
        self.assertEqual(self.client.get('/api/privacy/requests/').data['count'], 0)
        self.assertEqual(self.client.get(f'/api/privacy/requests/{request_id}/').status_code, status.HTTP_404_NOT_FOUND)

        self.authenticate(self.dpo)
        reviewing = self.client.post(f'/api/privacy/requests/{request_id}/transition/', {
            'status': 'IN_REVIEW',
            'public_message': 'The school privacy office is reviewing your request.',
            'internal_note': 'Verified against the invited roster.',
        })
        self.assertEqual(reviewing.status_code, status.HTTP_200_OK)
        approved = self.client.post(f'/api/privacy/requests/{request_id}/transition/', {
            'status': 'APPROVED',
            'public_message': 'The request is approved for administrative execution.',
            'internal_note': 'Release only requester-specific records.',
        })
        self.assertEqual(approved.status_code, status.HTTP_200_OK)
        self.assertTrue(any(event.get('internal_note') for event in approved.data['events']))

        self.authenticate(self.student)
        student_view = self.client.get(f'/api/privacy/requests/{request_id}/')
        self.assertEqual(student_view.status_code, status.HTTP_200_OK)
        self.assertTrue(all('internal_note' not in event for event in student_view.data['events']))

        self.authenticate(self.admin)
        executed = self.client.post(f'/api/privacy/requests/{request_id}/execute/', {
            'public_message': 'The approved request was completed through the official school channel.',
            'internal_note': 'Completion reference retained outside AralForge.',
        })
        self.assertEqual(executed.status_code, status.HTTP_200_OK)
        self.assertEqual(executed.data['status'], PrivacyRequest.Status.COMPLETED)

    def test_only_dpo_decides_and_only_admin_executes(self):
        privacy_request = PrivacyRequest.objects.create(
            subject=self.student,
            request_type=PrivacyRequest.RequestType.CORRECTION,
            details='Please correct the spelling of my account name.',
        )
        self.authenticate(self.admin)
        denied = self.client.post(f'/api/privacy/requests/{privacy_request.id}/transition/', {
            'status': 'DENIED',
        })
        self.assertEqual(denied.status_code, status.HTTP_403_FORBIDDEN)

        self.authenticate(self.dpo)
        executed = self.client.post(f'/api/privacy/requests/{privacy_request.id}/execute/', {
            'public_message': 'Done.',
        })
        self.assertEqual(executed.status_code, status.HTTP_403_FORBIDDEN)

    def test_privacy_officer_token_cannot_open_academic_apis(self):
        self.client.force_authenticate(user=None)
        access = str(RefreshToken.for_user(self.dpo).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        response = self.client.get('/api/subjects/subject-schedules/')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        allowed = self.client.get('/api/privacy/requests/')
        self.assertEqual(allowed.status_code, status.HTTP_200_OK)

    @override_settings(REAL_STUDENT_PRIVACY_ENFORCEMENT=True)
    def test_current_legal_acknowledgments_gate_normal_apis(self):
        self.client.force_authenticate(user=None)
        access = str(RefreshToken.for_user(self.student).access_token)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {access}')
        blocked = self.client.get('/api/subjects/subject-schedules/')
        self.assertEqual(blocked.status_code, status.HTTP_403_FORBIDDEN)

        status_response = self.client.get('/api/privacy/legal-status/')
        for document in status_response.data['documents']:
            self.client.post('/api/privacy/acknowledgments/', {
                'document': document['document'], 'version': document['version'],
            })
        allowed = self.client.get('/api/subjects/subject-schedules/')
        self.assertEqual(allowed.status_code, status.HTTP_200_OK)

    def test_retention_requires_dpo_policy_transfer_approval_date_and_no_hold(self):
        year = SchoolYear.objects.create(start_year=2038, end_year=2039)
        term = SchoolYearSemester.objects.create(school_year=year, semester=Semester.FIRST)
        subject = Subject.objects.create(code='RET101', name='Retention')
        schedule = SubjectSchedule.objects.create(
            subject=subject, school_year_semester=term, days='MWF',
            start_time='08:00', end_time='09:00', section='A',
        )
        enrollment = ScheduleStudent.objects.create(schedule=schedule, student=self.student)

        self.authenticate(self.dpo)
        policy = self.client.post('/api/privacy/retention-policies/approve/', {
            'version': 'DPO-2039-01',
            'retention_days_after_term_close': 30,
            'wording': 'Retain for thirty days following verified official transfer.',
        }, format='json')
        self.assertEqual(policy.status_code, 201, policy.data)

        self.authenticate(self.admin)
        closure = self.client.post('/api/privacy/term-closures/record-transfer/', {
            'term': term.id,
            'official_export_sha256': 'a' * 64,
            'official_transfer_reference': 'Registrar receipt RET-2039-01',
        }, format='json')
        self.assertEqual(closure.status_code, 201, closure.data)

        self.authenticate(self.dpo)
        approved = self.client.post(
            f"/api/privacy/term-closures/{closure.data['id']}/dpo-approve/", {}, format='json',
        )
        self.assertEqual(approved.status_code, 200, approved.data)
        hold = self.client.post('/api/privacy/legal-holds/', {
            'term': term.id, 'reason': 'Pending correction request.',
        }, format='json')
        self.assertEqual(hold.status_code, 201, hold.data)

        self.authenticate(self.admin)
        preview = self.client.post(
            f"/api/privacy/term-closures/{closure.data['id']}/purge-preview/", {}, format='json',
        )
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(preview.data['mode'], PurgeRun.Mode.DRY_RUN)
        self.assertEqual(preview.data['result'], PurgeRun.Result.BLOCKED)
        self.assertTrue(any('legal hold' in blocker for blocker in preview.data['blockers']))
        self.assertTrue(ScheduleStudent.objects.filter(pk=enrollment.pk).exists())

        execute = self.client.post(
            f"/api/privacy/term-closures/{closure.data['id']}/purge-execute/", {}, format='json',
        )
        self.assertEqual(execute.status_code, 400)
        self.assertTrue(ScheduleStudent.objects.filter(pk=enrollment.pk).exists())
