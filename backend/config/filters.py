from django.db.models import Q
from rest_framework.filters import BaseFilterBackend


class EzoryxQueryFilterBackend(BaseFilterBackend):
    """Apply the common bounded-list filters only when the model supports them."""

    exact_parameters = {
        'module': 'module_id',
        'topic': 'topic_id',
        'lesson': 'lesson_id',
        'activity': 'activity_id',
        'assessment': 'assessment_id',
        'attempt': 'attempt_id',
        'student': 'student_id',
        'schedule': 'schedule_id',
        'subject': 'subject_id',
        'term': 'school_year_semester_id',
        'period': 'grading_period',
        'date': 'date',
    }

    def filter_queryset(self, request, queryset, view):
        field_names = {field.name for field in queryset.model._meta.get_fields()}
        for parameter, lookup in self.exact_parameters.items():
            value = request.query_params.get(parameter)
            root = lookup.removesuffix('_id')
            if value not in (None, '') and root in field_names:
                queryset = queryset.filter(**{lookup: value})

        status = request.query_params.get('status', '').strip()
        if status and 'status' in field_names:
            queryset = queryset.filter(status=status.upper())
        elif status.lower() in {'active', 'inactive', 'archived'} and 'is_active' in field_names:
            queryset = queryset.filter(is_active=status.lower() == 'active')

        search = request.query_params.get('search', '').strip()
        searchable = getattr(view, 'search_fields', ())
        if search and searchable:
            query = Q()
            for field in searchable:
                query |= Q(**{f'{field}__icontains': search})
            queryset = queryset.filter(query)
        return queryset
