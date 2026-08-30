from rest_framework import serializers
from django.utils import timezone

from subjects.models import ScheduleStudent, SubjectSchedule

from learning_modules.models import LearningContextType, ModuleAccess


def module_subject_ids(module):
    subject_ids = set(module.subjects.values_list('id', flat=True))
    if module.subject_id:
        subject_ids.add(module.subject_id)
    return subject_ids


def active_matching_enrollments(user, module):
    return ScheduleStudent.objects.filter(
        student=user,
        is_active=True,
        schedule__is_active=True,
        schedule__school_year_semester__is_active=True,
        schedule__subject_id__in=module_subject_ids(module),
    ).select_related(
        'schedule',
        'schedule__subject',
        'schedule__school_year_semester',
        'schedule__school_year_semester__school_year',
    )


def resolve_learning_context(user, module, *, schedule=None, context_type=None):
    if context_type == LearningContextType.LEGACY:
        raise serializers.ValidationError({
            'context_type': 'Legacy learning records are read-only.',
        })

    if schedule not in (None, ''):
        try:
            schedule_id = int(getattr(schedule, 'pk', schedule))
        except (TypeError, ValueError) as error:
            raise serializers.ValidationError({'schedule': 'Select a valid class.'}) from error
        selected = SubjectSchedule.objects.select_related(
            'subject',
            'school_year_semester',
            'school_year_semester__school_year',
        ).filter(pk=schedule_id).first()
        errors = {}
        if not selected:
            errors['schedule'] = 'This class does not exist.'
        elif selected.subject_id not in module_subject_ids(module):
            errors['schedule'] = 'This class does not belong to the module subject.'
        elif not selected.is_active or not selected.school_year_semester.is_active:
            errors['schedule'] = 'This class or term is inactive.'
        elif not ScheduleStudent.objects.filter(
            schedule=selected,
            student=user,
            is_active=True,
        ).exists():
            errors['schedule'] = 'You are not actively enrolled in this class.'
        if errors:
            raise serializers.ValidationError(errors)
        return LearningContextType.CLASS, selected

    if context_type != LearningContextType.PERSONAL:
        raise serializers.ValidationError({
            'schedule': 'Select a class before opening this learning record.',
        })

    if active_matching_enrollments(user, module).exists():
        raise serializers.ValidationError({
            'context_type': 'Select one of your active classes for this module.',
        })
    if not ModuleAccess.objects.filter(
        module=module,
        student=user,
        access_type=ModuleAccess.AccessType.ADVANCE_STUDY,
        is_active=True,
        activated_by__isnull=False,
        expires_at__gt=timezone.now(),
    ).exists():
        raise serializers.ValidationError({
            'context_type': 'Personal Study requires active Advance Study access.',
        })
    return LearningContextType.PERSONAL, None


def learning_context_query(context_type, schedule):
    schedule_id = getattr(schedule, 'pk', schedule)
    return {
        'context_type': context_type,
        'schedule_id': schedule_id if schedule_id else None,
    }


def request_learning_context(request, module):
    return resolve_learning_context(
        request.user,
        module,
        schedule=request.query_params.get('schedule'),
        context_type=request.query_params.get('context'),
    )
