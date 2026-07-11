import hashlib

from django.db import models
from rest_framework import serializers
from django.utils import timezone

from .models import (
    Module,
    ModuleAccess,
    ModuleActivity,
    ModuleActivityAnswer,
    ModuleActivityAttempt,
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
    add_calendar_months,
    user_has_module_access,
    user_has_module_class_access,
)


def activity_review_unlocked_for_user(user, activity):
    if not user or user.is_anonymous or user.is_admin_teacher or not activity:
        return bool(user and not user.is_anonymous and user.is_admin_teacher)

    submitted_attempts = ModuleActivityAttempt.objects.filter(
        activity=activity,
        student=user,
        is_submitted=True,
    )
    if submitted_attempts.filter(score__isnull=False, max_score__gt=0, score__gte=models.F('max_score')).exists():
        return True
    return submitted_attempts.count() >= activity.max_attempts


def student_can_review_activity(request, activity):
    if not request:
        return False
    return activity_review_unlocked_for_user(request.user, activity)


def masked_choice_order(choice):
    digest = hashlib.sha256(
        f'{choice.question_id}:{choice.id}:{choice.text}'.encode('utf-8'),
    ).hexdigest()
    return int(digest[:8], 16)


def masked_pair_order(pair):
    digest = hashlib.sha256(
        f'{pair.question_id}:{pair.id}:{pair.left_text}'.encode('utf-8'),
    ).hexdigest()
    return int(digest[:8], 16)


class ModuleSerializer(serializers.ModelSerializer):
    is_accessible = serializers.SerializerMethodField()
    access_status = serializers.SerializerMethodField()
    has_pdf = serializers.SerializerMethodField()

    class Meta:
        model = Module
        fields = (
            'id',
            'title',
            'slug',
            'subject',
            'description',
            'content',
            'learning_objectives',
            'lesson_overview',
            'detailed_discussion',
            'examples',
            'teacher_notes',
            'student_activities',
            'resources',
            'pdf_file',
            'pdf_generated_at',
            'pdf_is_outdated',
            'is_paid',
            'price',
            'is_accessible',
            'access_status',
            'has_pdf',
            'subjects',
            'is_published',
            'created_at',
            'updated_at',
        )
        read_only_fields = (
            'id',
            'is_accessible',
            'access_status',
            'has_pdf',
            'pdf_generated_at',
            'pdf_is_outdated',
            'created_at',
            'updated_at',
        )

    def get_is_accessible(self, obj):
        request = self.context.get('request')

        if not request or request.user.is_admin_teacher:
            return True

        return user_has_module_access(request.user, obj)

    def get_access_status(self, obj):
        request = self.context.get('request')
        if not request or request.user.is_admin_teacher:
            return 'ADMIN'
        grant = obj.access_grants.filter(
            student=request.user,
            is_active=True,
            activated_by__isnull=False,
            payment_status=ModuleAccess.PaymentStatus.PAID,
            expires_at__gt=timezone.now(),
        ).order_by('-updated_at').first()
        if not grant:
            return 'LOCKED'
        return (
            'ADVANCE_PAID'
            if grant.access_type == ModuleAccess.AccessType.ADVANCE_STUDY
            else 'ENROLLED_PAID'
        )

    def get_has_pdf(self, obj):
        return bool(obj.pdf_file)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher:
            for field in (
                'content',
                'learning_objectives',
                'lesson_overview',
                'detailed_discussion',
                'examples',
                'teacher_notes',
                'student_activities',
                'resources',
                'pdf_file',
            ):
                data.pop(field, None)
        return data


class ModuleAccessSerializer(serializers.ModelSerializer):
    module_title = serializers.CharField(source='module.title', read_only=True)
    student_name = serializers.SerializerMethodField()
    activated_by_name = serializers.SerializerMethodField()
    is_available = serializers.BooleanField(read_only=True)

    class Meta:
        model = ModuleAccess
        fields = (
            'id',
            'module',
            'module_title',
            'student',
            'student_name',
            'activated_by',
            'activated_by_name',
            'access_type',
            'payment_status',
            'amount_paid',
            'payment_reference',
            'is_active',
            'is_available',
            'expires_at',
            'notes',
            'activated_at',
            'updated_at',
        )
        read_only_fields = (
            'id',
            'activated_by',
            'activated_at',
            'updated_at',
            'is_available',
        )

    def get_student_name(self, obj):
        return obj.student.get_full_name() or obj.student.username

    def get_activated_by_name(self, obj):
        if not obj.activated_by:
            return ''

        return obj.activated_by.get_full_name() or obj.activated_by.username

    def validate_student(self, value):
        if value.role != value.Role.STUDENT:
            raise serializers.ValidationError('Only student users can receive module access.')

        return value

    def validate(self, attrs):
        request = self.context.get('request')
        module = attrs.get('module') or getattr(self.instance, 'module', None)
        student = attrs.get('student') or getattr(self.instance, 'student', None)
        if module and student:
            attrs['access_type'] = (
                ModuleAccess.AccessType.PAYMENT
                if user_has_module_class_access(student, module)
                else ModuleAccess.AccessType.ADVANCE_STUDY
            )

        attrs['payment_status'] = ModuleAccess.PaymentStatus.PAID
        if module and 'amount_paid' not in attrs:
            attrs['amount_paid'] = module.price

        renewing = (
            self.instance
            and (
                not self.instance.is_active
                or not self.instance.expires_at
                or self.instance.expires_at <= timezone.now()
            )
            and attrs.get('is_active', True)
        )
        if 'expires_at' not in attrs and (not self.instance or renewing):
            attrs['expires_at'] = add_calendar_months(timezone.now(), 5)

        if request and not request.user.is_admin_teacher:
            raise serializers.ValidationError('Only teachers can activate module access.')
        return attrs


class ModuleTopicSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleTopic
        fields = (
            'id',
            'module',
            'legacy_module',
            'title',
            'order',
            'competency_code',
            'competency_text',
            'unit',
            'overview',
            'essential_question',
            'enduring_understanding',
            'performance_task',
            'success_criteria',
            'values_focus',
            'is_published',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'legacy_module', 'created_at', 'updated_at')


class ModuleLessonSerializer(serializers.ModelSerializer):
    has_pdf = serializers.SerializerMethodField()

    class Meta:
        model = ModuleLesson
        fields = (
            'id',
            'topic',
            'title',
            'order',
            'learning_targets',
            'key_terms',
            'before_you_start',
            'short_discussion',
            'guided_examples',
            'lets_practice',
            'apply_what_you_learned',
            'challenge_task',
            'rubric',
            'reflection',
            'evidence_of_learning',
            'objectives',
            'overview',
            'subtopics',
            'acquisition',
            'making_meaning',
            'transfer',
            'examples',
            'teacher_notes',
            'answer_key',
            'expected_outputs',
            'common_misconceptions',
            'teaching_tips',
            'remediation',
            'enrichment',
            'student_activities',
            'resources',
            'assessment_url',
            'pdf_file',
            'pdf_generated_at',
            'pdf_is_outdated',
            'has_pdf',
            'is_published',
            'created_at',
            'updated_at',
        )
        read_only_fields = (
            'id',
            'created_at',
            'updated_at',
            'has_pdf',
            'pdf_generated_at',
            'pdf_is_outdated',
        )

    def get_has_pdf(self, obj):
        return bool(obj.pdf_file)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')

        if request and not request.user.is_admin_teacher:
            for field in (
                'acquisition',
                'making_meaning',
                'transfer',
                'teacher_notes',
                'answer_key',
                'expected_outputs',
                'common_misconceptions',
                'teaching_tips',
                'remediation',
                'enrichment',
            ):
                data.pop(field, None)

        return data


class ModuleLessonProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleLessonProgress
        fields = (
            'id',
            'lesson',
            'student',
            'started_at',
            'last_viewed_at',
            'completed_at',
        )
        read_only_fields = ('id', 'started_at', 'last_viewed_at')

    def validate_student(self, value):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and value != request.user:
            raise serializers.ValidationError(
                'Students can only update their own lesson progress.'
            )
        return value

    def validate(self, attrs):
        request = self.context.get('request')
        if self.instance:
            lesson = attrs.get('lesson')
            student = attrs.get('student')
            if lesson and lesson != self.instance.lesson:
                raise serializers.ValidationError(
                    {'lesson': 'A progress record cannot be moved to another lesson.'}
                )
            if student and student != self.instance.student:
                raise serializers.ValidationError(
                    {'student': 'A progress record cannot be moved to another student.'}
                )

        if request and not request.user.is_admin_teacher:
            lesson = attrs.get('lesson') or getattr(self.instance, 'lesson', None)
            if lesson and not user_has_module_access(request.user, lesson.topic.module):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
                )
            if lesson and attrs.get('completed_at'):
                main_activity = ModuleActivity.objects.filter(
                    lesson=lesson,
                    activity_type=ModuleActivity.ActivityType.INTERACTIVE,
                    is_published=True,
                ).first()
                if main_activity and not ModuleActivityAttempt.objects.filter(
                    activity=main_activity,
                    student=request.user,
                    is_submitted=True,
                ).exists():
                    raise serializers.ValidationError(
                        'Finish the Main Activity before marking this lesson complete.'
                    )
        return attrs


class ModuleLessonExampleSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleLessonExample
        fields = (
            'id',
            'lesson',
            'order',
            'title',
            'image',
            'alt_text',
            'body',
            'common_mistake',
            'mini_check',
            'is_published',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at')

    def validate_image(self, value):
        if not value:
            return value

        if not value.name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.svg')):
            raise serializers.ValidationError(
                'Upload a PNG, JPG, WebP, or SVG example image.',
            )
        return value


class ModuleLessonAssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleLessonAsset
        fields = (
            'id',
            'lesson',
            'file',
            'original_name',
            'alt_text',
            'created_at',
        )
        read_only_fields = ('id', 'created_at')

    def validate_file(self, value):
        if not value.name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp', '.svg')):
            raise serializers.ValidationError(
                'Upload a PNG, JPG, WebP, or SVG lesson asset.',
            )
        return value


class ModuleActivitySerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleActivity
        fields = (
            'id',
            'module',
            'topic',
            'lesson',
            'programming_problem',
            'title',
            'instructions',
            'activity_type',
            'order',
            'points_possible',
            'due_at',
            'accepts_text',
            'accepts_file',
            'accepts_code',
            'max_attempts',
            'passing_score',
            'is_published',
            'created_at',
        )
        read_only_fields = ('id', 'created_at')

    def validate(self, attrs):
        lesson = attrs.get('lesson') or getattr(self.instance, 'lesson', None)
        if lesson:
            attrs['module'] = lesson.topic.module
            attrs['topic'] = lesson.topic
            attrs['activity_type'] = ModuleActivity.ActivityType.INTERACTIVE
            attrs['accepts_text'] = False
            attrs['accepts_file'] = False
            attrs['accepts_code'] = False
        return attrs


class ModuleActivitySubmissionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleActivitySubmission
        fields = (
            'id',
            'activity',
            'student',
            'text_answer',
            'file',
            'code',
            'score',
            'feedback',
            'submitted_at',
            'graded_at',
        )
        read_only_fields = ('id', 'submitted_at')

    def validate_student(self, value):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and value != request.user:
            raise serializers.ValidationError('Students can only submit as themselves.')

        return value

    def validate(self, attrs):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher:
            restricted_fields = {'score', 'feedback', 'graded_at'}
            submitted_restricted_fields = restricted_fields.intersection(self.initial_data)

            if submitted_restricted_fields:
                raise serializers.ValidationError(
                    'Students cannot set grading fields.'
                )

            activity = attrs.get('activity') or getattr(self.instance, 'activity', None)

            if activity and not user_has_module_access(request.user, activity.module):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
                )

        return attrs


class ModuleActivityQuestionSerializer(serializers.ModelSerializer):
    matching_options = serializers.SerializerMethodField()

    class Meta:
        model = ModuleActivityQuestion
        fields = (
            'id',
            'activity',
            'question_type',
            'prompt',
            'points',
            'order',
            'explanation',
            'correct_text_answers',
            'case_sensitive',
            'code_snippet',
            'expected_output',
            'matching_options',
            'is_published',
        )
        read_only_fields = ('id', 'matching_options')

    def get_matching_options(self, obj):
        return [
            pair.right_text
            for pair in obj.matching_pairs.all().order_by('right_text', 'id')
        ]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and not student_can_review_activity(
            request,
            instance.activity,
        ):
            data.pop('explanation', None)
            data.pop('correct_text_answers', None)
            data.pop('expected_output', None)
        return data

    def validate(self, attrs):
        request = self.context.get('request')
        activity = attrs.get('activity') or getattr(self.instance, 'activity', None)
        if request and not request.user.is_admin_teacher:
            raise serializers.ValidationError('Only teachers can edit activity questions.')
        if activity and activity.activity_type != ModuleActivity.ActivityType.INTERACTIVE:
            raise serializers.ValidationError(
                'Interactive questions can only be added to an interactive activity.'
            )
        return attrs


class ModuleActivityQuestionChoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleActivityQuestionChoice
        fields = ('id', 'question', 'text', 'is_correct', 'order')
        read_only_fields = ('id',)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher:
            can_review = student_can_review_activity(request, instance.question.activity)
            if (
                not can_review
                and instance.question.question_type
                == ModuleActivityQuestion.QuestionType.ORDERING
            ):
                data['order'] = masked_choice_order(instance)
            if not can_review:
                data.pop('is_correct', None)
        return data

    def validate(self, attrs):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher:
            raise serializers.ValidationError('Only teachers can edit activity choices.')
        return attrs


class ModuleActivityMatchingPairSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleActivityMatchingPair
        fields = ('id', 'question', 'left_text', 'right_text', 'order')
        read_only_fields = ('id',)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher:
            can_review = student_can_review_activity(request, instance.question.activity)
            if not can_review:
                data['order'] = masked_pair_order(instance)
                data.pop('right_text', None)
        return data

    def validate(self, attrs):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher:
            raise serializers.ValidationError('Only teachers can edit matching pairs.')
        return attrs


class ModuleActivityAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleActivityAttempt
        fields = (
            'id',
            'activity',
            'student',
            'attempt_number',
            'score',
            'max_score',
            'started_at',
            'submitted_at',
            'is_submitted',
        )
        read_only_fields = ('id', 'score', 'max_score', 'started_at', 'submitted_at', 'is_submitted')
        validators = []

    def validate_student(self, value):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and value != request.user:
            raise serializers.ValidationError('Students can only start their own attempts.')
        return value

    def validate(self, attrs):
        request = self.context.get('request')
        activity = attrs.get('activity') or getattr(self.instance, 'activity', None)

        if self.instance and self.instance.is_submitted and request and not request.user.is_admin_teacher:
            raise serializers.ValidationError('Submitted attempts cannot be edited.')

        if request and not request.user.is_admin_teacher:
            restricted_fields = {'score', 'max_score', 'submitted_at', 'is_submitted'}
            if restricted_fields.intersection(self.initial_data):
                raise serializers.ValidationError('Students cannot set grading fields.')

            if activity and not user_has_module_access(request.user, activity.module):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
                )

            if activity and (
                not activity.is_published
                or activity.activity_type != ModuleActivity.ActivityType.INTERACTIVE
                or not activity.lesson
                or not activity.lesson.is_published
                or not activity.lesson.topic.is_published
                or not activity.module.is_published
            ):
                raise serializers.ValidationError('This activity is not available.')

            if not self.instance and activity:
                existing_count = ModuleActivityAttempt.objects.filter(
                    activity=activity,
                    student=request.user,
                ).count()
                if existing_count >= activity.max_attempts:
                    raise serializers.ValidationError(
                        'You have reached the maximum number of attempts.'
                    )
                attrs['attempt_number'] = existing_count + 1

        return attrs


class ModuleActivityAnswerSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleActivityAnswer
        fields = (
            'id',
            'attempt',
            'question',
            'selected_choice',
            'text_answer',
            'choice_order',
            'matching_answer',
            'is_correct',
            'points_earned',
            'feedback',
        )
        read_only_fields = ('id',)

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and not student_can_review_activity(
            request,
            instance.attempt.activity,
        ):
            data.pop('is_correct', None)
            data.pop('points_earned', None)
            data.pop('feedback', None)
        return data

    def validate(self, attrs):
        request = self.context.get('request')
        attempt = attrs.get('attempt') or getattr(self.instance, 'attempt', None)
        question = attrs.get('question') or getattr(self.instance, 'question', None)
        selected_choice = attrs.get('selected_choice') or getattr(
            self.instance,
            'selected_choice',
            None,
        )

        if attempt and question and attempt.activity_id != question.activity_id:
            raise serializers.ValidationError(
                'Answer must belong to a question in the same activity attempt.'
            )
        if selected_choice and question and selected_choice.question_id != question.id:
            raise serializers.ValidationError(
                'Selected choice must belong to the answered question.'
            )

        if request and not request.user.is_admin_teacher:
            if attempt and attempt.student_id != request.user.id:
                raise serializers.ValidationError('Students can only answer their own attempts.')
            if attempt and attempt.is_submitted:
                raise serializers.ValidationError('Submitted attempts cannot be edited.')
            if question and not question.is_published:
                raise serializers.ValidationError('This question is not available.')

            restricted_fields = {'is_correct', 'points_earned', 'feedback'}
            if restricted_fields.intersection(self.initial_data):
                raise serializers.ValidationError('Students cannot set grading fields.')

        return attrs


class ModuleProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleProgress
        fields = (
            'id',
            'module',
            'student',
            'started_at',
            'completed_at',
        )
        read_only_fields = ('id', 'started_at', 'completed_at')

    def validate_student(self, value):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and value != request.user:
            raise serializers.ValidationError('Students can only create progress as themselves.')

        return value

    def validate(self, attrs):
        request = self.context.get('request')

        if request and not request.user.is_admin_teacher:
            module = attrs.get('module') or getattr(self.instance, 'module', None)

            if module and not user_has_module_access(request.user, module):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
                )

        return attrs


class ModuleTopicProgressSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModuleTopicProgress
        fields = (
            'id',
            'topic',
            'student',
            'started_at',
            'completed_at',
        )
        read_only_fields = ('id', 'started_at', 'completed_at')

    def validate_student(self, value):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and value != request.user:
            raise serializers.ValidationError('Students can only create progress as themselves.')

        return value

    def validate(self, attrs):
        request = self.context.get('request')

        if request and not request.user.is_admin_teacher:
            topic = attrs.get('topic') or getattr(self.instance, 'topic', None)

            if topic and not user_has_module_access(request.user, topic.module):
                raise serializers.ValidationError(
                    'This module has not been activated for your account.'
                )

        return attrs
