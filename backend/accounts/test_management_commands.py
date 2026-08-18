import csv
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.contrib.auth import authenticate, get_user_model
from django.core.management import call_command
from django.test import TestCase


class PrepareMigratedUsersCommandTests(TestCase):
    def test_rotates_passwords_and_requires_first_login_change(self):
        user_model = get_user_model()
        user = user_model.objects.create_user(
            username='migrated-user',
            password='old-password-123',
            role=user_model.Role.STUDENT,
        )

        with TemporaryDirectory() as output_dir:
            output = Path(output_dir) / 'temporary-credentials.csv'
            call_command(
                'prepare_migrated_users',
                output=str(output),
                confirm=True,
                stdout=StringIO(),
            )
            with output.open(encoding='utf-8') as output_file:
                rows = list(csv.DictReader(output_file))

        user.refresh_from_db()
        self.assertTrue(user.must_change_password)
        self.assertIsNone(authenticate(username=user.username, password='old-password-123'))
        self.assertIsNotNone(
            authenticate(username=user.username, password=rows[0]['temporary_password'])
        )
