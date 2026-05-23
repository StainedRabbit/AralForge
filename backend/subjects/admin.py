from django.contrib import admin

from .models import Enrollment, Subject


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


@admin.register(Enrollment)
class EnrollmentAdmin(admin.ModelAdmin):
    list_display = ('subject', 'student', 'is_active', 'enrolled_at')
    list_filter = ('is_active', 'subject')
    search_fields = ('subject__code', 'subject__name', 'student__username')
