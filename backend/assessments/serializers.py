from django.utils import timezone
from django.core.exceptions import ObjectDoesNotExist
from rest_framework import serializers

from learning_modules.models import user_has_module_access
from subjects.models import user_has_active_subject_access

from .models import (
    Answer,
    Assessment,
    AssessmentAttempt,
    AssessmentAttemptQuestion,
    Choice,
    Question,
)


class ChoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Choice
        fields = ('id', 'question', 'text', 'is_correct', 'order')
        read_only_fields = ('id',)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')

        if not request or not request.user.is_admin_teacher:
            data.pop('is_correct', None)

        return data


class QuestionSerializer(serializers.ModelSerializer):
    choices = ChoiceSerializer(many=True, read_only=True)

    class Meta:
        model = Question
        fields = (
            'id',
            'assessment',
            'question_type',
            'prompt',
            'points',
            'order',
            'explanation',
            'topics',
            'module_topics',
            'choices',
        )
        read_only_fields = ('id',)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')

        if not request or not request.user.is_admin_teacher:
            data.pop('explanation', None)

        return data


class AssessmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Assessment
        fields = (
            'id',
            'title',
            'kind',
            'subject',
            'module',
            'instructions',
            'points_possible',
            'mock_question_count',
            'time_limit_minutes',
            'max_attempts',
            'randomize_questions',
            'show_answers_after_submit',
            'counts_toward_grade',
            'is_published',
            'opens_at',
            'closes_at',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at')

    def validate(self, attrs):
        if (
            attrs.get('kind') in {Assessment.Kind.MOCK_EXAM, Assessment.Kind.MOCK_QUIZ}
            and 'counts_toward_grade' not in self.initial_data
        ):
            attrs['counts_toward_grade'] = False

        return attrs


class AssessmentAttemptSerializer(serializers.ModelSerializer):
    selected_question_ids = serializers.SerializerMethodField()

    class Meta:
        model = AssessmentAttempt
        fields = (
            'id',
            'assessment',
            'student',
            'attempt_number',
            'score',
            'started_at',
            'submitted_at',
            'is_submitted',
            'selected_topics',
            'selected_module_topics',
            'selected_question_ids',
        )
        read_only_fields = ('id', 'started_at', 'selected_question_ids')

    def get_selected_question_ids(self, obj):
        selected = getattr(obj, 'selected_questions', None)

        if selected is None:
            return []

        return [
            item.question_id
            for item in selected.all().order_by('order', 'id')
        ]

    def validate_student(self, value):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and value != request.user:
            raise serializers.ValidationError('Students can only start attempts for themselves.')

        return value

    def validate(self, attrs):
        request = self.context.get('request')
        assessment = attrs.get('assessment') or getattr(self.instance, 'assessment', None)

        if request and not request.user.is_admin_teacher:
            restricted_fields = {'score', 'submitted_at'}
            submitted_restricted_fields = restricted_fields.intersection(self.initial_data)

            if submitted_restricted_fields:
                raise serializers.ValidationError(
                    'Students cannot set grading fields.'
                )

            if self.instance and self.instance.is_submitted and attrs.get('is_submitted') is False:
                raise serializers.ValidationError(
                    'Submitted attempts cannot be reopened by students.'
                )

            if (
                not self.instance
                and assessment
                and assessment.kind in {
                    Assessment.Kind.MOCK_EXAM,
                    Assessment.Kind.MOCK_QUIZ,
                }
            ):
                raise serializers.ValidationError(
                    'Start mock assessments by selecting topics first.'
                )

            if assessment and assessment.module and not user_has_module_access(
                request.user,
                assessment.module,
            ):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
                )

            if (
                assessment
                and not assessment.module
                and not user_has_subject_content_access(
                    request.user,
                    assessment.subject,
                )
            ):
                raise serializers.ValidationError(
                    'This assessment is not available for your active classes.'
                )

        return attrs

    def update(self, instance, validated_data):
        is_submitted = validated_data.get('is_submitted')

        if is_submitted and not instance.submitted_at:
            validated_data['submitted_at'] = timezone.now()

        updated = super().update(instance, validated_data)

        if is_submitted:
            updated.score_multiple_choice_answers()

        return updated


class AssessmentAttemptQuestionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssessmentAttemptQuestion
        fields = ('id', 'attempt', 'question', 'order')
        read_only_fields = ('id',)


class AnswerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Answer
        fields = (
            'id',
            'attempt',
            'question',
            'selected_choice',
            'text_answer',
            'code_answer',
            'is_correct',
            'points_earned',
            'feedback',
        )
        read_only_fields = ('id',)

    def validate(self, attrs):
        request = self.context.get('request')
        attempt = attrs.get('attempt') or getattr(self.instance, 'attempt', None)
        question = attrs.get('question') or getattr(self.instance, 'question', None)
        selected_choice = attrs.get('selected_choice') or getattr(
            self.instance,
            'selected_choice',
            None,
        )

        if attempt and question and attempt.assessment_id != question.assessment_id:
            raise serializers.ValidationError(
                'Answer must belong to a question in the same assessment attempt.'
            )

        if (
            attempt
            and question
            and attempt.assessment.kind in {
                Assessment.Kind.MOCK_EXAM,
                Assessment.Kind.MOCK_QUIZ,
            }
            and not attempt.selected_questions.filter(question=question).exists()
        ):
            raise serializers.ValidationError(
                'Answer must belong to a question selected for this mock attempt.'
            )

        if selected_choice and question and selected_choice.question_id != question.id:
            raise serializers.ValidationError(
                'Selected choice must belong to the answered question.'
            )

        if request and not request.user.is_admin_teacher:
            if attempt and attempt.student_id != request.user.id:
                raise serializers.ValidationError(
                    'Students can only answer their own attempts.'
                )

            if (
                attempt
                and attempt.assessment.module
                and not user_has_module_access(request.user, attempt.assessment.module)
            ):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
                )

            if (
                attempt
                and not attempt.assessment.module
                and not user_has_subject_content_access(
                    request.user,
                    attempt.assessment.subject,
                )
            ):
                raise serializers.ValidationError(
                    'This assessment is not available for your active classes.'
                )

            if attempt and attempt.is_submitted:
                raise serializers.ValidationError(
                    'Submitted attempts cannot be edited.'
                )

            restricted_fields = {'is_correct', 'points_earned', 'feedback'}
            submitted_restricted_fields = restricted_fields.intersection(self.initial_data)

            if submitted_restricted_fields:
                raise serializers.ValidationError(
                    'Students cannot set grading fields.'
                )

        return attrs


def user_has_subject_content_access(user, subject):
    if not subject:
        return True
    try:
        module = subject.learning_module
    except ObjectDoesNotExist:
        module = None
    return (
        user_has_module_access(user, module)
        if module
        else user_has_active_subject_access(user, subject)
    )
