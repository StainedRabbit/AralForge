from rest_framework import serializers
from django.contrib.auth.password_validation import validate_password

from .models import StudentProfile, User


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
    section = serializers.CharField(source='student_profile.section', default='')
    student_number = serializers.CharField(source='student_profile.student_number', default='')
    year_level = serializers.IntegerField(source='student_profile.year_level', allow_null=True, default=None)

    class Meta:
        model = User
        fields = (
            'id',
            'display_name',
            'student_number',
            'section',
            'year_level',
            'enrollment_status',
        )

    def get_display_name(self, instance):
        return instance.get_full_name().strip() or instance.username

    def get_enrollment_status(self, instance):
        return 'inactive' if getattr(instance, 'has_inactive_enrollment', False) else 'not_enrolled'


class StudentProfileSerializer(serializers.ModelSerializer):
    user_detail = UserSerializer(source='user', read_only=True)

    class Meta:
        model = StudentProfile
        fields = (
            'id',
            'user',
            'user_detail',
            'student_number',
            'section',
            'year_level',
            'is_active',
            'joined_at',
        )
        read_only_fields = ('id', 'joined_at')
