from rest_framework import serializers

from .models import AttendanceRecord, AttendanceSession


class AttendanceSessionSerializer(serializers.ModelSerializer):
    term_name = serializers.CharField(source='school_year_semester.name', read_only=True)

    class Meta:
        model = AttendanceSession
        fields = (
            'id',
            'schedule',
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
        extra_kwargs = {'subject': {'required': False}}

    def validate(self, attrs):
        schedule = attrs.get('schedule', getattr(self.instance, 'schedule', None))

        if schedule:
            attrs['subject'] = schedule.subject
            attrs['school_year_semester'] = schedule.school_year_semester
        elif self.instance is None:
            raise serializers.ValidationError('Choose a class for attendance.')

        return attrs


class AttendanceRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceRecord
        fields = ('id', 'session', 'student', 'status', 'points_earned', 'remarks', 'recorded_at')
        read_only_fields = ('id', 'recorded_at')


class AttendanceRosterRecordSerializer(serializers.Serializer):
    student = serializers.IntegerField()
    status = serializers.ChoiceField(choices=('PRESENT', 'LATE', 'EXCUSED', 'ABSENT'))
    remarks = serializers.CharField(allow_blank=True, required=False)
