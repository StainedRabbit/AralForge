from rest_framework import serializers
from django.core.exceptions import ObjectDoesNotExist

from learning_modules.models import user_has_module_access
from subjects.models import user_has_active_subject_access

from .models import CodeBlank, CodeBlankAnswer, CodeSubmission, ProgrammingProblem, TestCase


class TestCaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = TestCase
        fields = ('id', 'problem', 'input_data', 'expected_output', 'is_hidden', 'order')
        read_only_fields = ('id',)


class CodeBlankSerializer(serializers.ModelSerializer):
    class Meta:
        model = CodeBlank
        fields = (
            'id',
            'problem',
            'key',
            'prompt',
            'expected_answer',
            'hint',
            'order',
            'points',
        )
        read_only_fields = ('id',)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')

        if not request or not request.user.is_admin_teacher:
            data.pop('expected_answer', None)

        return data


class ProgrammingProblemSerializer(serializers.ModelSerializer):
    test_cases = TestCaseSerializer(many=True, read_only=True)
    blanks = CodeBlankSerializer(many=True, read_only=True)

    class Meta:
        model = ProgrammingProblem
        fields = (
            'id',
            'title',
            'slug',
            'description',
            'starter_code',
            'expected_language',
            'difficulty',
            'subject',
            'module',
            'topic',
            'lesson',
            'assessment_question',
            'points_possible',
            'is_published',
            'created_at',
            'test_cases',
            'blanks',
        )
        read_only_fields = ('id', 'created_at')

    def validate(self, attrs):
        module = attrs.get('module') or getattr(self.instance, 'module', None)
        topic = attrs.get('topic') or getattr(self.instance, 'topic', None)
        lesson = attrs.get('lesson') or getattr(self.instance, 'lesson', None)

        if lesson:
            if topic and lesson.topic_id != topic.id:
                raise serializers.ValidationError(
                    'The selected lesson must belong to the selected topic.'
                )

            topic = lesson.topic
            attrs['topic'] = topic

        if topic:
            if module and topic.module_id != module.id:
                raise serializers.ValidationError(
                    'The selected topic must belong to the selected module.'
                )

            attrs['module'] = topic.module

        return attrs

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        if not request or not request.user.is_admin_teacher:
            data['test_cases'] = [
                test_case for test_case in data.get('test_cases', [])
                if not test_case.get('is_hidden')
            ]
        return data


class CodeBlankAnswerSerializer(serializers.ModelSerializer):
    class Meta:
        model = CodeBlankAnswer
        fields = (
            'id',
            'submission',
            'blank',
            'answer',
            'is_correct',
            'points_earned',
            'feedback',
        )
        read_only_fields = ('id',)

    def validate(self, attrs):
        request = self.context.get('request')
        submission = attrs.get('submission') or getattr(self.instance, 'submission', None)
        blank = attrs.get('blank') or getattr(self.instance, 'blank', None)

        if submission and blank and submission.problem_id != blank.problem_id:
            raise serializers.ValidationError(
                'Blank answer must belong to the same problem as the submission.'
            )

        if request and not request.user.is_admin_teacher:
            if submission and submission.student_id != request.user.id:
                raise serializers.ValidationError(
                    'Students can only answer blanks for their own submissions.'
                )

            restricted_fields = {'is_correct', 'points_earned', 'feedback'}
            submitted_restricted_fields = restricted_fields.intersection(self.initial_data)

            if submitted_restricted_fields:
                raise serializers.ValidationError(
                    'Students cannot set grading fields.'
                )

        return attrs


class CodeSubmissionSerializer(serializers.ModelSerializer):
    blank_answers = CodeBlankAnswerSerializer(many=True, read_only=True)

    class Meta:
        model = CodeSubmission
        fields = (
            'id',
            'problem',
            'student',
            'assessment_attempt',
            'language',
            'source_code',
            'status',
            'score',
            'output',
            'error',
            'submitted_at',
            'blank_answers',
        )
        read_only_fields = ('id', 'submitted_at')

    def validate_student(self, value):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and value != request.user:
            raise serializers.ValidationError('Students can only submit as themselves.')

        return value

    def validate(self, attrs):
        request = self.context.get('request')
        problem = attrs.get('problem') or getattr(self.instance, 'problem', None)

        if request and not request.user.is_admin_teacher:
            restricted_fields = {'status', 'score', 'output', 'error'}
            submitted_restricted_fields = restricted_fields.intersection(self.initial_data)

            if submitted_restricted_fields:
                raise serializers.ValidationError(
                    'Students cannot set execution or grading fields.'
                )

            if problem and problem.module and not user_has_module_access(
                request.user,
                problem.module,
            ):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
                )

            if (
                problem
                and not problem.module
                and problem.lesson
                and not user_has_module_access(request.user, problem.lesson.topic.module)
            ):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
                )

            if (
                problem
                and not problem.module
                and not problem.lesson
                and problem.topic
                and not user_has_module_access(request.user, problem.topic.module)
            ):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
                )

            if (
                problem
                and not problem.module
                and not problem.lesson
                and not problem.topic
                and not user_has_subject_content_access(
                    request.user,
                    problem.subject,
                )
            ):
                raise serializers.ValidationError(
                    'This problem is not available for your active classes.'
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
