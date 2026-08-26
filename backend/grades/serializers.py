from rest_framework import serializers

from subjects.models import ScheduleStudent

from .models import (
    FinalGrade,
    GradeCategory,
    GradeItem,
    GradingTemplate,
    GradingTemplateItem,
    PeriodGrade,
    StudentCategoryGrade,
    StudentGradeItemScore,
    SubjectGradingPolicy,
)


class GradingTemplateItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = GradingTemplateItem
        fields = ('id', 'template', 'grading_period', 'category', 'name', 'weight')
        read_only_fields = ('id',)

    def validate(self, attrs):
        if self.instance:
            data = {
                'template': self.instance.template,
                'grading_period': self.instance.grading_period,
                'category': self.instance.category,
                'name': self.instance.name,
                'weight': self.instance.weight,
            }
            data.update(attrs)
            instance = GradingTemplateItem(**data)
            instance.pk = self.instance.pk
        else:
            instance = GradingTemplateItem(**attrs)

        instance.clean()
        return attrs


class GradingTemplateSerializer(serializers.ModelSerializer):
    items = GradingTemplateItemSerializer(many=True, read_only=True)

    class Meta:
        model = GradingTemplate
        fields = (
            'id', 'name', 'description', 'is_default', 'transmutation_base',
            'transmutation_scale', 'prelim_weight', 'midterm_weight',
            'prefinal_weight', 'final_weight', 'created_at', 'items',
        )
        read_only_fields = ('id', 'created_at')

    def validate(self, attrs):
        instance = GradingTemplate(**{
            **({
                'name': self.instance.name, 'description': self.instance.description,
                'is_default': self.instance.is_default,
                'transmutation_base': self.instance.transmutation_base,
                'transmutation_scale': self.instance.transmutation_scale,
                'prelim_weight': self.instance.prelim_weight,
                'midterm_weight': self.instance.midterm_weight,
                'prefinal_weight': self.instance.prefinal_weight,
                'final_weight': self.instance.final_weight,
            } if self.instance else {}), **attrs,
        })
        instance.clean()
        return attrs


class SubjectGradingPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = SubjectGradingPolicy
        fields = (
            'id', 'subject', 'source_template', 'transmutation_base', 'transmutation_scale',
            'prelim_weight', 'midterm_weight', 'prefinal_weight', 'final_weight', 'updated_at',
        )
        read_only_fields = ('id', 'updated_at')

    def validate(self, attrs):
        values = {
            field: attrs.get(field, getattr(self.instance, field, None))
            for field in (
                'subject', 'source_template', 'transmutation_base', 'transmutation_scale',
                'prelim_weight', 'midterm_weight', 'prefinal_weight', 'final_weight',
            )
        }
        instance = SubjectGradingPolicy(**values)
        if self.instance:
            instance.pk = self.instance.pk
        instance.clean()
        return attrs


class GradeCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = GradeCategory
        fields = (
            'id',
            'subject',
            'template_item',
            'grading_period',
            'category',
            'name',
            'weight',
        )
        read_only_fields = ('id',)

    def validate(self, attrs):
        if self.instance:
            data = {
                'subject': self.instance.subject,
                'template_item': self.instance.template_item,
                'grading_period': self.instance.grading_period,
                'category': self.instance.category,
                'name': self.instance.name,
                'weight': self.instance.weight,
            }
            data.update(attrs)
            instance = GradeCategory(**data)
            instance.pk = self.instance.pk
        else:
            instance = GradeCategory(**attrs)

        instance.clean()
        return attrs


class StudentCategoryGradeSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentCategoryGrade
        fields = (
            'id',
            'schedule',
            'subject',
            'student',
            'grade_category',
            'raw_score',
            'total_score',
            'transmuted_grade',
            'weighted_score',
            'is_item_computed',
            'completion_status',
            'required_item_count',
            'resolved_item_count',
            'pending_item_count',
            'withheld_reason',
            'computed_at',
        )
        read_only_fields = (
            'id', 'transmuted_grade', 'weighted_score', 'is_item_computed', 'completion_status',
            'required_item_count', 'resolved_item_count', 'pending_item_count', 'withheld_reason', 'computed_at',
        )

    def validate(self, attrs):
        data = merged_values(self.instance, attrs, 'schedule', 'subject', 'student', 'grade_category')
        require_schedule_for_create(self.instance, data['schedule'])
        validate_schedule_subject(data['schedule'], data['subject'])
        if data['grade_category'] and data['subject'] != data['grade_category'].subject:
            raise serializers.ValidationError({'grade_category': 'This category does not belong to the selected subject.'})
        validate_schedule_student(data['schedule'], data['student'])
        raw_score = attrs.get('raw_score', getattr(self.instance, 'raw_score', None))
        total_score = attrs.get('total_score', getattr(self.instance, 'total_score', None))
        if total_score is not None and total_score <= 0:
            raise serializers.ValidationError({'total_score': 'Total score must be greater than zero.'})
        if raw_score is not None and (raw_score < 0 or (total_score is not None and raw_score > total_score)):
            raise serializers.ValidationError({'raw_score': 'Raw score must be between zero and total score.'})
        return attrs


class GradeItemSerializer(serializers.ModelSerializer):
    subject = serializers.IntegerField(source='grade_category.subject_id', read_only=True)
    source_title = serializers.CharField(read_only=True)
    source_points_possible = serializers.DecimalField(max_digits=7, decimal_places=2, read_only=True)

    class Meta:
        model = GradeItem
        fields = (
            'id',
            'schedule',
            'grade_category',
            'subject',
            'title',
            'date',
            'points_possible',
            'order',
            'is_required',
            'source_type',
            'module_activity',
            'attendance_session',
            'coding_problem',
            'source_title',
            'source_points_possible',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'subject', 'source_title', 'source_points_possible', 'created_at', 'updated_at')

    def validate(self, attrs):
        source_type = attrs.get('source_type', getattr(self.instance, 'source_type', 'MANUAL'))
        grade_category = attrs.get('grade_category', getattr(self.instance, 'grade_category', None))
        source_fields = {
            'MODULE_ACTIVITY': 'module_activity',
            'ATTENDANCE': 'attendance_session',
            'CODING': 'coding_problem',
        }
        required_field = source_fields.get(source_type)
        schedule = attrs.get('schedule', getattr(self.instance, 'schedule', None))
        require_schedule_for_create(self.instance, schedule)

        if schedule and grade_category and schedule.subject_id != grade_category.subject_id:
            raise serializers.ValidationError({'schedule': 'This class does not belong to the grade category subject.'})
        if self.instance and schedule and schedule != self.instance.schedule:
            invalid_student = self.instance.student_scores.exclude(
                student__scheduled_classes__schedule=schedule,
            ).exists()
            if invalid_student:
                raise serializers.ValidationError({'schedule': 'One or more scored students are not enrolled in this class.'})

        if required_field:
            source_value = attrs.get(required_field, getattr(self.instance, required_field, None))
            if not source_value:
                raise serializers.ValidationError({required_field: 'This source is required for the selected source type.'})
            if grade_category and not source_matches_subject(source_type, source_value, grade_category.subject_id):
                raise serializers.ValidationError({required_field: 'This source does not belong to the selected subject.'})
            if source_type == 'ATTENDANCE' and schedule and source_value.schedule_id != schedule.id:
                raise serializers.ValidationError({required_field: 'This attendance session does not belong to the selected class.'})
            if (
                source_type == 'MODULE_ACTIVITY'
                and schedule
                and GradeItem.objects.filter(
                    schedule=schedule,
                    module_activity=source_value,
                ).exclude(pk=getattr(self.instance, 'pk', None)).exists()
            ):
                raise serializers.ValidationError({
                    required_field: 'This Main Activity is already linked to the selected class.',
                })

        points_possible = attrs.get('points_possible', getattr(self.instance, 'points_possible', None))
        if points_possible is not None and points_possible <= 0:
            raise serializers.ValidationError({'points_possible': 'Points possible must be greater than zero.'})

        return attrs

    def update(self, instance, validated_data):
        previous_schedule = instance.schedule
        previous_category = instance.grade_category
        students = [score.student for score in instance.student_scores.select_related('student')]
        updated = super().update(instance, validated_data)
        if previous_schedule != updated.schedule or previous_category != updated.grade_category:
            from .services import recompute_student_category_from_items

            for student in students:
                recompute_student_category_from_items(student, previous_category, previous_schedule)
        return updated


class StudentGradeItemScoreSerializer(serializers.ModelSerializer):
    schedule = serializers.IntegerField(source='grade_item.schedule_id', read_only=True)
    grade_category = serializers.IntegerField(source='grade_item.grade_category_id', read_only=True)
    subject = serializers.IntegerField(source='grade_item.grade_category.subject_id', read_only=True)
    total_score = serializers.DecimalField(max_digits=7, decimal_places=2, read_only=True)
    transmuted_grade = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)

    class Meta:
        model = StudentGradeItemScore
        fields = (
            'id',
            'schedule',
            'grade_item',
            'grade_category',
            'subject',
            'student',
            'raw_score',
            'status',
            'origin',
            'override_reason',
            'total_score',
            'transmuted_grade',
            'remarks',
            'computed_at',
        )
        read_only_fields = (
            'id', 'grade_category', 'subject', 'total_score', 'transmuted_grade', 'origin',
            'override_reason', 'computed_at',
        )

    def validate(self, attrs):
        grade_item = attrs.get('grade_item', getattr(self.instance, 'grade_item', None))
        student = attrs.get('student', getattr(self.instance, 'student', None))
        if grade_item and not grade_item.schedule_id:
            raise serializers.ValidationError({'grade_item': 'Assign this legacy grade item to a class before recording scores.'})
        if grade_item:
            validate_schedule_student(grade_item.schedule, student)
        status = attrs.get('status', getattr(self.instance, 'status', StudentGradeItemScore.Status.GRADED))
        raw_score = attrs.get('raw_score', getattr(self.instance, 'raw_score', None))
        if status == StudentGradeItemScore.Status.EXCUSED:
            attrs['raw_score'] = None
        elif raw_score is None:
            raise serializers.ValidationError({'raw_score': 'A graded score requires a raw score.'})
        elif grade_item and (raw_score < 0 or raw_score > grade_item.points_possible):
            raise serializers.ValidationError({'raw_score': 'Score must be between zero and points possible.'})
        if self.instance and self.instance.origin == StudentGradeItemScore.Origin.AUTOMATIC:
            raise serializers.ValidationError('Use the override action to change an automatically synchronized score.')
        return attrs

    def update(self, instance, validated_data):
        previous_student = instance.student
        previous_item = instance.grade_item
        updated = super().update(instance, validated_data)
        if previous_student != updated.student or previous_item != updated.grade_item:
            from .services import recompute_student_category_from_items

            recompute_student_category_from_items(
                previous_student,
                previous_item.grade_category,
                previous_item.schedule,
            )
        return updated


def source_matches_subject(source_type, source, subject_id):
    if source_type == 'ATTENDANCE':
        return source.subject_id == subject_id
    if source_type == 'MODULE_ACTIVITY':
        return (
            source.module.subject_id == subject_id
            or source.module.subjects.filter(pk=subject_id).exists()
        )
    if source_type == 'CODING':
        if source.subject_id == subject_id:
            return True
        if source.module_id:
            return (
                source.module.subject_id == subject_id
                or source.module.subjects.filter(pk=subject_id).exists()
            )
        return False
    return True


class PeriodGradeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PeriodGrade
        fields = (
            'id', 'schedule', 'subject', 'student', 'grading_period', 'raw_score', 'remarks',
            'completion_status', 'required_item_count', 'resolved_item_count', 'pending_item_count',
            'withheld_reason', 'computed_at',
        )
        read_only_fields = ('id', 'raw_score', 'computed_at')

    def validate(self, attrs):
        data = merged_values(self.instance, attrs, 'schedule', 'subject', 'student')
        require_schedule_for_create(self.instance, data['schedule'])
        validate_schedule_subject(data['schedule'], data['subject'])
        validate_schedule_student(data['schedule'], data['student'])
        return attrs


class FinalGradeSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinalGrade
        fields = (
            'id',
            'schedule',
            'subject',
            'student',
            'prelim_grade',
            'midterm_grade',
            'prefinal_grade',
            'final_period_grade',
            'final_grade',
            'completion_status',
            'completed_period_count',
            'required_period_count',
            'withheld_reason',
            'remarks',
            'computed_at',
        )
        read_only_fields = ('id', 'final_grade', 'computed_at')

    def validate(self, attrs):
        data = merged_values(self.instance, attrs, 'schedule', 'subject', 'student')
        require_schedule_for_create(self.instance, data['schedule'])
        validate_schedule_subject(data['schedule'], data['subject'])
        validate_schedule_student(data['schedule'], data['student'])
        return attrs


def merged_values(instance, attrs, *fields):
    return {field: attrs.get(field, getattr(instance, field, None)) for field in fields}


def require_schedule_for_create(instance, schedule):
    if instance is None and schedule is None:
        raise serializers.ValidationError({'schedule': 'A class schedule is required.'})


def validate_schedule_subject(schedule, subject):
    if schedule and subject and schedule.subject_id != subject.id:
        raise serializers.ValidationError({'schedule': 'This class does not belong to the selected subject.'})


def validate_schedule_student(schedule, student):
    if schedule and student and not ScheduleStudent.objects.filter(schedule=schedule, student=student).exists():
        raise serializers.ValidationError({'student': 'This student is not enrolled in the selected class.'})
