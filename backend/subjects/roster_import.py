import re
from dataclasses import dataclass

from django.contrib.auth.hashers import make_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models.functions import Lower
from django.utils import timezone

from accounts.models import StudentProfile, User
from accounts.services import REPLACEMENT_CHARACTER, clean_student_number

from .models import ScheduleStudent, SubjectSchedule


MAX_ROSTER_IMPORT_ROWS = 1000


@dataclass
class RosterValidation:
    preview: dict
    entries: list
    rows: list


class RosterImportValidationError(Exception):
    def __init__(self, preview):
        super().__init__('The roster changed while the import was being prepared.')
        self.preview = preview


def normalize_imported_person_name(value):
    cleaned = ' '.join(str(value or '').split())
    return re.sub(
        r"(^|[\s\-'\u2019])([^\W\d_])",
        lambda match: f'{match.group(1)}{match.group(2).upper()}',
        cleaned,
        flags=re.UNICODE,
    )


def validate_roster_rows(schedule, rows, *, lock=False):
    prepared = []
    lookup_keys = set()
    for index, raw_row in enumerate(rows, start=1):
        if not isinstance(raw_row, dict):
            prepared.append({'row': index, 'invalid': True})
            continue
        student_number = str(raw_row.get('student_number') or '').strip()
        prepared.append({
            'row': index,
            'student_number': student_number,
            'first_name': normalize_imported_person_name(raw_row.get('first_name')),
            'middle_name': normalize_imported_person_name(raw_row.get('middle_name')),
            'last_name': normalize_imported_person_name(raw_row.get('last_name')),
        })
        if student_number:
            lookup_keys.add(student_number.lower())

    profiles = StudentProfile.objects.select_related('user').annotate(
        import_key=Lower('student_number'),
    ).filter(import_key__in=lookup_keys)
    if lock:
        profiles = profiles.select_for_update()
    profiles_by_number = {profile.student_number.casefold(): profile for profile in profiles}

    profile_student_ids = [profile.user_id for profile in profiles_by_number.values()]
    enrollments = ScheduleStudent.objects.filter(schedule=schedule, student_id__in=profile_student_ids)
    if lock:
        enrollments = enrollments.select_for_update()
    enrollments_by_student = {enrollment.student_id: enrollment for enrollment in enrollments}

    missing_keys = {
        row.get('student_number', '').lower()
        for row in prepared
        if row.get('student_number')
        and row['student_number'].casefold() not in profiles_by_number
    }
    conflicting_users = User.objects.annotate(import_key=Lower('username')).filter(
        import_key__in=missing_keys,
    )
    if lock:
        conflicting_users = conflicting_users.select_for_update()
    conflicting_usernames = {user.username.casefold() for user in conflicting_users}

    seen = set()
    entries = []
    row_results = []
    has_errors = False
    summary = {
        'update_name_count': 0,
        'create_count': 0,
        'enroll_count': 0,
        'reactivate_count': 0,
        'already_active_count': 0,
    }

    for row in prepared:
        index = row['row']
        if row.get('invalid'):
            row_results.append({'row': index, 'status': 'error', 'error': 'Row must be an object.'})
            has_errors = True
            continue

        student_number = row['student_number']
        first_name = row['first_name']
        middle_name = row['middle_name']
        last_name = row['last_name']
        normalized = student_number.casefold()
        replacement_count = sum(
            name.count(REPLACEMENT_CHARACTER)
            for name in (first_name, middle_name, last_name)
        )
        if replacement_count:
            suffix = '' if replacement_count == 1 else 's'
            row_results.append({
                'row': index,
                'student_number': student_number,
                'status': 'error',
                'error': (
                    f'Name contains {replacement_count} unknown replacement character{suffix} '
                    f'({REPLACEMENT_CHARACTER}). Correct the name before importing.'
                ),
            })
            has_errors = True
            continue
        if not normalized:
            row_results.append({'row': index, 'status': 'error', 'error': 'Student number is required.'})
            has_errors = True
            continue
        if normalized in seen:
            row_results.append({
                'row': index,
                'student_number': student_number,
                'status': 'error',
                'error': 'Duplicate student number in this file.',
            })
            has_errors = True
            continue
        seen.add(normalized)

        try:
            clean_student_number(student_number)
        except DjangoValidationError as error:
            row_results.append({
                'row': index,
                'student_number': student_number,
                'status': 'error',
                'error': ' '.join(error.messages),
            })
            has_errors = True
            continue

        if any(len(name) > 150 for name in (first_name, middle_name, last_name)):
            row_results.append({
                'row': index,
                'student_number': student_number,
                'status': 'error',
                'error': 'First, middle, and last names must each be 150 characters or fewer.',
            })
            has_errors = True
            continue

        profile = profiles_by_number.get(normalized)
        if profile and (
            profile.user.role != User.Role.STUDENT
            or not profile.user.is_active
            or not profile.is_active
        ):
            row_results.append({
                'row': index,
                'student_number': student_number,
                'status': 'error',
                'error': 'This student account is disabled and must be reviewed in Student Management.',
            })
            has_errors = True
            continue

        if profile:
            enrollment = enrollments_by_student.get(profile.user_id)
            if enrollment and enrollment.is_active:
                row_status = 'already_enrolled'
                summary['already_active_count'] += 1
            elif enrollment:
                row_status = 'reactivate'
                summary['reactivate_count'] += 1
            else:
                row_status = 'enroll'
                summary['enroll_count'] += 1
            name_updates = {
                field: value
                for field, value in (
                    ('first_name', first_name), ('middle_name', middle_name), ('last_name', last_name)
                )
                if value and value != getattr(profile.user, field)
            }
            proposed_user = User(**{
                field: name_updates.get(field, getattr(profile.user, field))
                for field in ('first_name', 'middle_name', 'last_name')
            })
            summary['update_name_count'] += bool(name_updates)
            entries.append({
                'profile': profile, 'enrollment': enrollment, 'status': row_status,
                'name_updates': name_updates,
            })
            row_results.append({
                'row': index,
                'student_number': profile.student_number,
                'student_id': profile.user_id,
                'student_name': proposed_user.get_display_name(),
                'previous_full_name': profile.user.get_full_name(),
                'student_full_name': proposed_user.get_full_name(),
                'name_updated': bool(name_updates),
                'status': row_status,
            })
            continue

        if normalized in conflicting_usernames:
            row_results.append({
                'row': index,
                'student_number': student_number,
                'status': 'error',
                'error': 'This student number conflicts with an existing username.',
            })
            has_errors = True
            continue
        if not first_name or not last_name:
            row_results.append({
                'row': index,
                'student_number': student_number,
                'status': 'error',
                'error': 'First name and last name are required for a new student.',
            })
            has_errors = True
            continue

        entry = {
            'first_name': first_name,
            'middle_name': middle_name,
            'last_name': last_name,
            'student_number': student_number,
            'status': 'create',
        }
        entries.append(entry)
        summary['create_count'] += 1
        row_results.append({
            'row': index,
            'student_number': student_number,
            'student_name': User(first_name=first_name, middle_name=middle_name, last_name=last_name).get_display_name(),
            'status': 'create',
        })

    normalized_rows = [
        {
            'student_number': row.get('student_number', ''),
            'first_name': row.get('first_name', ''),
            'middle_name': row.get('middle_name', ''),
            'last_name': row.get('last_name', ''),
        }
        for row in prepared
        if not row.get('invalid')
    ]
    preview = {
        'valid': not has_errors,
        'row_count': len(rows),
        'ready_count': len(entries),
        'rows': row_results,
        **summary,
    }
    return RosterValidation(preview=preview, entries=entries, rows=normalized_rows)


def prepare_password_hashes(validation, progress=None):
    hashes = {}
    for index, entry in enumerate(validation.entries, start=1):
        if entry['status'] == 'create':
            student_number = entry['student_number']
            hashes[student_number.casefold()] = make_password(student_number)
        if progress:
            progress(index)
    return hashes


@transaction.atomic
def commit_roster_import(*, schedule_id, rows, actor_id, password_hashes, job):
    schedule = SubjectSchedule.objects.select_for_update().get(pk=schedule_id)
    actor = User.objects.get(pk=actor_id)
    validation = validate_roster_rows(schedule, rows, lock=True)
    if not validation.preview['valid']:
        raise RosterImportValidationError(validation.preview)

    created_users = []
    for entry in validation.entries:
        if entry['status'] != 'create':
            continue
        password = password_hashes.get(entry['student_number'].casefold())
        if not password:
            raise RosterImportValidationError({
                **validation.preview,
                'valid': False,
                'rows': [{
                    'row': 0,
                    'status': 'error',
                    'error': 'The roster changed while the import was being prepared. Preview it again.',
                }],
            })
        created_users.append(User(
            username=entry['student_number'],
            first_name=entry['first_name'],
            middle_name=entry['middle_name'],
            last_name=entry['last_name'],
            email='',
            role=User.Role.STUDENT,
            is_active=True,
            must_change_password=True,
            password=password,
        ))
    User.objects.bulk_create(created_users, batch_size=200)
    users_by_number = {user.username.casefold(): user for user in created_users}
    created_profiles = [
        StudentProfile(
            user=users_by_number[entry['student_number'].casefold()],
            student_number=entry['student_number'],
            is_active=True,
        )
        for entry in validation.entries
        if entry['status'] == 'create'
    ]
    StudentProfile.objects.bulk_create(created_profiles, batch_size=200)
    profiles_by_number = {profile.student_number.casefold(): profile for profile in created_profiles}

    updated_users = []
    for entry in validation.entries:
        if entry.get('name_updates'):
            user = entry['profile'].user
            for field, value in entry['name_updates'].items():
                setattr(user, field, value)
            updated_users.append(user)
    if updated_users:
        User.objects.bulk_update(updated_users, ('first_name', 'middle_name', 'last_name'), batch_size=200)

    now = timezone.now()
    new_enrollments = []
    reactivated = []
    affected_student_ids = []
    for entry in validation.entries:
        if entry['status'] == 'already_enrolled':
            continue
        if entry['status'] == 'reactivate':
            enrollment = entry['enrollment']
            enrollment.is_active = True
            enrollment.deactivated_at = None
            enrollment.deactivated_by = None
            enrollment.updated_at = now
            reactivated.append(enrollment)
            affected_student_ids.append(enrollment.student_id)
            continue
        profile = (
            profiles_by_number[entry['student_number'].casefold()]
            if entry['status'] == 'create'
            else entry['profile']
        )
        new_enrollments.append(ScheduleStudent(
            schedule=schedule,
            student=profile.user,
            added_by=actor,
            is_active=True,
            added_at=now,
            updated_at=now,
        ))
        affected_student_ids.append(profile.user_id)

    if reactivated:
        ScheduleStudent.objects.bulk_update(
            reactivated,
            ('is_active', 'deactivated_at', 'deactivated_by', 'updated_at'),
            batch_size=200,
        )
    ScheduleStudent.objects.bulk_create(new_enrollments, batch_size=200)

    if affected_student_ids:
        from grades.signals import initialize_enrollment_grades_bulk
        initialize_enrollment_grades_bulk(schedule, affected_student_ids)

    created_numbers = [profile.student_number for profile in created_profiles]
    result = {
        'schedule': schedule.id,
        'created_count': len(created_numbers),
        'created_student_numbers': created_numbers,
        'added_count': len(new_enrollments),
        'reactivated_count': len(reactivated),
        'already_active_count': validation.preview['already_active_count'],
        'update_name_count': validation.preview['update_name_count'],
    }
    job.status = job.Status.SUCCEEDED
    job.progress = len(rows)
    job.result = result
    job.error = ''
    job.finished_at = now
    job.payload = {'schedule_id': schedule.id}
    job.save(update_fields=('status', 'progress', 'result', 'error', 'finished_at', 'payload'))
    return result
