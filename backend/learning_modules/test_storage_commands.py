from io import BytesIO, StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from learning_modules.services.pdf_generation import resolve_media_source


class ProbeStorage:
    def __init__(self, fail_stage=None):
        self.data = {}
        self.fail_stage = fail_stage
        self.deleted = []

    def save(self, name, content):
        self.data[name] = content.read()
        if self.fail_stage == 'write':
            raise RuntimeError('simulated write failure')
        return name

    def exists(self, name):
        return name in self.data

    def open(self, name, _mode):
        if self.fail_stage == 'read':
            raise RuntimeError('simulated read failure')
        return BytesIO(self.data[name])

    def delete(self, name):
        self.deleted.append(name)
        self.data.pop(name, None)


class MediaStorageCommandTests(TestCase):
    @patch('learning_modules.management.commands.verify_media_storage.default_storage')
    def test_write_probe_writes_reads_and_deletes_diagnostic_object(self, storage):
        probe_storage = ProbeStorage()
        storage.save.side_effect = probe_storage.save
        storage.exists.side_effect = probe_storage.exists
        storage.open.side_effect = probe_storage.open
        storage.delete.side_effect = probe_storage.delete
        output = StringIO()

        call_command('verify_media_storage', write_probe=True, stdout=output)

        self.assertEqual(probe_storage.data, {})
        self.assertEqual(len(probe_storage.deleted), 1)
        self.assertIn('write/read/delete probe succeeded', output.getvalue())

    @patch('learning_modules.management.commands.verify_media_storage.default_storage')
    def test_write_probe_cleans_up_after_write_or_read_failure(self, storage):
        for fail_stage in ('write', 'read'):
            with self.subTest(fail_stage=fail_stage):
                probe_storage = ProbeStorage(fail_stage=fail_stage)
                storage.reset_mock()
                storage.save.side_effect = probe_storage.save
                storage.exists.side_effect = probe_storage.exists
                storage.open.side_effect = probe_storage.open
                storage.delete.side_effect = probe_storage.delete

                with self.assertRaisesRegex(CommandError, f'{fail_stage} probe failed'):
                    call_command('verify_media_storage', write_probe=True, stdout=StringIO())

                self.assertEqual(probe_storage.data, {})
                self.assertEqual(len(probe_storage.deleted), 1)

    def test_sync_and_verify_preserve_relative_storage_keys(self):
        with TemporaryDirectory() as source_dir, TemporaryDirectory() as storage_dir:
            source = Path(source_dir)
            (source / 'module_lesson_assets').mkdir()
            (source / 'module_lesson_assets' / 'diagram.svg').write_text(
                '<svg></svg>',
                encoding='utf-8',
            )
            storage_settings = {
                'default': {
                    'BACKEND': 'django.core.files.storage.FileSystemStorage',
                    'OPTIONS': {'location': storage_dir},
                },
                'staticfiles': {
                    'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage',
                },
            }
            with override_settings(STORAGES=storage_settings):
                call_command('sync_media_to_storage', source=source_dir, stdout=StringIO())
                call_command(
                    'verify_media_storage',
                    source=source_dir,
                    stdout=StringIO(),
                )

            self.assertTrue(
                (Path(storage_dir) / 'module_lesson_assets' / 'diagram.svg').exists()
            )

    @patch('learning_modules.services.pdf_generation.default_storage.url')
    @patch('learning_modules.services.pdf_generation.default_storage.exists', return_value=True)
    def test_pdf_media_resolution_uses_remote_storage(self, mocked_exists, mocked_url):
        mocked_url.return_value = 'https://storage.example/signed/diagram.svg'

        resolved = resolve_media_source('/media/module_lesson_assets/diagram.svg')

        self.assertEqual(resolved, 'https://storage.example/signed/diagram.svg')
        mocked_exists.assert_called_with('module_lesson_assets/diagram.svg')
