from datetime import timedelta
import json
import tempfile
import zipfile
from types import SimpleNamespace
from unittest.mock import Mock, patch

from botocore.exceptions import ClientError
from django.test import TransactionTestCase
from django.test import override_settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.utils import timezone
from rest_framework.test import APITestCase

from accounts.models import User
from learning_modules.models import Module, sync_module_progress_for_students

from .models import BackgroundJob
from .tasks import create_full_backup, enqueue, mark_failed, mark_running


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

    def test_old_queued_roster_import_expires_and_clears_uploaded_rows(self):
        job = BackgroundJob.objects.create(
            job_type=BackgroundJob.Type.IMPORT, owner=self.teacher,
            idempotency_key='roster-import:1', payload={'rows': [{'student_number': '123'}]},
        )
        BackgroundJob.objects.filter(pk=job.pk).update(created_at=timezone.now() - timedelta(hours=2))
        self.client.force_authenticate(self.teacher)
        response = self.client.get(f'/api/jobs/{job.pk}/')
        self.assertEqual(response.data['status'], BackgroundJob.Status.FAILED)
        self.assertIn('background worker', response.data['error'])
        job.refresh_from_db()
        self.assertEqual(job.payload, {})
        self.assertIsNotNone(job.finished_at)

    def test_queue_timeout_does_not_fail_running_or_recent_jobs(self):
        self.client.force_authenticate(self.teacher)
        for job_status in (BackgroundJob.Status.PENDING, BackgroundJob.Status.RUNNING):
            job = BackgroundJob.objects.create(
                job_type=BackgroundJob.Type.IMPORT, owner=self.teacher,
                idempotency_key=f'roster-import:{job_status}', status=job_status,
            )
            if job_status == BackgroundJob.Status.RUNNING:
                BackgroundJob.objects.filter(pk=job.pk).update(created_at=timezone.now() - timedelta(hours=2))
            response = self.client.get(f'/api/jobs/{job.pk}/')
            self.assertEqual(response.data['status'], job_status)

    def test_other_teacher_cannot_expire_an_import(self):
        job = BackgroundJob.objects.create(
            job_type=BackgroundJob.Type.IMPORT, owner=self.other_teacher,
            idempotency_key='roster-import:private',
        )
        BackgroundJob.objects.filter(pk=job.pk).update(created_at=timezone.now() - timedelta(hours=2))
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.client.get(f'/api/jobs/{job.pk}/').status_code, 404)
        job.refresh_from_db()
        self.assertEqual(job.status, BackgroundJob.Status.PENDING)


class BackgroundJobEnqueueTests(TransactionTestCase):
    @patch('jobs.tasks.logger.error')
    def test_storage_client_failure_is_persisted_with_safe_diagnostics(self, log_error):
        job = BackgroundJob.objects.create(job_type=BackgroundJob.Type.PDF_GENERATION)
        error = ClientError(
            {
                'Error': {'Code': 'AccessDenied', 'Message': 'Access denied'},
                'ResponseMetadata': {
                    'HTTPStatusCode': 403,
                    'RequestId': 'r2-request-id',
                    'HTTPHeaders': {'authorization': 'secret-request-header'},
                },
            },
            'PutObject',
        )

        mark_failed(job, error)

        job.refresh_from_db()
        self.assertEqual(job.status, BackgroundJob.Status.FAILED)
        self.assertIn('operation=PutObject', job.error)
        self.assertIn('code=AccessDenied', job.error)
        self.assertIn('http_status=403', job.error)
        self.assertIn('request_id=r2-request-id', job.error)
        self.assertNotIn('secret-request-header', job.error)
        log_error.assert_called_once_with(
            'Background job %s failed: %s',
            job.pk,
            job.error,
        )

    def test_expired_roster_job_does_not_block_resubmission(self):
        old = BackgroundJob.objects.create(
            job_type=BackgroundJob.Type.IMPORT,
            idempotency_key='roster-import:retry', payload={'rows': []},
        )
        BackgroundJob.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(hours=2))
        task = Mock()
        task.delay.return_value = SimpleNamespace(id='replacement-task')
        new = enqueue(task, job_type=BackgroundJob.Type.IMPORT, idempotency_key=old.idempotency_key)
        old.refresh_from_db()
        self.assertEqual(old.status, BackgroundJob.Status.FAILED)
        self.assertNotEqual(old.pk, new.pk)
        self.assertEqual(new.status, BackgroundJob.Status.PENDING)
        task.delay.assert_called_once()

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


class FullBackupTests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='backup_admin', password='testpass123', role=User.Role.ADMIN,
        )
        self.teacher = User.objects.create_user(
            username='backup_teacher', password='testpass123', role=User.Role.TEACHER,
        )

    @override_settings(DATABASES={'default': {'ENGINE': 'django.db.backends.postgresql'}})
    @patch('jobs.views.enqueue')
    def test_only_admin_can_start_full_backup(self, mocked_enqueue):
        mocked_enqueue.return_value = BackgroundJob.objects.create(
            job_type=BackgroundJob.Type.BACKUP, owner=self.admin,
        )
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.client.post('/api/jobs/backups/').status_code, 403)

        self.client.force_authenticate(self.admin)
        accepted = self.client.post('/api/jobs/backups/')
        self.assertEqual(accepted.status_code, 202)
        self.assertEqual(accepted.data['job_type'], BackgroundJob.Type.BACKUP)

    def test_download_is_admin_only_and_expired_archive_is_removed(self):
        name = default_storage.save('backups/test-backup.zip', ContentFile(b'archive'))
        job = BackgroundJob.objects.create(
            job_type=BackgroundJob.Type.BACKUP,
            owner=self.admin,
            status=BackgroundJob.Status.SUCCEEDED,
            result={'storage_name': name},
            finished_at=timezone.now(),
        )
        self.client.force_authenticate(self.teacher)
        self.assertEqual(self.client.get(f'/api/jobs/{job.pk}/backup-download/').status_code, 403)

        BackgroundJob.objects.filter(pk=job.pk).update(finished_at=timezone.now() - timedelta(hours=25))
        self.client.force_authenticate(self.admin)
        response = self.client.get(f'/api/jobs/{job.pk}/backup-download/')
        self.assertEqual(response.status_code, 404)
        self.assertFalse(default_storage.exists(name))

    @override_settings(
        DATABASES={'default': {'ENGINE': 'django.db.backends.postgresql'}},
        CELERY_TASK_ALWAYS_EAGER=False,
    )
    @patch('jobs.tasks._run_pg_dump')
    def test_backup_archive_contains_dump_manifest_and_media(self, mocked_dump):
        with tempfile.TemporaryDirectory() as media_root, override_settings(MEDIA_ROOT=media_root):
            media_name = default_storage.save('lesson-assets/diagram.svg', ContentFile(b'<svg />'))
            default_storage.save('backups/previous.zip', ContentFile(b'old backup'))
            job = BackgroundJob.objects.create(job_type=BackgroundJob.Type.BACKUP, owner=self.admin)

            def write_dump(destination):
                with open(destination, 'wb') as dump_file:
                    dump_file.write(b'PGDMP test archive')

            mocked_dump.side_effect = write_dump
            create_full_backup.run(str(job.pk))
            job.refresh_from_db()

            self.assertEqual(job.status, BackgroundJob.Status.SUCCEEDED)
            self.assertEqual(job.result['media_count'], 1)
            with default_storage.open(job.result['storage_name'], 'rb') as saved:
                with zipfile.ZipFile(saved) as archive:
                    self.assertEqual(archive.read('database.backup'), b'PGDMP test archive')
                    self.assertEqual(archive.read(f'media/{media_name}'), b'<svg />')
                    self.assertNotIn('media/backups/previous.zip', archive.namelist())
                    manifest = json.loads(archive.read('manifest.json'))
                    self.assertEqual(manifest['media_count'], 1)

    @override_settings(DATABASES={'default': {'ENGINE': 'django.db.backends.postgresql'}})
    @patch('jobs.tasks._run_pg_dump', side_effect=RuntimeError('dump failed'))
    def test_dump_failure_marks_backup_failed_without_artifact(self, mocked_dump):
        job = BackgroundJob.objects.create(job_type=BackgroundJob.Type.BACKUP, owner=self.admin)
        with self.assertRaises(RuntimeError):
            create_full_backup.run(str(job.pk))
        job.refresh_from_db()
        self.assertEqual(job.status, BackgroundJob.Status.FAILED)
        self.assertFalse(job.result)
        self.assertIn('could not be completed', job.error)
