from rest_framework import serializers

from .models import AttendanceRecord, AttendanceSession


class AttendanceSessionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceSession
        fields = ('id', 'subject', 'title', 'date', 'points_possible', 'notes', 'created_at')
        read_only_fields = ('id', 'created_at')


class AttendanceRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceRecord
        fields = ('id', 'session', 'student', 'status', 'points_earned', 'remarks', 'recorded_at')
        read_only_fields = ('id', 'recorded_at')
