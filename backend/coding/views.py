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
            'assessment_question',
        ).prefetch_related('test_cases', 'blanks')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(is_published=True).filter(
            (
                Q(module__isnull=True)
                & active_subject_access_filter(self.request.user, subject_prefix='subject__')
            )
            | (
                Q(module__is_published=True)
                & active_module_access_filter(self.request.user, prefix='module__')
            )
        ).distinct()


class TestCaseViewSet(viewsets.ModelViewSet):
    serializer_class = TestCaseSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = TestCase.objects.select_related('problem')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(problem__is_published=True, is_hidden=False).filter(
            (
                Q(problem__module__isnull=True)
                & active_subject_access_filter(
                    self.request.user,
                    subject_prefix='problem__subject__',
                )
            )
            | (
                Q(problem__module__is_published=True)
                & active_module_access_filter(
                    self.request.user,
                    prefix='problem__module__',
                )
            )
        ).distinct()


class CodeBlankViewSet(viewsets.ModelViewSet):
    serializer_class = CodeBlankSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = CodeBlank.objects.select_related('problem')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(problem__is_published=True).filter(
            (
                Q(problem__module__isnull=True)
                & active_subject_access_filter(
                    self.request.user,
                    subject_prefix='problem__subject__',
                )
            )
            | (
                Q(problem__module__is_published=True)
                & active_module_access_filter(
                    self.request.user,
                    prefix='problem__module__',
                )
            )
        ).distinct()


class CodeSubmissionViewSet(viewsets.ModelViewSet):
    serializer_class = CodeSubmissionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = CodeSubmission.objects.select_related('problem', 'student', 'assessment_attempt')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)

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

        return queryset.filter(submission__student=self.request.user)
