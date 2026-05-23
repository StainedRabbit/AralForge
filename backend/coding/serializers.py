from rest_framework import serializers

from .models import CodeSubmission, ProgrammingProblem, TestCase


class TestCaseSerializer(serializers.ModelSerializer):
    class Meta:
        model = TestCase
        fields = ('id', 'problem', 'input_data', 'expected_output', 'is_hidden', 'order')
        read_only_fields = ('id',)


class ProgrammingProblemSerializer(serializers.ModelSerializer):
    test_cases = TestCaseSerializer(many=True, read_only=True)

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
            'assessment_question',
            'points_possible',
            'is_published',
            'created_at',
            'test_cases',
        )
        read_only_fields = ('id', 'created_at')


class CodeSubmissionSerializer(serializers.ModelSerializer):
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
        )
        read_only_fields = ('id', 'submitted_at')

    def validate_student(self, value):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and value != request.user:
            raise serializers.ValidationError('Students can only submit as themselves.')

        return value
