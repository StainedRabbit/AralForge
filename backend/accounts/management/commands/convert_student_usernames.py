import re

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import StudentProfile, User


LEGACY_USERNAME_PATTERN = re.compile(r'^student-(\d+)$')


class Command(BaseCommand):
    help = 'Convert legacy student-{digits} usernames to the bare student number.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply',
            action='store_true',
            help='Save the conversion. Without this option, the command is a dry run.',
        )

    def handle(self, *args, **options):
        applying = options['apply']

        with transaction.atomic():
            users = list(User.objects.select_for_update().order_by('id'))
            candidates = []
            usernames = {}
            for user in users:
                usernames.setdefault(user.username.casefold(), []).append(user)
                match = LEGACY_USERNAME_PATTERN.fullmatch(user.username)
                if match:
                    candidates.append((user, match.group(1)))

            profiles = {
                profile.user_id: profile
                for profile in StudentProfile.objects.select_for_update().filter(
                    user_id__in=[user.id for user, _target in candidates]
                )
            }
            convertible = []
            skipped = []
            conflicts = []

            for user, target_username in candidates:
                if user.role != User.Role.STUDENT or user.is_staff or user.is_superuser:
                    skipped.append(
                        f'{user.username!r}: account is staff/admin or role is {user.role}.'
                    )
                    continue

                profile = profiles.get(user.id)
                if profile is None:
                    skipped.append(f'{user.username!r}: no student profile is linked.')
                    continue
                if profile.student_number != target_username:
                    conflicts.append(
                        f'{user.username!r}: linked profile uses student number '
                        f'{profile.student_number!r}, not {target_username!r}.'
                    )
                    continue

                colliding_users = [
                    existing
                    for existing in usernames.get(target_username.casefold(), [])
                    if existing.id != user.id
                ]
                if colliding_users:
                    collisions = ', '.join(
                        f'{existing.username!r} (user {existing.id})'
                        for existing in colliding_users
                    )
                    conflicts.append(
                        f'{user.username!r}: target {target_username!r} collides with {collisions}.'
                    )
                    continue

                convertible.append((user, target_username))

            for detail in skipped:
                self.stdout.write(self.style.WARNING(f'Skipped {detail}'))
            for detail in conflicts:
                self.stdout.write(self.style.ERROR(f'Conflict {detail}'))

            if conflicts:
                self._write_summary(
                    found=len(candidates),
                    changed=0,
                    would_change=len(convertible),
                    skipped=len(skipped),
                    conflicted=len(conflicts),
                    applying=applying,
                )
                raise CommandError(
                    'Student username conversion aborted. No accounts were changed.'
                )

            if applying:
                for user, target_username in convertible:
                    user.username = target_username
                    user.save(update_fields=('username',))
                changed = len(convertible)
                would_change = 0
            else:
                changed = 0
                would_change = len(convertible)

            self._write_summary(
                found=len(candidates),
                changed=changed,
                would_change=would_change,
                skipped=len(skipped),
                conflicted=0,
                applying=applying,
            )

    def _write_summary(
        self,
        *,
        found,
        changed,
        would_change,
        skipped,
        conflicted,
        applying,
    ):
        mode = 'Apply complete' if applying else 'Dry run complete'
        message = (
            f'{mode}: found={found}, changed={changed}, would_change={would_change}, '
            f'skipped={skipped}, conflicted={conflicted}.'
        )
        if applying:
            self.stdout.write(self.style.SUCCESS(message))
        else:
            self.stdout.write(message + ' No data was changed.')
