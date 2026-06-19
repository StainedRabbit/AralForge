from django.contrib import admin

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


class GradingTemplateItemInline(admin.TabularInline):
    model = GradingTemplateItem
    extra = 4


class GradeCategoryInline(admin.TabularInline):
    model = GradeCategory
    extra = 0
    fields = ('grading_period', 'category', 'name', 'weight', 'template_item')


@admin.register(GradingTemplate)
class GradingTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'is_default', 'created_at')
    list_filter = ('is_default',)
    search_fields = ('name', 'description')
    inlines = [GradingTemplateItemInline]
    actions = ['apply_to_all_subjects']

    @admin.action(description='Apply selected template to all subjects')
    def apply_to_all_subjects(self, request, queryset):
        from subjects.models import Subject

        subjects = Subject.objects.all()
        total_categories = 0

        for template in queryset:
            for subject in subjects:
                total_categories += len(template.apply_to_subject(subject))

        self.message_user(request, f'Applied templates and synced {total_categories} grade categories.')


@admin.register(GradeCategory)
class GradeCategoryAdmin(admin.ModelAdmin):
    list_display = ('subject', 'grading_period', 'name', 'category', 'weight')
    list_filter = ('subject', 'grading_period', 'category')
    search_fields = ('subject__code', 'subject__name', 'name')


@admin.register(GradeItem)
class GradeItemAdmin(admin.ModelAdmin):
    list_display = ('grade_category', 'title', 'source_type', 'points_possible', 'order')
    list_filter = ('grade_category__subject', 'grade_category__grading_period', 'source_type')
    search_fields = ('title', 'grade_category__subject__code', 'grade_category__name')


@admin.register(StudentGradeItemScore)
class StudentGradeItemScoreAdmin(admin.ModelAdmin):
    list_display = ('grade_item', 'student', 'raw_score', 'total_score', 'computed_at')
    list_filter = ('grade_item__grade_category__subject', 'grade_item__grade_category__grading_period')
    search_fields = ('student__username', 'student__first_name', 'student__last_name', 'grade_item__title')


@admin.register(StudentCategoryGrade)
class StudentCategoryGradeAdmin(admin.ModelAdmin):
    list_display = (
        'subject',
        'student',
        'grade_category',
        'raw_score',
        'total_score',
        'transmuted_grade',
        'weighted_score',
    )
    list_filter = ('subject', 'grade_category__grading_period', 'grade_category__category')
    search_fields = ('student__username', 'student__first_name', 'student__last_name', 'subject__code')


@admin.register(PeriodGrade)
class PeriodGradeAdmin(admin.ModelAdmin):
    list_display = ('subject', 'student', 'grading_period', 'raw_score', 'computed_at')
    list_filter = ('subject', 'grading_period')
    search_fields = ('student__username', 'subject__code')


@admin.register(FinalGrade)
class FinalGradeAdmin(admin.ModelAdmin):
    list_display = (
        'subject',
        'student',
        'prelim_grade',
        'midterm_grade',
        'prefinal_grade',
        'final_period_grade',
        'final_grade',
        'computed_at',
    )
    list_filter = ('subject',)
    search_fields = ('student__username', 'subject__code')
