from rest_framework import serializers

from .models import (
    FinalGrade,
    GradeCategory,
    GradingTemplate,
    GradingTemplateItem,
    PeriodGrade,
    StudentCategoryGrade,
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
            'computed_at',
        )
        read_only_fields = ('id', 'transmuted_grade', 'weighted_score', 'computed_at')


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
