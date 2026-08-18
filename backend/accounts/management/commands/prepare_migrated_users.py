import csv
import os
import secrets
import string
from pathlib import Path

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


class Command(BaseCommand):
    help = 'Rotate every migrated password and require first-login password setup.'

    def add_arguments(self, parser):
        parser.add_argument('--output', required=True, help='Off-repository CSV for one-time credentials.')
        parser.add_argument(
            '--confirm',
            action='store_true',
            help='Required acknowledgement that all user passwords will be replaced.',
        )

    def handle(self, *args, **options):
        if not options['confirm']:
            raise CommandError('Pass --confirm to rotate every user password.')

        output = Path(options['output']).expanduser().resolve()
        repository_root = settings.BASE_DIR.parent.resolve()
        if output == repository_root or output.is_relative_to(repository_root):
            raise CommandError('The credential export must be written outside the repository.')
        if output.exists():
            raise CommandError(f'Refusing to overwrite existing credential export: {output}')
        output.parent.mkdir(parents=True, exist_ok=True)

        alphabet = string.ascii_letters + string.digits + '!@#$%^&*-_=+'
        users = list(get_user_model().objects.order_by('id'))
        credentials = [
            (user, ''.join(secrets.choice(alphabet) for _ in range(24)))
            for user in users
        ]

        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        descriptor = os.open(output, flags, 0o600)
        try:
            with os.fdopen(descriptor, 'w', newline='', encoding='utf-8') as output_file:
                writer = csv.writer(output_file)
                writer.writerow(('username', 'temporary_password', 'role', 'is_superuser'))
                for user, password in credentials:
                    writer.writerow((user.username, password, user.role, user.is_superuser))

            with transaction.atomic():
                for user, password in credentials:
                    user.set_password(password)
                    user.must_change_password = True
                    user.save(update_fields=('password', 'must_change_password'))
        except Exception:
            output.unlink(missing_ok=True)
            raise

        self.stdout.write(self.style.SUCCESS(
            f'Rotated {len(users)} user password(s). Securely distribute and then delete {output}.'
        ))
