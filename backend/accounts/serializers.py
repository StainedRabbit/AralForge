from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import StudentProfile, User
from .services import create_student_account, update_student_profile


class UserSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True, required=False)
    is_admin_teacher = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = (
            'id',
            'username',
            'password',
            'email',
            'first_name',
            'last_name',
            'role',
            'is_admin_teacher',
            'is_active',
            'must_change_password',
        )
        read_only_fields = ('id', 'is_admin_teacher', 'must_change_password')

    def validate_password(self, value):
        validate_password(value, self.instance)
        return value

    def validate(self, attrs):
        default_role = self.instance.role if self.instance is not None else User.Role.STUDENT
        role = attrs.get('role', default_role)
        if self.instance is None and role == User.Role.STUDENT:
            raise serializers.ValidationError({
                'role': 'Create student accounts through the student endpoint.'
            })

        if self.instance is not None:
            profile = StudentProfile.objects.filter(user=self.instance).first()
            if profile:
                if role != User.Role.STUDENT:
                    raise serializers.ValidationError({
                        'role': 'Remove the student profile before changing this account role.'
                    })
                username = attrs.get('username', self.instance.username)
                if username != profile.student_number:
                    raise serializers.ValidationError({
                        'username': 'A student username must match the student number.'
                    })
            elif role == User.Role.STUDENT:
                raise serializers.ValidationError({
                    'role': 'Create student accounts through the student endpoint.'
                })
        return attrs

    def create(self, validated_data):
        password = validated_data.pop('password', None)
        user = User(**validated_data)

        if password:
            user.set_password(password)
        else:
            user.set_unusable_password()

        user.save()
        return user

    def update(self, instance, validated_data):
        password = validated_data.pop('password', None)

        for field, value in validated_data.items():
            setattr(instance, field, value)

        if password:
            instance.set_password(password)
            instance.must_change_password = False

        instance.save()
        return instance


class AvailableStudentSerializer(serializers.ModelSerializer):
    display_name = serializers.SerializerMethodField()
    enrollment_status = serializers.SerializerMethodField()
    student_number = serializers.CharField(source='student_profile.student_number', default='')

    class Meta:
        model = User
        fields = (
            'id',
            'display_name',
            'student_number',
            'enrollment_status',
        )

    def get_display_name(self, instance):
        return instance.get_full_name().strip() or instance.username

    def get_enrollment_status(self, instance):
        return 'inactive' if getattr(instance, 'has_inactive_enrollment', False) else 'not_enrolled'


class StudentProfileSerializer(serializers.ModelSerializer):
    user_detail = UserSerializer(source='user', read_only=True)
    first_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    last_name = serializers.CharField(write_only=True, required=False, allow_blank=True)
    email = serializers.EmailField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = StudentProfile
        fields = (
            'id',
            'user',
            'user_detail',
            'student_number',
            'first_name',
            'last_name',
            'email',
            'is_active',
            'joined_at',
        )
        read_only_fields = ('id', 'user', 'joined_at')

    def validate(self, attrs):
        if self.instance is not None:
            account_fields = {'first_name', 'last_name', 'email'} & attrs.keys()
            if account_fields:
                raise serializers.ValidationError({
                    field: 'Edit account details through the user endpoint.'
                    for field in account_fields
                })
        return attrs

    def create(self, validated_data):
        try:
            return create_student_account(**validated_data)
        except DjangoValidationError as error:
            raise serializers.ValidationError({'student_number': error.messages}) from error

    def update(self, instance, validated_data):
        try:
            return update_student_profile(instance, validated_data)
        except DjangoValidationError as error:
            raise serializers.ValidationError({'student_number': error.messages}) from error
