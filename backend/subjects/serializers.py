from rest_framework import serializers

from .models import ScheduleStudent, SchoolYear, SchoolYearSemester, Subject, SubjectSchedule
from .scheduling import normalize_schedule_days


class SubjectSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subject
        fields = ('id', 'code', 'name', 'description', 'is_active', 'created_at', 'updated_at')
        read_only_fields = ('id', 'created_at', 'updated_at')


class SchoolYearSerializer(serializers.ModelSerializer):
    name = serializers.CharField(read_only=True)

    class Meta:
        model = SchoolYear
        fields = ('id', 'start_year', 'end_year', 'name', 'is_active')
        read_only_fields = ('id', 'name')

    def validate(self, attrs):
        start_year = attrs.get('start_year', getattr(self.instance, 'start_year', None))
        end_year = attrs.get('end_year', getattr(self.instance, 'end_year', None))

        if start_year and end_year and end_year != start_year + 1:
            raise serializers.ValidationError('School year must end one year after it starts.')

        return attrs


class SchoolYearSemesterSerializer(serializers.ModelSerializer):
    name = serializers.CharField(read_only=True)
    semester_display = serializers.CharField(source='get_semester_display', read_only=True)
    school_year_name = serializers.CharField(source='school_year.name', read_only=True)

    class Meta:
        model = SchoolYearSemester
        fields = (
            'id',
            'school_year',
            'school_year_name',
            'semester',
            'semester_display',
            'name',
            'is_active',
        )
        read_only_fields = ('id', 'school_year_name', 'semester_display', 'name')


class SubjectScheduleSerializer(serializers.ModelSerializer):
    subject_code = serializers.CharField(source='subject.code', read_only=True)
    subject_name = serializers.CharField(source='subject.name', read_only=True)
    term_name = serializers.CharField(source='school_year_semester.name', read_only=True)

    class Meta:
        model = SubjectSchedule
        fields = (
            'id',
            'subject',
            'subject_code',
            'subject_name',
            'school_year_semester',
            'term_name',
            'days',
            'start_time',
            'end_time',
            'section',
            'room',
            'is_active',
            'created_by',
            'updated_by',
            'archived_by',
            'created_at',
            'updated_at',
            'archived_at',
        )
        read_only_fields = (
            'id',
            'subject_code',
            'subject_name',
            'term_name',
            'created_by',
            'updated_by',
            'archived_by',
            'created_at',
            'updated_at',
            'archived_at',
        )

    def validate(self, attrs):
        days = attrs.get('days', getattr(self.instance, 'days', ''))
        start_time = attrs.get('start_time', getattr(self.instance, 'start_time', None))
        end_time = attrs.get('end_time', getattr(self.instance, 'end_time', None))
        try:
            normalized_days = normalize_schedule_days(days)
        except ValueError as error:
            raise serializers.ValidationError({'days': str(error)}) from error

        attrs['days'] = normalized_days

        if start_time and end_time and end_time <= start_time:
            raise serializers.ValidationError('End time must be after start time.')

        return attrs


class ScheduleStudentSerializer(serializers.ModelSerializer):
    student_number = serializers.SerializerMethodField()
    student_name = serializers.SerializerMethodField()
    subject = serializers.IntegerField(source='schedule.subject_id', read_only=True)
    subject_code = serializers.CharField(source='schedule.subject.code', read_only=True)
    subject_name = serializers.CharField(source='schedule.subject.name', read_only=True)
    school_year_semester = serializers.IntegerField(source='schedule.school_year_semester_id', read_only=True)
    term_name = serializers.CharField(source='schedule.school_year_semester.name', read_only=True)
    schedule_display = serializers.SerializerMethodField()

    class Meta:
        model = ScheduleStudent
        fields = (
            'id',
            'schedule',
            'schedule_display',
            'student',
            'student_number',
            'student_name',
            'subject',
            'subject_code',
            'subject_name',
            'school_year_semester',
            'term_name',
            'added_at',
            'is_active',
            'added_by',
            'deactivated_by',
            'deactivated_at',
            'updated_at',
        )
        read_only_fields = (
            'id',
            'schedule_display',
            'student_number',
            'student_name',
            'subject',
            'subject_code',
            'subject_name',
            'school_year_semester',
            'term_name',
            'added_at',
            'added_by',
            'deactivated_by',
            'deactivated_at',
            'updated_at',
        )

    def get_schedule_display(self, obj):
        if not obj.schedule:
            return ''

        return str(obj.schedule)

    def get_student_number(self, obj):
        return getattr(getattr(obj.student, 'student_profile', None), 'student_number', '')

    def get_student_name(self, obj):
        return obj.student.get_full_name() or obj.student.username

    def validate(self, attrs):
        student = attrs.get('student', getattr(self.instance, 'student', None))

        if student and student.role != student.Role.STUDENT:
            raise serializers.ValidationError('Only users with the student role can be added to a schedule.')

        return attrs
