from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.db.models import Max, Q

from accounts.models import User
from learning_modules.models import (
    LearningContextType,
    ModuleActivity,
    ModuleActivityAttempt,
    ModuleActivityAttemptReset,
)
from subjects.models import ScheduleStudent, SchoolYearSemester, SubjectSchedule


ATTEMPT_LIMIT = 3


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
        schedules = list(
            SubjectSchedule.objects.filter(
                school_year_semester=semester,
                is_active=True,
            ).select_related('subject')
        )
        targets = set()
        activity_ids = set()
        for schedule in schedules:
            activities = ModuleActivity.objects.filter(
                activity_type=ModuleActivity.ActivityType.INTERACTIVE,
                is_published=True,
                module__is_published=True,
                lesson__isnull=False,
                lesson__is_published=True,
                lesson__topic__is_published=True,
            ).filter(
                Q(module__subject=schedule.subject)
                | Q(module__subjects=schedule.subject)
            ).distinct().values_list('id', flat=True)
            activity_ids.update(activities)
            student_ids = ScheduleStudent.objects.filter(
                schedule=schedule,
                is_active=True,
                student__role=User.Role.STUDENT,
            ).values_list('student_id', flat=True)
            targets.update(
                (activity_id, student_id, schedule.id)
                for activity_id in activities
                for student_id in student_ids
            )

        schedule_ids = {schedule.id for schedule in schedules}
        paper_contexts = set(
            ModuleActivityAttempt.objects.filter(
                activity_id__in=activity_ids,
                schedule_id__in=schedule_ids,
                context_type=LearningContextType.CLASS,
                submission_method=ModuleActivityAttempt.SubmissionMethod.PAPER,
                status=ModuleActivityAttempt.Status.SUBMITTED,
            ).values_list('activity_id', 'student_id', 'schedule_id')
        )
        previously_reset = set(
            ModuleActivityAttemptReset.objects.filter(
                activity_id__in=activity_ids,
                schedule_id__in=schedule_ids,
            ).values_list('activity_id', 'student_id', 'schedule_id')
        )
        eligible_targets = sorted(targets - paper_contexts - previously_reset)
        skipped_paper_count = len(targets.intersection(paper_contexts))
        already_reset_count = len(targets.intersection(previously_reset))

        self.stdout.write(f'Active semester: {semester.name} (ID {semester.id})')
        self.stdout.write(f'Eligible student, quiz, and class contexts: {len(eligible_targets)}')
        self.stdout.write(f'Paper-final contexts excluded: {skipped_paper_count}')
        self.stdout.write(f'Already-reset contexts skipped: {already_reset_count}')
        self.stdout.write('Existing attempts, scores, and submission statuses will be preserved.')
        if options['dry_run']:
            self.stdout.write(self.style.WARNING('Dry run: no reset records were created.'))
            return
        if not eligible_targets:
            self.stdout.write(self.style.SUCCESS('No eligible quiz contexts to reset.'))
            return

        with transaction.atomic():
            cutoffs = {
                (row['activity_id'], row['student_id'], row['schedule_id']): row['cutoff'] or 0
                for row in ModuleActivityAttempt.objects.filter(
                    context_type=LearningContextType.CLASS,
                    activity_id__in=activity_ids,
                    schedule_id__in=schedule_ids,
                ).values(
                    'activity_id', 'student_id', 'schedule_id',
                ).annotate(cutoff=Max('id'))
            }
            resets = [
                ModuleActivityAttemptReset(
                    activity_id=activity_id,
                    student_id=student_id,
                    schedule_id=schedule_id,
                    attempt_id_cutoff=cutoffs.get(
                        (activity_id, student_id, schedule_id),
                        0,
                    ),
                    attempt_limit=ATTEMPT_LIMIT,
                )
                for activity_id, student_id, schedule_id in eligible_targets
            ]
            ModuleActivityAttemptReset.objects.bulk_create(resets)

        self.stdout.write(self.style.SUCCESS(
            f'Granted {ATTEMPT_LIMIT} fresh attempts in {len(resets)} student quiz contexts. '
            'Existing attempt records were not changed.'
        ))
