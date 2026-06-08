from django.contrib import admin

from .models import Module, ModuleAccess, ModuleActivity, ModuleActivitySubmission, ModuleProgress


@admin.register(Module)
class ModuleAdmin(admin.ModelAdmin):
    list_display = ('title', 'is_paid', 'price', 'is_published', 'created_at')
    list_filter = ('is_paid', 'is_published', 'subjects')
    search_fields = ('title', 'description')
    prepopulated_fields = {'slug': ('title',)}


@admin.register(ModuleAccess)
class ModuleAccessAdmin(admin.ModelAdmin):
    list_display = (
        'module',
        'student',
        'payment_status',
        'amount_paid',
        'is_active',
        'expires_at',
        'activated_by',
        'activated_at',
    )
    list_filter = ('payment_status', 'is_active', 'module')
    search_fields = (
        'module__title',
        'student__username',
        'student__first_name',
        'student__last_name',
        'payment_reference',
    )
    autocomplete_fields = ('module', 'student', 'activated_by')


@admin.register(ModuleActivity)
class ModuleActivityAdmin(admin.ModelAdmin):
    list_display = ('title', 'module', 'activity_type', 'order', 'points_possible', 'due_at', 'is_published')
    list_filter = ('activity_type', 'is_published', 'accepts_text', 'accepts_file', 'accepts_code')
    search_fields = ('title', 'module__title', 'programming_problem__title')


@admin.register(ModuleActivitySubmission)
class ModuleActivitySubmissionAdmin(admin.ModelAdmin):
    list_display = ('activity', 'student', 'score', 'submitted_at', 'graded_at')
    list_filter = ('activity__module',)
    search_fields = ('activity__title', 'student__username')


@admin.register(ModuleProgress)
class ModuleProgressAdmin(admin.ModelAdmin):
    list_display = ('module', 'student', 'started_at', 'completed_at')
    list_filter = ('module', 'completed_at')
    search_fields = ('module__title', 'student__username')
