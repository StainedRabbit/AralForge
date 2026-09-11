from django.conf import settings
from django.shortcuts import get_object_or_404

from accounts.models import User

from .models import SubjectSchedule


def managed_schedules_for(user, queryset=None):
    queryset = queryset if queryset is not None else SubjectSchedule.objects.all()
    if user.is_superuser or user.role == User.Role.ADMIN:
        return queryset
    if user.role == User.Role.TEACHER:
        if not settings.REAL_STUDENT_PRIVACY_ENFORCEMENT:
            return queryset
        return queryset.filter(instructors__instructor=user, instructors__is_active=True).distinct()
    return queryset.none()


def get_managed_schedule_or_404(user, pk, queryset=None):
    return get_object_or_404(managed_schedules_for(user, queryset), pk=pk)
