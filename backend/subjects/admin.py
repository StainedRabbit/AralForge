from django.contrib import admin

from .models import ScheduleStudent, SchoolYear, SchoolYearSemester, Subject, SubjectSchedule


@admin.register(SchoolYear)
class SchoolYearAdmin(admin.ModelAdmin):
    list_display = ('name', 'start_year', 'end_year', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('start_year', 'end_year')


@admin.register(SchoolYearSemester)
class SchoolYearSemesterAdmin(admin.ModelAdmin):
    list_display = ('name', 'school_year', 'semester', 'is_active')
    list_filter = ('is_active', 'semester', 'school_year')
    search_fields = ('school_year__start_year', 'school_year__end_year')


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('code', 'name')
    actions = ['apply_default_grading_template']

    @admin.action(description='Apply default grading template')
    def apply_default_grading_template(self, request, queryset):
        from grades.models import GradingTemplate

        template = GradingTemplate.objects.filter(is_default=True).first()

        if not template:
            self.message_user(request, 'No default grading template is configured.', level='WARNING')
            return

        total_categories = 0

        for subject in queryset:
            total_categories += len(template.apply_to_subject(subject))

        self.message_user(request, f'Applied default template and synced {total_categories} grade categories.')


@admin.register(SubjectSchedule)
class SubjectScheduleAdmin(admin.ModelAdmin):
    list_display = ('subject', 'days', 'start_time', 'end_time', 'school_year_semester', 'section', 'room', 'is_active')
    list_filter = ('is_active', 'school_year_semester', 'days')
    search_fields = ('subject__code', 'subject__name', 'section', 'room')


@admin.register(ScheduleStudent)
class ScheduleStudentAdmin(admin.ModelAdmin):
    list_display = ('schedule', 'student', 'student_number', 'is_active', 'added_at')
    list_filter = ('is_active', 'schedule__school_year_semester', 'schedule__subject')
    search_fields = (
        'schedule__subject__code',
        'schedule__subject__name',
        'student__username',
        'student__first_name',
        'student__last_name',
        'student__student_profile__student_number',
    )

    @admin.display(description='Student number')
    def student_number(self, obj):
        return getattr(getattr(obj.student, 'student_profile', None), 'student_number', '')
