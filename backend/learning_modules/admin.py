from django.contrib import admin

from .models import (
    Module,
    ModuleAccess,
    ModuleActivity,
    ModuleActivityAnswer,
    ModuleActivityAttempt,
    ModuleActivityExtension,
    ModuleActivityMatchingPair,
    ModuleActivityQuestion,
    ModuleActivityQuestionChoice,
    ModuleActivitySubmission,
    ModuleLesson,
    ModuleLessonAsset,
    ModuleLessonExample,
    ModuleLessonProgress,
    ModuleProgress,
    ModuleTopic,
    ModuleTopicProgress,
)


@admin.register(Module)
class ModuleAdmin(admin.ModelAdmin):
    list_display = (
        'title',
        'subject',
        'is_published',
        'created_at',
    )
    list_filter = ('is_published', 'subject', 'subjects')
    search_fields = (
        'title',
        'description',
        'learning_objectives',
        'lesson_overview',
        'detailed_discussion',
        'examples',
        'teacher_notes',
        'student_activities',
        'resources',
    )
    prepopulated_fields = {'slug': ('title',)}
    exclude = (
        'content',
        'detailed_discussion',
        'examples',
        'teacher_notes',
        'student_activities',
    )


@admin.register(ModuleTopic)
class ModuleTopicAdmin(admin.ModelAdmin):
    list_display = (
        'title',
        'module',
        'competency_code',
        'unit',
        'order',
        'is_published',
        'pdf_generated_at',
        'pdf_is_outdated',
    )
    list_filter = ('is_published', 'pdf_is_outdated', 'module')
    search_fields = (
        'title',
        'competency_code',
        'competency_text',
        'unit',
        'overview',
        'essential_question',
        'enduring_understanding',
        'performance_task',
        'success_criteria',
        'values_focus',
    )
    autocomplete_fields = ('module', 'legacy_module')


@admin.register(ModuleLesson)
class ModuleLessonAdmin(admin.ModelAdmin):
    list_display = (
        'title',
        'topic',
        'order',
        'is_published',
        'created_at',
    )
    list_filter = ('is_published', 'topic__module')
    search_fields = (
        'title',
        'objectives',
        'subtopics',
        'acquisition',
        'making_meaning',
        'transfer',
        'answer_key',
        'expected_outputs',
        'common_misconceptions',
        'teaching_tips',
        'remediation',
        'enrichment',
        'resources',
    )
    autocomplete_fields = ('topic',)


@admin.register(ModuleLessonExample)
class ModuleLessonExampleAdmin(admin.ModelAdmin):
    list_display = ('title', 'lesson', 'order', 'is_published', 'created_at')
    list_filter = ('is_published', 'lesson__topic__module')
    search_fields = ('title', 'alt_text', 'body', 'lesson__title')
    autocomplete_fields = ('lesson',)


@admin.register(ModuleLessonAsset)
class ModuleLessonAssetAdmin(admin.ModelAdmin):
    list_display = ('original_name', 'lesson', 'alt_text', 'created_at')
    list_filter = ('lesson__topic__module',)
    search_fields = ('original_name', 'alt_text', 'lesson__title')
    autocomplete_fields = ('lesson',)


@admin.register(ModuleAccess)
class ModuleAccessAdmin(admin.ModelAdmin):
    list_display = (
        'module',
        'student',
        'access_type',
        'is_active',
        'expires_at',
        'activated_by',
        'activated_at',
    )
    list_filter = ('access_type', 'is_active', 'module')
    search_fields = (
        'module__title',
        'student__username',
        'student__first_name',
        'student__last_name',
    )
    autocomplete_fields = ('module', 'student', 'activated_by')


@admin.register(ModuleActivity)
class ModuleActivityAdmin(admin.ModelAdmin):
    list_display = ('title', 'module', 'topic', 'lesson', 'grading_period', 'activity_type', 'order', 'points_possible', 'due_at', 'is_published')
    list_filter = ('grading_period', 'activity_type', 'is_published', 'accepts_text', 'accepts_file', 'topic')
    search_fields = ('title', 'module__title', 'topic__title', 'lesson__title')


class ModuleActivityQuestionChoiceInline(admin.TabularInline):
    model = ModuleActivityQuestionChoice
    extra = 0


class ModuleActivityMatchingPairInline(admin.TabularInline):
    model = ModuleActivityMatchingPair
    extra = 0


@admin.register(ModuleActivityQuestion)
class ModuleActivityQuestionAdmin(admin.ModelAdmin):
    list_display = ('activity', 'question_type', 'order', 'points', 'is_published')
    list_filter = ('question_type', 'is_published', 'activity__module')
    search_fields = ('prompt', 'activity__title', 'activity__lesson__title')
    inlines = (ModuleActivityQuestionChoiceInline, ModuleActivityMatchingPairInline)


@admin.register(ModuleActivityQuestionChoice)
class ModuleActivityQuestionChoiceAdmin(admin.ModelAdmin):
    list_display = ('question', 'text', 'is_correct', 'order')
    list_filter = ('is_correct', 'question__question_type')
    search_fields = ('text', 'question__prompt')


@admin.register(ModuleActivityMatchingPair)
class ModuleActivityMatchingPairAdmin(admin.ModelAdmin):
    list_display = ('question', 'left_text', 'right_text', 'order')
    search_fields = ('left_text', 'right_text', 'question__prompt')


@admin.register(ModuleActivityAttempt)
class ModuleActivityAttemptAdmin(admin.ModelAdmin):
    list_display = ('activity', 'student', 'attempt_number', 'score', 'max_score', 'status', 'started_at')
    list_filter = ('status', 'activity__module')
    search_fields = ('activity__title', 'student__username')


@admin.register(ModuleActivityExtension)
class ModuleActivityExtensionAdmin(admin.ModelAdmin):
    list_display = ('activity', 'student', 'due_at', 'granted_by', 'updated_at')
    list_filter = ('activity__module', 'due_at')
    search_fields = ('activity__title', 'student__username', 'student__first_name', 'student__middle_name', 'student__last_name')
    autocomplete_fields = ('activity', 'student', 'granted_by')


@admin.register(ModuleActivityAnswer)
class ModuleActivityAnswerAdmin(admin.ModelAdmin):
    list_display = ('attempt', 'question', 'is_correct', 'points_earned')
    list_filter = ('is_correct', 'question__question_type')
    search_fields = ('question__prompt', 'attempt__student__username')


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


@admin.register(ModuleTopicProgress)
class ModuleTopicProgressAdmin(admin.ModelAdmin):
    list_display = ('topic', 'student', 'started_at', 'completed_at')
    list_filter = ('topic', 'completed_at')
    search_fields = ('topic__title', 'student__username')


@admin.register(ModuleLessonProgress)
class ModuleLessonProgressAdmin(admin.ModelAdmin):
    list_display = (
        'lesson',
        'student',
        'started_at',
        'last_viewed_at',
        'completed_at',
    )
    list_filter = ('lesson__topic__module', 'completed_at')
    search_fields = ('lesson__title', 'student__username')
