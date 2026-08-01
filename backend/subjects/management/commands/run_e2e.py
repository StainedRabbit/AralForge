from django.conf import settings
from django.core.management import BaseCommand, call_command
from django.core.management.base import CommandError


class Command(BaseCommand):
    help = 'Prepare the isolated Playwright database and run its API server.'

    def handle(self, *args, **options):
        if not getattr(settings, 'E2E_TESTING', False):
            raise CommandError('run_e2e is restricted to config.settings_e2e.')

        call_command('migrate', interactive=False, verbosity=1)
        call_command('seed_e2e', verbosity=1)
        call_command(
            'runserver',
            '127.0.0.1:8001',
            use_reloader=False,
            verbosity=1,
        )
