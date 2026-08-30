from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import TransactionTestCase
from rest_framework.test import APITestCase

from accounts.models import User
from learning_modules.models import Module, sync_module_progress_for_students

from .models import BackgroundJob
from .tasks import enqueue, mark_running


class BackgroundJobApiTests(APITestCase):
    def setUp(self):
        self.teacher = User.objects.create_user(
            username='job_teacher', password='testpass123', role=User.Role.TEACHER,
        )
        self.other_teacher = User.objects.create_user(
            username='other_job_teacher', password='testpass123', role=User.Role.TEACHER,
        )

    def test_teacher_only_sees_owned_jobs(self):
        owned = BackgroundJob.objects.create(
            job_type=BackgroundJob.Type.EXPORT, owner=self.teacher,
        )
        BackgroundJob.objects.create(
            job_type=BackgroundJob.Type.EXPORT, owner=self.other_teacher,
        )
        self.client.force_authenticate(self.teacher)

        listed = self.client.get('/api/jobs/')
        detail = self.client.get(f'/api/jobs/{owned.id}/')

        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.data['count'], 1)
        self.assertEqual(detail.status_code, 200)


class BackgroundJobEnqueueTests(TransactionTestCase):
    def test_active_idempotency_key_reuses_pending_job(self):
        task = Mock()
        task.delay.return_value = SimpleNamespace(id='celery-test-id')

        first = enqueue(
            task,
            job_type=BackgroundJob.Type.IMPORT,
            payload={'source': 'test'},
            idempotency_key='import:test',
        )
        second = enqueue(
            task,
            job_type=BackgroundJob.Type.IMPORT,
            payload={'source': 'test'},
            idempotency_key='import:test',
        )

        self.assertEqual(first.id, second.id)
        self.assertEqual(BackgroundJob.objects.count(), 1)
        task.delay.assert_called_once()

    def test_dispatch_failure_is_persisted_without_losing_the_job(self):
        task = Mock()
        task.delay.side_effect = ConnectionError('broker unavailable')

        job = enqueue(
            task,
            job_type=BackgroundJob.Type.EXPORT,
            idempotency_key='export:failure-test',
        )
        job.refresh_from_db()

        self.assertEqual(job.status, BackgroundJob.Status.FAILED)
        self.assertIn('broker unavailable', job.error)
        self.assertIsNotNone(job.finished_at)

    def test_running_attempts_are_counted_and_failure_state_is_cleared(self):
        job = BackgroundJob.objects.create(
            job_type=BackgroundJob.Type.MODULE_PROGRESS,
            status=BackgroundJob.Status.FAILED,
            error='previous failure',
        )

        mark_running(job)

        self.assertEqual(job.status, BackgroundJob.Status.RUNNING)
        self.assertEqual(job.attempts, 1)
        self.assertEqual(job.error, '')
        self.assertIsNone(job.finished_at)

    @patch('jobs.tasks.enqueue')
    @patch('learning_modules.models.progress_contexts_for_module')
    def test_large_module_progress_sync_is_enqueued_once(self, contexts, enqueue_job):
        module = Module.objects.create(title='Large progress module', slug='large-progress-module')
        contexts.return_value = {
            (student_id, 'PERSONAL', None)
            for student_id in range(1, 252)
        }

        result = sync_module_progress_for_students(module)

        self.assertEqual(result, enqueue_job.return_value)
        call = enqueue_job.call_args
        self.assertEqual(call.kwargs['job_type'], BackgroundJob.Type.MODULE_PROGRESS)
        self.assertEqual(call.kwargs['total'], 251)
        self.assertEqual(call.kwargs['payload'], {'module_id': module.id})
        self.assertEqual(call.kwargs['idempotency_key'], f'module-progress:{module.id}')
