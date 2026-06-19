from rest_framework import serializers

from .models import (
    FinalGrade,
    GradeCategory,
    GradeItem,
    GradingTemplate,
    GradingTemplateItem,
    PeriodGrade,
    StudentCategoryGrade,
    StudentGradeItemScore,
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
        fields = ('id', 'name', 'description', 'is_default', 'created_at', 'items')
        read_only_fields = ('id', 'created_at')


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
            'subject',
            'student',
            'grade_category',
            'raw_score',
            'total_score',
            'transmuted_grade',
            'weighted_score',
            'is_item_computed',
            'computed_at',
        )
        read_only_fields = ('id', 'transmuted_grade', 'weighted_score', 'is_item_computed', 'computed_at')


class GradeItemSerializer(serializers.ModelSerializer):
    subject = serializers.IntegerField(source='grade_category.subject_id', read_only=True)
    source_title = serializers.CharField(read_only=True)
    source_points_possible = serializers.DecimalField(max_digits=7, decimal_places=2, read_only=True)

    class Meta:
        model = GradeItem
        fields = (
            'id',
            'grade_category',
            'subject',
            'title',
            'points_possible',
            'order',
            'source_type',
            'assessment',
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
            'ASSESSMENT': 'assessment',
            'MODULE_ACTIVITY': 'module_activity',
            'ATTENDANCE': 'attendance_session',
            'CODING': 'coding_problem',
        }
        required_field = source_fields.get(source_type)

        if required_field:
            source_value = attrs.get(required_field, getattr(self.instance, required_field, None))
            if not source_value:
                raise serializers.ValidationError({required_field: 'This source is required for the selected source type.'})
            if grade_category and not source_matches_subject(source_type, source_value, grade_category.subject_id):
                raise serializers.ValidationError({required_field: 'This source does not belong to the selected subject.'})

        return attrs


class StudentGradeItemScoreSerializer(serializers.ModelSerializer):
    grade_category = serializers.IntegerField(source='grade_item.grade_category_id', read_only=True)
    subject = serializers.IntegerField(source='grade_item.grade_category.subject_id', read_only=True)
    total_score = serializers.DecimalField(max_digits=7, decimal_places=2, read_only=True)
    transmuted_grade = serializers.DecimalField(max_digits=5, decimal_places=2, read_only=True)

    class Meta:
        model = StudentGradeItemScore
        fields = (
            'id',
            'grade_item',
            'grade_category',
            'subject',
            'student',
            'raw_score',
            'total_score',
            'transmuted_grade',
            'remarks',
            'computed_at',
        )
        read_only_fields = ('id', 'grade_category', 'subject', 'total_score', 'transmuted_grade', 'computed_at')


def source_matches_subject(source_type, source, subject_id):
    if source_type == 'ASSESSMENT':
        return source.subject_id == subject_id
    if source_type == 'ATTENDANCE':
        return source.subject_id == subject_id
    if source_type == 'MODULE_ACTIVITY':
        return source.module.subjects.filter(pk=subject_id).exists()
    if source_type == 'CODING':
        if source.subject_id == subject_id:
            return True
        if source.module_id:
            return source.module.subjects.filter(pk=subject_id).exists()
        return False
    return True


class PeriodGradeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PeriodGrade
        fields = ('id', 'subject', 'student', 'grading_period', 'raw_score', 'remarks', 'computed_at')
        read_only_fields = ('id', 'raw_score', 'computed_at')


class FinalGradeSerializer(serializers.ModelSerializer):
    class Meta:
        model = FinalGrade
        fields = (
            'id',
            'subject',
            'student',
            'prelim_grade',
            'midterm_grade',
            'prefinal_grade',
            'final_period_grade',
            'final_grade',
            'remarks',
            'computed_at',
        )
        read_only_fields = ('id', 'final_grade', 'computed_at')
