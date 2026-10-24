from django.core.management.base import BaseCommand, CommandError

from learning_modules.services.attempt_resets import (
    active_semester_attempt_reset_scope,
    attempt_reset_preview,
    grant_active_semester_attempt_resets,
)


class Command(BaseCommand):
    help = (
        'Grant three fresh online Main Activity attempts to currently enrolled '
        'students in the one active school-year semester, preserving attempt history.'
    )

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group(required=True)
        mode.add_argument(
            '--dry-run',
            action='store_true',
            help='Preview eligible student, quiz, and class contexts without writing.',
        )
        mode.add_argument(
            '--yes',
            action='store_true',
            help='Create fresh three-attempt windows for every eligible context.',
        )

    def handle(self, *args, **options):
        try:
            if options['dry_run']:
                summary = attempt_reset_preview(active_semester_attempt_reset_scope())
            else:
                summary = grant_active_semester_attempt_resets()
        except ValueError as error:
            raise CommandError(str(error)) from error

        semester = summary['semester']
        self.stdout.write(f"Active semester: {semester['name']} (ID {semester['id']})")
        self.stdout.write(
            'Eligible student, quiz, and class contexts: '
            f"{summary.get('eligible_context_count', 0)}"
        )
        self.stdout.write(
            'Paper-final contexts excluded: '
            f"{summary.get('paper_excluded_context_count', 0)}"
        )
        self.stdout.write(
            'Already-reset contexts skipped: '
            f"{summary.get('already_reset_context_count', 0)}"
        )
        self.stdout.write('Existing attempts, scores, and submission statuses will be preserved.')
        if options['dry_run']:
            self.stdout.write(self.style.WARNING('Dry run: no reset records were created.'))
            return
        if summary['granted_context_count'] == 0:
            self.stdout.write(self.style.SUCCESS('No eligible quiz contexts to reset.'))
            return
        self.stdout.write(self.style.SUCCESS(
            f"Granted {summary['attempt_limit']} fresh attempts in "
            f"{summary['granted_context_count']} student quiz contexts. "
            'Existing attempt records were not changed.'
        ))
