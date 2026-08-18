from pathlib import Path

from django.apps import apps
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError
from django.db import models


class Command(BaseCommand):
    help = 'Verify that database file references and optional source files exist in default storage.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--source',
            help='Optional local media tree; every relative file key must exist in storage.',
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

        self.stdout.write(self.style.SUCCESS(
            f'Verified {len(names)} media object(s) in default storage.'
        ))
