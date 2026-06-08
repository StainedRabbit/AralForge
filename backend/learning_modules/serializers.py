from rest_framework import serializers

from .models import Module, ModuleActivity, ModuleActivitySubmission, ModuleProgress


class ModuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Module
        fields = (
            'id',
            'title',
            'slug',
            'description',
            'content',
            'pdf_file',
            'subjects',
            'is_published',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at')


class ModuleActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleActivity
        fields = (
            'id',
            'module',
            'programming_problem',
            'title',
            'instructions',
            'activity_type',
            'order',
            'points_possible',
            'due_at',
            'accepts_text',
            'accepts_file',
            'accepts_code',
            'is_published',
            'created_at',
        )
        read_only_fields = ('id', 'created_at')


class ModuleActivitySubmissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleActivitySubmission
        fields = (
            'id',
            'activity',
            'student',
            'text_answer',
            'file',
            'code',
            'score',
            'feedback',
            'submitted_at',
            'graded_at',
        )
        read_only_fields = ('id', 'submitted_at')

    def validate_student(self, value):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and value != request.user:
            raise serializers.ValidationError('Students can only submit as themselves.')

        return value

    def validate(self, attrs):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher:
            restricted_fields = {'score', 'feedback', 'graded_at'}
            submitted_restricted_fields = restricted_fields.intersection(self.initial_data)

            if submitted_restricted_fields:
                raise serializers.ValidationError(
                    'Students cannot set grading fields.'
                )

        return attrs


class ModuleProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleProgress
        fields = (
            'id',
            'module',
            'student',
            'started_at',
            'completed_at',
        )
        read_only_fields = ('id', 'started_at')

    def validate_student(self, value):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and value != request.user:
            raise serializers.ValidationError('Students can only create progress as themselves.')

        return value
