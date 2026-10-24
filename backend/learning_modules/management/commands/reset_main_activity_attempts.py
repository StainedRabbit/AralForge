from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from learning_modules.models import ModuleActivity, ModuleActivityAttempt
from subjects.models import SchoolYearSemester


class Command(BaseCommand):
    help = 'Delete Main Activity attempts for the one active school-year semester.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Show the active semester and attempt count without deleting anything.',
        )
        parser.add_argument(
            '--yes',
            action='store_true',
            help='Confirm deletion of all Main Activity attempts in the active semester.',
        )

    def handle(self, *args, **options):
        semesters = list(
            SchoolYearSemester.objects.filter(
                is_active=True,
                school_year__is_active=True,
            ).select_related('school_year').order_by(
                '-school_year__start_year', 'semester', 'id',
            )[:2]
        )
        if not semesters:
            raise CommandError('No active semester was found in an active school year.')
        if len(semesters) > 1:
            choices = ', '.join(f'{semester.id}: {semester.name}' for semester in semesters)
            raise CommandError(
                'More than one active semester was found; refusing to guess: '
                f'{choices}.'
            )

        semester = semesters[0]
        attempts = ModuleActivityAttempt.objects.filter(
            activity__activity_type=ModuleActivity.ActivityType.INTERACTIVE,
            schedule__school_year_semester=semester,
        )
        attempt_count = attempts.count()
        self.stdout.write(f'Active semester: {semester.name} (ID {semester.id})')
        self.stdout.write(f'Main Activity attempts in scope: {attempt_count}')

        if options['dry_run']:
            self.stdout.write(self.style.WARNING('Dry run: no attempts were deleted.'))
            return
        if not attempt_count:
            self.stdout.write(self.style.SUCCESS('No Main Activity attempts to delete.'))
            return
        if not options['yes']:
            raise CommandError('No attempts were deleted. Rerun with --yes to confirm.')

        with transaction.atomic():
            deleted_attempts, _ = attempts.delete()

        self.stdout.write(self.style.SUCCESS(
            f'Deleted {attempt_count} Main Activity attempt(s) from {semester.name}. '
            f'{deleted_attempts - attempt_count} related record(s) were also deleted.'
        ))
