from rest_framework import serializers

from .models import AttendanceRecord, AttendanceSession


class AttendanceSessionSerializer(serializers.ModelSerializer):
    term_name = serializers.CharField(source='school_year_semester.name', read_only=True)

    class Meta:
        model = AttendanceSession
        fields = (
            'id',
            'subject',
            'school_year_semester',
            'term_name',
            'title',
            'date',
            'points_possible',
            'notes',
            'created_at',
        )
        read_only_fields = ('id', 'term_name', 'created_at')


class AttendanceRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceRecord
        fields = ('id', 'session', 'student', 'status', 'points_earned', 'remarks', 'recorded_at')
        read_only_fields = ('id', 'recorded_at')
