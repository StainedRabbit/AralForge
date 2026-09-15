import uuid
from pathlib import Path

from django.apps import apps
from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError
from django.db import models

from config.object_storage import safe_exception_message


PROBE_CONTENT = b'AralForge object storage write probe\n'


class Command(BaseCommand):
    help = 'Verify that database file references and optional source files exist in default storage.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--source',
            help='Optional local media tree; every relative file key must exist in storage.',
        )
        parser.add_argument(
            '--write-probe',
            action='store_true',
            help='Write, read, and delete a unique diagnostic object.',
        )

    def handle(self, *args, **options):
        names = set()
        for model in apps.get_models():
            for field in model._meta.fields:
                if not isinstance(field, models.FileField):
                    continue
                values = model._default_manager.exclude(**{field.name: ''}).values_list(
                    field.name,
                    flat=True,
                )
                names.update(value for value in values.iterator() if value)

        if options['source']:
            source = Path(options['source']).expanduser().resolve()
            if not source.is_dir():
                raise CommandError(f'Media source directory does not exist: {source}')
            names.update(
                path.relative_to(source).as_posix()
                for path in source.rglob('*')
                if path.is_file()
            )

        missing = [name for name in sorted(names) if not default_storage.exists(name)]
        if missing:
            preview = ', '.join(missing[:10])
            suffix = '' if len(missing) <= 10 else f' (and {len(missing) - 10} more)'
            raise CommandError(
                f'{len(missing)} media object(s) are missing: {preview}{suffix}'
            )

        if options['write_probe']:
            self._write_probe()

        self.stdout.write(self.style.SUCCESS(
            f'Verified {len(names)} media object(s) in default storage.'
        ))

    def _write_probe(self):
        summary = getattr(settings, 'OBJECT_STORAGE_CONFIG_SUMMARY', None)
        if summary:
            self.stdout.write(
                'Storage target: '
                f'source={summary["source"]} '
                f'endpoint_host={summary["endpoint_host"]} '
                f'bucket={summary["bucket"]} '
                f'region={summary["region"]} '
                f'access_key_fingerprint=sha256:{summary["access_key_fingerprint"]}'
            )
        else:
            self.stdout.write(
                f'Storage target: backend={default_storage.__class__.__name__}'
            )

        probe_name = f'_diagnostics/storage-probes/{uuid.uuid4().hex}.txt'
        saved_name = None
        stage = 'write'
        try:
            saved_name = default_storage.save(probe_name, ContentFile(PROBE_CONTENT))
            stage = 'existence check'
            if not default_storage.exists(saved_name):
                raise RuntimeError('the uploaded probe object was not found')
            stage = 'read'
            with default_storage.open(saved_name, 'rb') as stored_file:
                if stored_file.read() != PROBE_CONTENT:
                    raise RuntimeError('the downloaded probe content did not match')
        except Exception as error:
            raise CommandError(
                f'Object storage {stage} probe failed: {safe_exception_message(error)}'
            ) from error
        finally:
            cleanup_names = {probe_name}
            if saved_name:
                cleanup_names.add(saved_name)
            for name in cleanup_names:
                try:
                    if default_storage.exists(name):
                        default_storage.delete(name)
                except Exception as error:
                    if saved_name is not None:
                        raise CommandError(
                            'Object storage cleanup probe failed: '
                            f'{safe_exception_message(error)}'
                        ) from error

        self.stdout.write(self.style.SUCCESS(
            'Object storage write/read/delete probe succeeded.'
        ))
