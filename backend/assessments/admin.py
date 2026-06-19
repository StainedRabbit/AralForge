from django.contrib import admin

from .models import Answer, Assessment, AssessmentAttempt, AssessmentAttemptQuestion, Choice, Question


class ChoiceInline(admin.TabularInline):
    model = Choice
    extra = 2


@admin.register(Assessment)
class AssessmentAdmin(admin.ModelAdmin):
    list_display = ('title', 'kind', 'subject', 'points_possible', 'mock_question_count', 'counts_toward_grade', 'is_published')
    list_filter = ('kind', 'counts_toward_grade', 'is_published', 'subject')
    search_fields = ('title', 'instructions')


@admin.register(Question)
class QuestionAdmin(admin.ModelAdmin):
    list_display = ('assessment', 'question_type', 'points', 'order')
    list_filter = ('question_type', 'assessment__kind')
    search_fields = ('prompt', 'assessment__title')
    filter_horizontal = ('topics',)
    inlines = [ChoiceInline]


@admin.register(AssessmentAttempt)
class AssessmentAttemptAdmin(admin.ModelAdmin):
    list_display = ('assessment', 'student', 'attempt_number', 'score', 'is_submitted', 'started_at')
    list_filter = ('assessment__kind', 'is_submitted')
    search_fields = ('assessment__title', 'student__username')
    filter_horizontal = ('selected_topics',)


@admin.register(Answer)
class AnswerAdmin(admin.ModelAdmin):
    list_display = ('attempt', 'question', 'is_correct', 'points_earned')
    list_filter = ('is_correct',)


@admin.register(AssessmentAttemptQuestion)
class AssessmentAttemptQuestionAdmin(admin.ModelAdmin):
    list_display = ('attempt', 'question', 'order')
    list_filter = ('attempt__assessment__kind',)
    search_fields = ('attempt__assessment__title', 'question__prompt', 'attempt__student__username')
