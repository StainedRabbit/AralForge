from rest_framework import serializers

from .models import (
    Module,
    ModuleAccess,
    ModuleActivity,
    ModuleActivitySubmission,
    ModuleProgress,
    user_has_module_access,
)


class ModuleSerializer(serializers.ModelSerializer):
    is_accessible = serializers.SerializerMethodField()

    class Meta:
        model = Module
        fields = (
            'id',
            'title',
            'slug',
            'description',
            'content',
            'pdf_file',
            'is_paid',
            'price',
            'is_accessible',
            'subjects',
            'is_published',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'is_accessible', 'created_at', 'updated_at')

    def get_is_accessible(self, obj):
        request = self.context.get('request')

        if not request or request.user.is_admin_teacher:
            return True

        return user_has_module_access(request.user, obj)


class ModuleAccessSerializer(serializers.ModelSerializer):
    module_title = serializers.CharField(source='module.title', read_only=True)
    student_name = serializers.SerializerMethodField()
    activated_by_name = serializers.SerializerMethodField()
    is_available = serializers.BooleanField(read_only=True)

    class Meta:
        model = ModuleAccess
        fields = (
            'id',
            'module',
            'module_title',
            'student',
            'student_name',
            'activated_by',
            'activated_by_name',
            'payment_status',
            'amount_paid',
            'payment_reference',
            'is_active',
            'is_available',
            'expires_at',
            'notes',
            'activated_at',
            'updated_at',
        )
        read_only_fields = (
            'id',
            'activated_by',
            'activated_at',
            'updated_at',
            'is_available',
        )

    def get_student_name(self, obj):
        return obj.student.get_full_name() or obj.student.username

    def get_activated_by_name(self, obj):
        if not obj.activated_by:
            return ''

        return obj.activated_by.get_full_name() or obj.activated_by.username

    def validate_student(self, value):
        if value.role != value.Role.STUDENT:
            raise serializers.ValidationError('Only student users can receive module access.')

        return value


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

            activity = attrs.get('activity') or getattr(self.instance, 'activity', None)

            if activity and not user_has_module_access(request.user, activity.module):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
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

    def validate(self, attrs):
        request = self.context.get('request')

        if request and not request.user.is_admin_teacher:
            module = attrs.get('module') or getattr(self.instance, 'module', None)

            if module and not user_has_module_access(request.user, module):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
                )

        return attrs
