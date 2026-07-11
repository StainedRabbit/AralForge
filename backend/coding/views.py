from django.db.models import Q
from rest_framework import permissions, viewsets

from accounts.permissions import IsAdminTeacherOrReadOnly
from learning_modules.models import active_module_access_filter
from subjects.models import active_subject_access_filter

from .models import CodeBlank, CodeBlankAnswer, CodeSubmission, ProgrammingProblem, TestCase
from .serializers import (
    CodeBlankAnswerSerializer,
    CodeBlankSerializer,
    CodeSubmissionSerializer,
    ProgrammingProblemSerializer,
    TestCaseSerializer,
)


class ProgrammingProblemViewSet(viewsets.ModelViewSet):
    serializer_class = ProgrammingProblemSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = ProgrammingProblem.objects.select_related(
            'subject',
            'module',
            'topic',
            'lesson',
            'assessment_question',
        ).prefetch_related('test_cases', 'blanks')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(is_published=True).filter(
            problem_access_filter(self.request.user)
        ).distinct()


class TestCaseViewSet(viewsets.ModelViewSet):
    serializer_class = TestCaseSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = TestCase.objects.select_related('problem')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(problem__is_published=True, is_hidden=False).filter(
            problem_access_filter(self.request.user, prefix='problem__')
        ).distinct()


class CodeBlankViewSet(viewsets.ModelViewSet):
    serializer_class = CodeBlankSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = CodeBlank.objects.select_related('problem')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(problem__is_published=True).filter(
            problem_access_filter(self.request.user, prefix='problem__')
        ).distinct()


class CodeSubmissionViewSet(viewsets.ModelViewSet):
    serializer_class = CodeSubmissionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = CodeSubmission.objects.select_related('problem', 'student', 'assessment_attempt')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            student=self.request.user,
        ).filter(
            problem_access_filter(self.request.user, prefix='problem__'),
        ).distinct()

    def perform_create(self, serializer):
        student = serializer.validated_data.get('student', self.request.user)
        serializer.save(student=student)


class CodeBlankAnswerViewSet(viewsets.ModelViewSet):
    serializer_class = CodeBlankAnswerSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = CodeBlankAnswer.objects.select_related(
            'submission',
            'submission__student',
            'blank',
            'blank__problem',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            submission__student=self.request.user,
        ).filter(
            problem_access_filter(
                self.request.user,
                prefix='blank__problem__',
            ),
        ).distinct()


def problem_access_filter(user, prefix=''):
    unlinked_filter = (
        Q(**{f'{prefix}module__isnull': True})
        & Q(**{f'{prefix}topic__isnull': True})
        & Q(**{f'{prefix}lesson__isnull': True})
    )
    return (
        (
            unlinked_filter
            & Q(**{f'{prefix}subject__learning_module__isnull': True})
            & active_subject_access_filter(user, subject_prefix=f'{prefix}subject__')
        )
        | (
            unlinked_filter
            & Q(**{f'{prefix}subject__learning_module__is_published': True})
            & active_module_access_filter(
                user,
                prefix=f'{prefix}subject__learning_module__',
            )
        )
        | (
            Q(**{f'{prefix}module__is_published': True})
            & active_module_access_filter(user, prefix=f'{prefix}module__')
        )
        | (
            Q(**{f'{prefix}topic__is_published': True})
            & Q(**{f'{prefix}topic__module__is_published': True})
            & active_module_access_filter(user, prefix=f'{prefix}topic__module__')
        )
        | (
            Q(**{f'{prefix}lesson__is_published': True})
            & Q(**{f'{prefix}lesson__topic__is_published': True})
            & Q(**{f'{prefix}lesson__topic__module__is_published': True})
            & active_module_access_filter(user, prefix=f'{prefix}lesson__topic__module__')
        )
    )
