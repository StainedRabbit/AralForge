from django.contrib import admin

from .models import CodeSubmission, ProgrammingProblem, TestCase


class TestCaseInline(admin.TabularInline):
    model = TestCase
    extra = 1


@admin.register(ProgrammingProblem)
class ProgrammingProblemAdmin(admin.ModelAdmin):
    list_display = ('title', 'difficulty', 'subject', 'module', 'points_possible', 'is_published')
    list_filter = ('difficulty', 'is_published', 'subject')
    search_fields = ('title', 'description')
    prepopulated_fields = {'slug': ('title',)}
    inlines = [TestCaseInline]


@admin.register(CodeSubmission)
class CodeSubmissionAdmin(admin.ModelAdmin):
    list_display = ('problem', 'student', 'language', 'status', 'score', 'submitted_at')
    list_filter = ('status', 'language', 'problem')
    search_fields = ('problem__title', 'student__username')
