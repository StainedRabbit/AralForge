import hashlib

from django.contrib.auth import get_user_model
from django.db import models
from rest_framework import serializers
from django.utils import timezone

from grades.models import GradeItem, GradeItemSourceType
from subjects.models import ScheduleStudent

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
    add_calendar_months,
    user_has_module_access,
    user_has_module_class_access,
)
from .services.activity_snapshots import effective_activity_due_at, validate_activity_window


def activity_review_unlocked_for_user(user, activity):
    if not user or user.is_anonymous or user.is_admin_teacher or not activity:
        return bool(user and not user.is_anonymous and user.is_admin_teacher)

    submitted_attempts = ModuleActivityAttempt.objects.filter(
        activity=activity,
        student=user,
        is_submitted=True,
    )
    passing_score = activity.passing_score
    if passing_score is not None and submitted_attempts.filter(score__gte=passing_score).exists():
        return True
    if passing_score is None and submitted_attempts.filter(
        score__isnull=False,
        max_score__gt=0,
        score__gte=models.F('max_score'),
    ).exists():
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
            'before_you_start',
            'short_discussion',
            'guided_examples',
            'lets_practice',
            'challenge_task',
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
                qualifying_attempts = ModuleActivityAttempt.objects.filter(
                    activity=main_activity,
                    student=request.user,
                    is_submitted=True,
                ) if main_activity else ModuleActivityAttempt.objects.none()
                if main_activity and main_activity.passing_score is not None:
                    qualifying_attempts = qualifying_attempts.filter(
                        score__gte=main_activity.passing_score,
                    )
                if main_activity and not qualifying_attempts.exists():
                    raise serializers.ValidationError(
                        'Pass the Main Activity before marking this lesson complete.'
                        if main_activity.passing_score is not None
                        else 'Finish the Main Activity before marking this lesson complete.'
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
    effective_due_at = serializers.SerializerMethodField()

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
            'opens_at',
            'due_at',
            'effective_due_at',
            'allow_late_submissions',
            'accepts_text',
            'accepts_file',
            'accepts_code',
            'max_attempts',
            'passing_score',
            'is_published',
            'created_at',
        )
        read_only_fields = ('id', 'created_at', 'effective_due_at')

    def get_effective_due_at(self, obj):
        request = self.context.get('request')
        if not request or request.user.is_anonymous or request.user.is_admin_teacher:
            return obj.due_at
        return effective_activity_due_at(obj, request.user)

    def validate(self, attrs):
        lesson = attrs.get('lesson') or getattr(self.instance, 'lesson', None)
        if lesson:
            attrs['module'] = lesson.topic.module
            attrs['topic'] = lesson.topic
            attrs['activity_type'] = ModuleActivity.ActivityType.INTERACTIVE
            attrs['accepts_text'] = False
            attrs['accepts_file'] = False
            attrs['accepts_code'] = False
        points_possible = attrs.get(
            'points_possible',
            getattr(self.instance, 'points_possible', None),
        )
        passing_score = attrs.get(
            'passing_score',
            getattr(self.instance, 'passing_score', None),
        )
        opens_at = attrs.get('opens_at', getattr(self.instance, 'opens_at', None))
        due_at = attrs.get('due_at', getattr(self.instance, 'due_at', None))
        if passing_score is not None and points_possible is not None and passing_score > points_possible:
            raise serializers.ValidationError({
                'passing_score': 'Passing score cannot exceed points possible.',
            })
        if passing_score is not None and passing_score < 0:
            raise serializers.ValidationError({
                'passing_score': 'Passing score cannot be negative.',
            })
        if opens_at and due_at and opens_at >= due_at:
            raise serializers.ValidationError({
                'due_at': 'Due date must be after the opening date.',
            })
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
    question_snapshot = serializers.SerializerMethodField()
    draft_answers = serializers.SerializerMethodField()
    class Meta:
        model = ModuleActivityAttempt
        fields = (
            'id',
            'activity',
            'student',
            'submission_method',
            'recorded_by',
            'paper_grade_item',
            'attempt_number',
            'score',
            'max_score',
            'started_at',
            'submitted_at',
            'is_submitted',
            'question_snapshot',
            'draft_answers',
        )
        read_only_fields = (
            'id',
            'submission_method',
            'recorded_by',
            'paper_grade_item',
            'score',
            'max_score',
            'started_at',
            'submitted_at',
            'is_submitted',
            'question_snapshot',
            'draft_answers',
        )
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

            if activity:
                validate_activity_window(activity, request.user)

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
                if ModuleActivityAttempt.objects.filter(
                    activity=activity,
                    student=request.user,
                    submission_method=ModuleActivityAttempt.SubmissionMethod.PAPER,
                    is_submitted=True,
                ).exists():
                    raise serializers.ValidationError(
                        'A paper submission has already been recorded for this activity.'
                    )
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

    def get_question_snapshot(self, obj):
        snapshot = obj.question_snapshot or []
        request = self.context.get('request')
        if not request or request.user.is_admin_teacher or student_can_review_activity(
            request,
            obj.activity,
        ):
            return snapshot
        redacted = []
        for question in snapshot:
            safe = dict(question)
            safe.pop('explanation', None)
            safe.pop('correct_text_answers', None)
            safe.pop('expected_output', None)
            choices = []
            for choice in safe.get('choices', []):
                visible_choice = dict(choice)
                visible_choice.pop('is_correct', None)
                choices.append(visible_choice)
            if safe.get('question_type') == ModuleActivityQuestion.QuestionType.ORDERING:
                choices.sort(key=lambda choice: hashlib.sha256(
                    f"snapshot:{safe.get('id')}:{choice.get('id')}:{choice.get('text')}".encode('utf-8'),
                ).hexdigest())
            safe['choices'] = choices
            original_pairs = safe.get('matching_pairs', [])
            safe['matching_options'] = sorted(
                str(pair.get('right_text') or '') for pair in original_pairs
            )
            pairs = []
            for pair in original_pairs:
                visible_pair = dict(pair)
                visible_pair.pop('right_text', None)
                pairs.append(visible_pair)
            safe['matching_pairs'] = pairs
            redacted.append(safe)
        return redacted

    def get_draft_answers(self, obj):
        answers = obj.draft_answers or {}
        request = self.context.get('request')
        if not request or request.user.is_admin_teacher or student_can_review_activity(
            request,
            obj.activity,
        ):
            return answers
        return {
            question_id: {
                key: value
                for key, value in answer.items()
                if key not in {'is_correct', 'points_earned', 'feedback'}
            }
            for question_id, answer in answers.items()
        }


class ModuleActivityExtensionSerializer(serializers.ModelSerializer):
    student_name = serializers.SerializerMethodField()

    class Meta:
        model = ModuleActivityExtension
        fields = ('id', 'activity', 'student', 'student_name', 'due_at', 'created_at', 'updated_at')
        read_only_fields = ('id', 'activity', 'student_name', 'created_at', 'updated_at')

    def get_student_name(self, obj):
        full_name = obj.student.get_full_name().strip()
        return full_name or obj.student.username


class PaperActivityScoreRowSerializer(serializers.Serializer):
    student = serializers.PrimaryKeyRelatedField(queryset=get_user_model().objects.all())
    score = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0)


class PaperActivityScoreBatchSerializer(serializers.Serializer):
    grade_item = serializers.PrimaryKeyRelatedField(
        queryset=GradeItem.objects.select_related(
            'schedule',
            'grade_category',
            'module_activity',
        ),
    )
    scores = PaperActivityScoreRowSerializer(many=True, allow_empty=False)

    def validate(self, attrs):
        item = attrs['grade_item']
        activity = validate_paper_score_item(item)
        rows = attrs['scores']
        student_ids = [row['student'].id for row in rows]
        if len(student_ids) != len(set(student_ids)):
            raise serializers.ValidationError({
                'scores': 'Each student may appear only once in a paper-score batch.',
            })

        active_student_ids = set(
            ScheduleStudent.objects.filter(
                schedule=item.schedule,
                student_id__in=student_ids,
                is_active=True,
            ).values_list('student_id', flat=True)
        )
        online_student_ids = set(
            ModuleActivityAttempt.objects.filter(
                activity=activity,
                student_id__in=student_ids,
                submission_method=ModuleActivityAttempt.SubmissionMethod.ONLINE,
                is_submitted=True,
            ).values_list('student_id', flat=True)
        )
        row_errors = {}
        for index, row in enumerate(rows):
            errors = {}
            if row['student'].id not in active_student_ids:
                errors['student'] = 'This student is not actively enrolled in the selected class.'
            if row['student'].id in online_student_ids:
                errors['student'] = 'This student already submitted the Main Activity online.'
            if row['score'] > item.points_possible:
                errors['score'] = f'Score must be between 0 and {item.points_possible}.'
            if errors:
                row_errors[index] = errors
        if row_errors:
            raise serializers.ValidationError({'scores': row_errors})

        attrs['activity'] = activity
        return attrs


class PaperActivityScoreUpdateSerializer(serializers.Serializer):
    score = serializers.DecimalField(max_digits=7, decimal_places=2, min_value=0)

    def validate_score(self, value):
        attempt = self.context['attempt']
        item = attempt.paper_grade_item
        activity = validate_paper_score_item(item)
        if attempt.activity_id != activity.id:
            raise serializers.ValidationError(
                'This paper attempt does not belong to the linked Main Activity.'
            )
        if not ScheduleStudent.objects.filter(
            schedule=item.schedule,
            student=attempt.student,
            is_active=True,
        ).exists():
            raise serializers.ValidationError(
                'This student is not actively enrolled in the selected class.'
            )
        if value > item.points_possible:
            raise serializers.ValidationError(
                f'Score must be between 0 and {item.points_possible}.'
            )
        if ModuleActivityAttempt.objects.filter(
            activity=attempt.activity,
            student=attempt.student,
            submission_method=ModuleActivityAttempt.SubmissionMethod.ONLINE,
            is_submitted=True,
        ).exclude(pk=attempt.pk).exists():
            raise serializers.ValidationError(
                'This student already submitted the Main Activity online.'
            )
        return value


def validate_paper_score_item(item):
    activity = item.module_activity if item else None
    if not item or item.source_type != GradeItemSourceType.MODULE_ACTIVITY or not activity:
        raise serializers.ValidationError({
            'grade_item': 'Select a grade item linked to a Main Activity.',
        })
    if not item.schedule_id or not item.schedule.is_active:
        raise serializers.ValidationError({
            'grade_item': 'Paper scores require an active class assignment.',
        })
    if (
        activity.activity_type != ModuleActivity.ActivityType.INTERACTIVE
        or not activity.lesson_id
        or not activity.is_published
    ):
        raise serializers.ValidationError({
            'grade_item': 'The linked Main Activity must be published and interactive.',
        })
    return activity


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
            if attempt:
                validate_activity_window(attempt.activity, request.user)
            if question and not question.is_published:
                raise serializers.ValidationError('This question is not available.')

            restricted_fields = {'is_correct', 'points_earned', 'feedback'}
            if restricted_fields.intersection(self.initial_data):
                raise serializers.ValidationError('Students cannot set grading fields.')

        if (
            request
            and request.user.is_admin_teacher
            and attempt
            and attempt.submission_method == ModuleActivityAttempt.SubmissionMethod.PAPER
        ):
            raise serializers.ValidationError(
                'Paper scores do not expose editable answer records.'
            )

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
