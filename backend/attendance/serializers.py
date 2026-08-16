from decimal import Decimal

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
            'roster_students',
            'created_at',
        )
        read_only_fields = ('id', 'term_name', 'roster_students', 'created_at')
        extra_kwargs = {'subject': {'required': False}}

    def validate(self, attrs):
        schedule = attrs.get('schedule', getattr(self.instance, 'schedule', None))

        if schedule:
            attrs['subject'] = schedule.subject
            attrs['school_year_semester'] = schedule.school_year_semester
        elif self.instance is None:
            raise serializers.ValidationError('Choose a class for attendance.')

        return attrs

    def create(self, validated_data):
        session = super().create(validated_data)
        snapshot_session_roster(session)
        return session


class AttendanceRecordSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttendanceRecord
        fields = ('id', 'session', 'student', 'status', 'points_earned', 'remarks', 'recorded_at')
        read_only_fields = ('id', 'points_earned', 'recorded_at')

    def validate(self, attrs):
        status = attrs.get('status', getattr(self.instance, 'status', None))
        remarks = attrs.get('remarks', getattr(self.instance, 'remarks', ''))
        session = attrs.get('session', getattr(self.instance, 'session', None))
        student = attrs.get('student', getattr(self.instance, 'student', None))
        validate_excused_remarks(status, remarks)
        if session and session.schedule_id and student:
            roster_ids = set(session.roster_students.values_list('id', flat=True))
            if not roster_ids:
                roster_ids = set(
                    session.schedule.students.filter(is_active=True).values_list('student_id', flat=True),
                )
            if student.id not in roster_ids:
                raise serializers.ValidationError({
                    'student': 'The student is not part of this attendance roster.',
                })
        return attrs

    def create(self, validated_data):
        validated_data['points_earned'] = attendance_points(
            validated_data['status'],
            validated_data['session'].points_possible,
        )
        return super().create(validated_data)

    def update(self, instance, validated_data):
        status = validated_data.get('status', instance.status)
        validated_data['points_earned'] = attendance_points(
            status,
            instance.session.points_possible,
        )
        if instance.status == 'EXCUSED' and status != 'EXCUSED' and 'remarks' not in validated_data:
            validated_data['remarks'] = ''
        return super().update(instance, validated_data)

class AttendanceRosterRecordSerializer(serializers.Serializer):
    student = serializers.IntegerField()
    status = serializers.ChoiceField(choices=('PRESENT', 'LATE', 'EXCUSED', 'ABSENT'))
    remarks = serializers.CharField(allow_blank=True, required=False)

    def validate(self, attrs):
        validate_excused_remarks(attrs['status'], attrs.get('remarks', ''))
        return attrs


def validate_excused_remarks(status, remarks):
    if status == 'EXCUSED' and not remarks.strip():
        raise serializers.ValidationError({
            'remarks': 'Enter an excuse reason.',
        })


def attendance_points(record_status, points_possible):
    if record_status in {'PRESENT', 'EXCUSED'}:
        return points_possible
    if record_status == 'LATE':
        return points_possible / Decimal('2')
    return Decimal('0')


def snapshot_session_roster(session):
    if not session.schedule_id or session.roster_students.exists():
        return
    student_ids = session.schedule.students.filter(is_active=True).values_list('student_id', flat=True)
    session.roster_students.set(student_ids)
