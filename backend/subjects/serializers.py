from rest_framework import serializers

from .models import Enrollment, Subject


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ('id', 'code', 'name', 'description', 'is_active', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_at', 'updated_at')


class EnrollmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Enrollment
        fields = ('id', 'subject', 'student', 'enrolled_at', 'is_active')
        read_only_fields = ('id', 'enrolled_at')
