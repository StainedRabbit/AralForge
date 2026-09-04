from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError
from django.db import transaction

from .models import StudentProfile, User


username_validator = UnicodeUsernameValidator()
REPLACEMENT_CHARACTER = '\ufffd'


def validate_person_name(value):
    name = str(value or '')
    replacement_count = name.count(REPLACEMENT_CHARACTER)
    if replacement_count:
        suffix = '' if replacement_count == 1 else 's'
        raise ValidationError(
            f'Name contains {replacement_count} unknown replacement character{suffix} '
            f'({REPLACEMENT_CHARACTER}). Correct the name before saving.'
        )
    return name


def clean_student_number(value):
    student_number = str(value or '').strip()
    if not student_number:
        raise ValidationError('Student number is required.')

    maximum_length = StudentProfile._meta.get_field('student_number').max_length
    if len(student_number) > maximum_length:
        raise ValidationError(f'Student number must be {maximum_length} characters or fewer.')

    try:
        username_validator(student_number)
    except ValidationError as error:
        raise ValidationError(
            'Student number may contain only letters, numbers, and @/./+/-/_ characters.'
        ) from error
    return student_number


def validate_student_number_available(student_number, *, profile=None):
    profiles = StudentProfile.objects.filter(student_number__iexact=student_number)
    users = User.objects.filter(username__iexact=student_number)
    if profile is not None:
        profiles = profiles.exclude(pk=profile.pk)
        users = users.exclude(pk=profile.user_id)

    if profiles.exists():
        raise ValidationError('A student with this student number already exists.')
    if users.exists():
        raise ValidationError('This student number conflicts with an existing username.')


@transaction.atomic
def create_student_account(
    *,
    student_number,
    first_name='',
    last_name='',
    email='',
    is_active=True,
):
    student_number = clean_student_number(student_number)
    validate_student_number_available(student_number)
    first_name = validate_person_name(first_name)
    last_name = validate_person_name(last_name)

    user = User(
        username=student_number,
        first_name=first_name.strip(),
        last_name=last_name.strip(),
        email=str(email or '').strip(),
        role=User.Role.STUDENT,
        is_active=is_active,
        must_change_password=True,
    )
    user.set_password(student_number)
    user.save()
    return StudentProfile.objects.create(
        user=user,
        student_number=student_number,
        is_active=is_active,
    )


@transaction.atomic
def update_student_profile(instance, validated_data):
    profile = StudentProfile.objects.select_for_update().select_related('user').get(pk=instance.pk)
    next_student_number = clean_student_number(
        validated_data.get('student_number', profile.student_number)
    )
    validate_student_number_available(next_student_number, profile=profile)

    update_fields = []
    if next_student_number != profile.student_number:
        profile.student_number = next_student_number
        update_fields.append('student_number')

        profile.user.username = next_student_number
        user_update_fields = ['username']
        if profile.user.must_change_password:
            profile.user.set_password(next_student_number)
            user_update_fields.append('password')
        profile.user.save(update_fields=user_update_fields)

    if 'is_active' in validated_data and profile.is_active != validated_data['is_active']:
        profile.is_active = validated_data['is_active']
        update_fields.append('is_active')

    if update_fields:
        profile.save(update_fields=update_fields)
    return profile
