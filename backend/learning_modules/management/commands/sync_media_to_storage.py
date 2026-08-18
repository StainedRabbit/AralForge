from pathlib import Path

from django.core.files import File
from django.core.files.storage import default_storage
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Copy a local media tree to the configured default storage without changing keys.'

    def add_arguments(self, parser):
        parser.add_argument('--source', required=True, help='Local media directory to copy.')
        parser.add_argument('--dry-run', action='store_true', help='Report changes without uploading.')
        parser.add_argument(
            '--overwrite',
            action='store_true',
            help='Replace objects that already exist at the same storage key.',
        )

    def handle(self, *args, **options):
        source = Path(options['source']).expanduser().resolve()
        if not source.is_dir():
            raise CommandError(f'Media source directory does not exist: {source}')

        uploaded = skipped = 0
        files = sorted(path for path in source.rglob('*') if path.is_file())
        for path in files:
            storage_name = path.relative_to(source).as_posix()
            exists = default_storage.exists(storage_name)
            if exists and not options['overwrite']:
                skipped += 1
                continue

            if options['dry_run']:
                uploaded += 1
                self.stdout.write(f'Would upload {storage_name}')
                continue

            if exists:
                default_storage.delete(storage_name)
            with path.open('rb') as source_file:
                saved_name = default_storage.save(storage_name, File(source_file))
            if saved_name != storage_name:
                raise CommandError(
                    f'Storage renamed {storage_name!r} to {saved_name!r}; aborting to preserve database references.'
                )
            uploaded += 1

        self.stdout.write(self.style.SUCCESS(
            f'Media sync complete: {uploaded} uploaded, {skipped} already present, {len(files)} total.'
        ))
