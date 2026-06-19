import random

from django.db import transaction
from django.db.models import Q
from rest_framework import permissions, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsAdminTeacherOrReadOnly
from learning_modules.models import Module, active_module_access_filter, user_has_module_access
from subjects.models import active_subject_access_filter

from .models import (
    Answer,
    Assessment,
    AssessmentAttempt,
    AssessmentAttemptQuestion,
    Choice,
    Question,
)
from .serializers import (
    AnswerSerializer,
    AssessmentAttemptSerializer,
    AssessmentAttemptQuestionSerializer,
    AssessmentSerializer,
    ChoiceSerializer,
    QuestionSerializer,
)


class AssessmentViewSet(viewsets.ModelViewSet):
    serializer_class = AssessmentSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_permissions(self):
        if self.action == 'start_mock':
            return [permissions.IsAuthenticated()]

        return super().get_permissions()

    def get_queryset(self):
        queryset = Assessment.objects.select_related('subject', 'module')

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

    @action(detail=True, methods=['post'], url_path='start-mock')
    def start_mock(self, request, pk=None):
        assessment = self.get_object()

        if assessment.kind not in {Assessment.Kind.MOCK_EXAM, Assessment.Kind.MOCK_QUIZ}:
            return Response(
                {'detail': 'Only mock assessments can be started with selected topics.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        selected_topic_ids = request.data.get('selected_topics') or request.data.get('topics') or []

        if not isinstance(selected_topic_ids, list) or not selected_topic_ids:
            return Response(
                {'detail': 'Select at least one topic before starting the mock exam.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        topics = list(
            Module.objects.filter(id__in=selected_topic_ids, is_published=True).distinct()
        )

        if len(topics) != len(set(selected_topic_ids)):
            return Response(
                {'detail': 'One or more selected topics are not available.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not request.user.is_admin_teacher:
            unavailable_topics = [
                topic for topic in topics if not user_has_module_access(request.user, topic)
            ]

            if unavailable_topics:
                return Response(
                    {'detail': 'One or more selected topics are not available.'},
                    status=status.HTTP_403_FORBIDDEN,
                )

        existing_attempt_count = AssessmentAttempt.objects.filter(
            assessment=assessment,
            student=request.user,
        ).count()

        if existing_attempt_count >= assessment.max_attempts:
            return Response(
                {'detail': 'You have reached the maximum number of attempts.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        question_ids = list(
            assessment.questions.filter(
                question_type=Question.QuestionType.MULTIPLE_CHOICE,
                topics__in=topics,
            ).distinct().values_list('id', flat=True)
        )

        if not question_ids:
            return Response(
                {'detail': 'No multiple-choice questions are available for the selected topics.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        random.shuffle(question_ids)
        selected_question_ids = question_ids[:assessment.mock_question_count]

        with transaction.atomic():
            attempt = AssessmentAttempt.objects.create(
                assessment=assessment,
                student=request.user,
                attempt_number=existing_attempt_count + 1,
            )
            attempt.selected_topics.set(topics)
            AssessmentAttemptQuestion.objects.bulk_create(
                AssessmentAttemptQuestion(
                    attempt=attempt,
                    question_id=question_id,
                    order=index,
                )
                for index, question_id in enumerate(selected_question_ids)
            )

        serializer = AssessmentAttemptSerializer(attempt, context={'request': request})
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class QuestionViewSet(viewsets.ModelViewSet):
    serializer_class = QuestionSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = Question.objects.select_related('assessment').prefetch_related('choices')

        if self.request.user.is_admin_teacher:
            return queryset

        access_filter = (
            (
                Q(assessment__module__isnull=True)
                & active_subject_access_filter(
                    self.request.user,
                    subject_prefix='assessment__subject__',
                )
            )
            | (
                Q(assessment__module__is_published=True)
                & active_module_access_filter(
                    self.request.user,
                    prefix='assessment__module__',
                )
            )
        )

        return queryset.filter(assessment__is_published=True).filter(
            access_filter,
        ).filter(
            Q(assessment__kind__in=[
                Assessment.Kind.QUIZ,
                Assessment.Kind.EXAM,
                Assessment.Kind.ACTIVITY,
                Assessment.Kind.PRACTICE,
            ])
            | Q(mock_attempts__attempt__student=self.request.user)
        ).distinct()


class ChoiceViewSet(viewsets.ModelViewSet):
    serializer_class = ChoiceSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = Choice.objects.select_related('question', 'question__assessment')

        if self.request.user.is_admin_teacher:
            return queryset

        access_filter = (
            (
                Q(question__assessment__module__isnull=True)
                & active_subject_access_filter(
                    self.request.user,
                    subject_prefix='question__assessment__subject__',
                )
            )
            | (
                Q(question__assessment__module__is_published=True)
                & active_module_access_filter(
                    self.request.user,
                    prefix='question__assessment__module__',
                )
            )
        )

        return queryset.filter(question__assessment__is_published=True).filter(
            access_filter,
        ).filter(
            Q(question__assessment__kind__in=[
                Assessment.Kind.QUIZ,
                Assessment.Kind.EXAM,
                Assessment.Kind.ACTIVITY,
                Assessment.Kind.PRACTICE,
            ])
            | Q(question__mock_attempts__attempt__student=self.request.user)
        ).distinct()


class AssessmentAttemptViewSet(viewsets.ModelViewSet):
    serializer_class = AssessmentAttemptSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = AssessmentAttempt.objects.select_related(
            'assessment',
            'student',
        ).prefetch_related(
            'selected_topics',
            'selected_questions',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user).filter(
            (
                Q(assessment__module__isnull=True)
                & active_subject_access_filter(
                    self.request.user,
                    subject_prefix='assessment__subject__',
                )
            )
            | (
                Q(assessment__module__is_published=True)
                & active_module_access_filter(
                    self.request.user,
                    prefix='assessment__module__',
                )
            )
        ).distinct()

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

        return queryset.filter(attempt__student=self.request.user).filter(
            (
                Q(attempt__assessment__module__isnull=True)
                & active_subject_access_filter(
                    self.request.user,
                    subject_prefix='attempt__assessment__subject__',
                )
            )
            | (
                Q(attempt__assessment__module__is_published=True)
                & active_module_access_filter(
                    self.request.user,
                    prefix='attempt__assessment__module__',
                )
            )
        ).distinct()


class AssessmentAttemptQuestionViewSet(viewsets.ModelViewSet):
    serializer_class = AssessmentAttemptQuestionSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = AssessmentAttemptQuestion.objects.select_related(
            'attempt',
            'attempt__student',
            'question',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(attempt__student=self.request.user)
