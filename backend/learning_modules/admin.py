from django.contrib import admin

from .models import Module, ModuleActivity, ModuleActivitySubmission


@admin.register(Module)
class ModuleAdmin(admin.ModelAdmin):
    list_display = ('title', 'is_published', 'created_at')
    list_filter = ('is_published', 'subjects')
    search_fields = ('title', 'description')
    prepopulated_fields = {'slug': ('title',)}


@admin.register(ModuleActivity)
class ModuleActivityAdmin(admin.ModelAdmin):
    list_display = ('title', 'module', 'points_possible', 'due_at', 'is_published')
    list_filter = ('is_published', 'accepts_text', 'accepts_file', 'accepts_code')
    search_fields = ('title', 'module__title')


@admin.register(ModuleActivitySubmission)
class ModuleActivitySubmissionAdmin(admin.ModelAdmin):
    list_display = ('activity', 'student', 'score', 'submitted_at', 'graded_at')
    list_filter = ('activity__module',)
    search_fields = ('activity__title', 'student__username')
