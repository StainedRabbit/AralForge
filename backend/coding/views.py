from rest_framework import permissions, viewsets

from accounts.permissions import IsAdminTeacherOrReadOnly

from .models import CodeSubmission, ProgrammingProblem, TestCase
from .serializers import CodeSubmissionSerializer, ProgrammingProblemSerializer, TestCaseSerializer


class ProgrammingProblemViewSet(viewsets.ModelViewSet):
    serializer_class = ProgrammingProblemSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = ProgrammingProblem.objects.select_related(
            'subject',
            'module',
            'assessment_question',
        ).prefetch_related('test_cases')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(is_published=True)


class TestCaseViewSet(viewsets.ModelViewSet):
    serializer_class = TestCaseSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = TestCase.objects.select_related('problem')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(problem__is_published=True, is_hidden=False)


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
