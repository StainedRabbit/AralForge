from django.contrib import admin

from .models import CodeBlank, CodeBlankAnswer, CodeSubmission, ProgrammingProblem, TestCase


class TestCaseInline(admin.TabularInline):
    model = TestCase
    extra = 1


class CodeBlankInline(admin.TabularInline):
    model = CodeBlank
    extra = 1


@admin.register(ProgrammingProblem)
class ProgrammingProblemAdmin(admin.ModelAdmin):
    list_display = ('title', 'difficulty', 'subject', 'module', 'topic', 'lesson', 'points_possible', 'is_published')
    list_filter = ('difficulty', 'is_published', 'subject', 'module', 'topic', 'lesson')
    search_fields = ('title', 'description')
    prepopulated_fields = {'slug': ('title',)}
    inlines = [TestCaseInline, CodeBlankInline]


@admin.register(CodeSubmission)
class CodeSubmissionAdmin(admin.ModelAdmin):
    list_display = ('problem', 'student', 'language', 'status', 'score', 'submitted_at')
    list_filter = ('status', 'language', 'problem')
    search_fields = ('problem__title', 'student__username')


@admin.register(CodeBlank)
class CodeBlankAdmin(admin.ModelAdmin):
    list_display = ('problem', 'key', 'order', 'points')
    list_filter = ('problem',)
    search_fields = ('problem__title', 'key', 'prompt')


@admin.register(CodeBlankAnswer)
class CodeBlankAnswerAdmin(admin.ModelAdmin):
    list_display = ('submission', 'blank', 'is_correct', 'points_earned')
    list_filter = ('blank__problem', 'is_correct')
    search_fields = ('submission__student__username', 'blank__key', 'blank__problem__title')
