from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase, override_settings

from learning_modules.services.pdf_generation import resolve_media_source


class MediaStorageCommandTests(TestCase):
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
