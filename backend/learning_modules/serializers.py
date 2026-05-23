from rest_framework import serializers

from .models import Module, ModuleActivity, ModuleActivitySubmission


class ModuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Module
        fields = (
            'id',
            'title',
            'slug',
            'description',
            'content',
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
            'title',
            'instructions',
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
