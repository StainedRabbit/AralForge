from rest_framework import permissions, viewsets

from accounts.permissions import IsAdminTeacherOrReadOnly

from .models import Answer, Assessment, AssessmentAttempt, Choice, Question
from .serializers import (
    AnswerSerializer,
    AssessmentAttemptSerializer,
    AssessmentSerializer,
    ChoiceSerializer,
    QuestionSerializer,
)


class AssessmentViewSet(viewsets.ModelViewSet):
    serializer_class = AssessmentSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = Assessment.objects.select_related('subject', 'module')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(is_published=True)


class QuestionViewSet(viewsets.ModelViewSet):
    serializer_class = QuestionSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = Question.objects.select_related('assessment').prefetch_related('choices')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(assessment__is_published=True)


class ChoiceViewSet(viewsets.ModelViewSet):
    serializer_class = ChoiceSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = Choice.objects.select_related('question', 'question__assessment')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(question__assessment__is_published=True)


class AssessmentAttemptViewSet(viewsets.ModelViewSet):
    serializer_class = AssessmentAttemptSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = AssessmentAttempt.objects.select_related('assessment', 'student')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)

    def perform_create(self, serializer):
        student = serializer.validated_data.get('student', self.request.user)
        serializer.save(student=student)


class AnswerViewSet(viewsets.ModelViewSet):
    serializer_class = AnswerSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = Answer.objects.select_related('attempt', 'attempt__student', 'question')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(attempt__student=self.request.user)
