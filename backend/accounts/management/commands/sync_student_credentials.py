import uuid
from collections import defaultdict

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import StudentProfile, User
from accounts.services import clean_student_number


class Command(BaseCommand):
    help = 'Synchronize every student username and temporary password with the student number.'

    def add_arguments(self, parser):
        mode = parser.add_mutually_exclusive_group(required=True)
        mode.add_argument(
            '--dry-run',
            action='store_true',
            help='Validate the complete student set without changing credentials.',
        )
        mode.add_argument(
            '--confirm',
            action='store_true',
            help='Apply the credential reset after a successful dry run.',
        )

    def handle(self, *args, **options):
        if options['dry_run']:
            profiles = list(StudentProfile.objects.select_related('user').order_by('id'))
            users = list(User.objects.order_by('id'))
            records = inspect_profiles(profiles, users)
            self.stdout.write(self.style.SUCCESS(
                f'Dry run passed for {len(records)} student profile(s). No data was changed.'
            ))
            return

        with transaction.atomic():
            users = list(User.objects.select_for_update().order_by('id'))
            profiles = list(
                StudentProfile.objects.select_for_update().select_related('user').order_by('id')
            )
            records = inspect_profiles(profiles, users)

            for profile, _student_number in records:
                profile.user.username = temporary_username(profile.user_id)
                profile.user.save(update_fields=('username',))

            for profile, student_number in records:
                user = profile.user
                user.username = student_number
                user.set_password(student_number)
                user.must_change_password = True
                user.save(update_fields=('username', 'password', 'must_change_password'))

        self.stdout.write(self.style.SUCCESS(
            f'Synchronized {len(records)} student credential(s). First-login password setup is required.'
        ))


def inspect_profiles(profiles, users):
    errors = []
    records = []
    profiles_by_number = defaultdict(list)
    target_user_ids = {profile.user_id for profile in profiles}

    for profile in profiles:
        if (
            profile.user.role != User.Role.STUDENT
            or profile.user.is_staff
            or profile.user.is_superuser
        ):
            errors.append(
                f'Profile {profile.pk} belongs to a non-student account ({profile.user.username}).'
            )
            continue
        try:
            student_number = clean_student_number(profile.student_number)
        except ValidationError as error:
            errors.append(f'Profile {profile.pk}: {" ".join(error.messages)}')
            continue
        if profile.student_number != student_number:
            errors.append(
                f'Profile {profile.pk} has a non-canonical student number '
                f'{profile.student_number!r}; expected {student_number!r}.'
            )
            continue
        records.append((profile, student_number))
        profiles_by_number[student_number.casefold()].append(profile.pk)

    orphan_students = [
        user
        for user in users
        if (
            user.id not in target_user_ids
            and user.role == User.Role.STUDENT
            and not user.is_staff
            and not user.is_superuser
        )
    ]
    for user in orphan_students:
        errors.append(
            f'Student account {user.username!r} (user {user.pk}) has no student profile.'
        )

    for student_number, profile_ids in profiles_by_number.items():
        if len(profile_ids) > 1:
            errors.append(
                f'Case-insensitive duplicate student number {student_number!r} '
                f'on profiles {profile_ids}.'
            )

    target_numbers = set(profiles_by_number)
    conflicting_usernames = {
        user.username
        for user in users
        if user.pk not in target_user_ids and user.username.casefold() in target_numbers
    }
    for username in sorted(conflicting_usernames, key=str.casefold):
        errors.append(f'Student number conflicts with non-student username {username!r}.')

    if errors:
        raise CommandError('Credential synchronization was not applied:\n- ' + '\n- '.join(errors))
    return records


def temporary_username(user_id):
    while True:
        candidate = f'__student_sync__{uuid.uuid4().hex}_{user_id}'
        if not User.objects.filter(username=candidate).exists():
            return candidate
