from decimal import Decimal, InvalidOperation

from django.http import FileResponse
from django.db import transaction
from django.db.models import Max, Prefetch
from django.utils import timezone
from rest_framework import decorators, permissions, response, serializers, status, viewsets
from rest_framework.exceptions import PermissionDenied

from accounts.serializers import UserSerializer
from accounts.permissions import IsAdminTeacherOrReadOnly
from assessments.models import Assessment
from assessments.serializers import AssessmentSerializer
from coding.models import ProgrammingProblem
from coding.serializers import ProgrammingProblemSerializer
from grades.models import GradeCategory, GradeItem
from grades.serializers import GradeCategorySerializer, GradeItemSerializer
from subjects.models import ScheduleStudent, Subject, SubjectSchedule
from subjects.serializers import (
    ScheduleStudentSerializer,
    SubjectScheduleSerializer,
    SubjectSerializer,
)

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
    active_module_access_filter,
    module_enrollment_filter,
    user_has_module_access,
    user_has_module_class_access,
)
from .serializers import (
    ModuleAccessSerializer,
    ModuleActivitySerializer,
    ModuleActivityAnswerSerializer,
    ModuleActivityAttemptSerializer,
    ModuleActivityAttemptSummarySerializer,
    ModuleActivityExtensionSerializer,
    ModuleActivityMatchingPairSerializer,
    ModuleActivityQuestionChoiceSerializer,
    ModuleActivityQuestionSerializer,
    ModuleActivitySubmissionSerializer,
    PaperActivityScoreBatchSerializer,
    PaperActivityScoreUpdateSerializer,
    ModuleLessonAssetSerializer,
    ModuleLessonSerializer,
    ModuleLessonExampleSerializer,
    ModuleLessonProgressSerializer,
    ModuleProgressSerializer,
    ModuleSerializer,
    ModuleTopicProgressSerializer,
    ModuleTopicSerializer,
)
from .services.activity_grading import submit_activity_attempt
from .services.activity_snapshots import (
    ensure_attempt_snapshot,
    normalize_draft_answers,
    validate_activity_window,
)
from .services.pdf_generation import generate_lesson_pdf, generate_module_pdf


def serialize_main_activity_editor_workspace(activity, request):
    if not activity:
        return {
            'activity': None,
            'questions': [],
            'choices': [],
            'matching_pairs': [],
            'linked_class_count': 0,
        }
    questions = list(
        activity.questions.prefetch_related('choices', 'matching_pairs').order_by('order', 'id'),
    )
    choices = [choice for question in questions for choice in question.choices.all()]
    matching_pairs = [
        pair for question in questions for pair in question.matching_pairs.all()
    ]
    context = {'request': request}
    return {
        'activity': ModuleActivitySerializer(activity, context=context).data,
        'questions': ModuleActivityQuestionSerializer(
            questions,
            many=True,
            context=context,
        ).data,
        'choices': ModuleActivityQuestionChoiceSerializer(
            choices,
            many=True,
            context=context,
        ).data,
        'matching_pairs': ModuleActivityMatchingPairSerializer(
            matching_pairs,
            many=True,
            context=context,
        ).data,
        'linked_class_count': GradeItem.objects.filter(
            module_activity=activity,
            schedule__isnull=False,
        ).values('schedule_id').distinct().count(),
    }


def validate_atomic_question(item, index, enforce_readiness=False):
    if not isinstance(item, dict):
        raise serializers.ValidationError({'questions': {index: 'Question must be an object.'}})
    question_type = item.get('question_type')
    valid_types = {choice for choice, _ in ModuleActivityQuestion.QuestionType.choices}
    if question_type not in valid_types:
        raise serializers.ValidationError({'questions': {index: 'Select a valid question type.'}})
    prompt = str(item.get('prompt') or '').strip()
    published = bool(item.get('is_published', True))
    if enforce_readiness and published and not prompt:
        raise serializers.ValidationError({'questions': {index: 'Question prompt is required.'}})
    try:
        points = Decimal(str(item.get('points') or '0'))
    except InvalidOperation as error:
        raise serializers.ValidationError({'questions': {index: 'Points must be a number.'}}) from error
    if points <= 0:
        raise serializers.ValidationError({'questions': {index: 'Points must be greater than zero.'}})

    choices = []
    for choice_index, choice in enumerate(item.get('choices') or []):
        text = str(choice.get('text') or '').strip()
        if text:
            choices.append({
                'text': text,
                'is_correct': bool(choice.get('is_correct', False)),
                'order': int(choice.get('order', choice_index)),
            })
    pairs = []
    for pair_index, pair in enumerate(item.get('matching_pairs') or []):
        left_text = str(pair.get('left_text') or '').strip()
        right_text = str(pair.get('right_text') or '').strip()
        if left_text or right_text:
            if not left_text or not right_text:
                raise serializers.ValidationError({
                    'questions': {index: 'Every matching pair needs both sides.'},
                })
            pairs.append({
                'left_text': left_text,
                'right_text': right_text,
                'order': int(pair.get('order', pair_index)),
            })

    if enforce_readiness and published and question_type in {
        ModuleActivityQuestion.QuestionType.MULTIPLE_CHOICE,
        ModuleActivityQuestion.QuestionType.TRUE_FALSE,
    }:
        if len(choices) < 2 or sum(choice['is_correct'] for choice in choices) != 1:
            raise serializers.ValidationError({
                'questions': {index: 'Published choice questions need at least two choices and exactly one correct answer.'},
            })
    if enforce_readiness and published and question_type == ModuleActivityQuestion.QuestionType.ORDERING and len(choices) < 2:
        raise serializers.ValidationError({'questions': {index: 'Ordering questions need at least two items.'}})
    correct_text_answers = [
        str(value).strip() for value in (item.get('correct_text_answers') or []) if str(value).strip()
    ]
    if enforce_readiness and published and question_type == ModuleActivityQuestion.QuestionType.FILL_BLANK and not correct_text_answers:
        raise serializers.ValidationError({'questions': {index: 'Fill blank questions need an accepted answer.'}})
    if enforce_readiness and published and question_type == ModuleActivityQuestion.QuestionType.MATCHING and len(pairs) < 2:
        raise serializers.ValidationError({'questions': {index: 'Matching questions need at least two complete pairs.'}})
    expected_output = str(item.get('expected_output') or '')
    if enforce_readiness and published and question_type == ModuleActivityQuestion.QuestionType.CODE_OUTPUT and not expected_output.strip():
        raise serializers.ValidationError({'questions': {index: 'Code output questions need an expected output.'}})

    return {
        'id': item.get('id'),
        'question_type': question_type,
        'prompt': prompt,
        'points': points,
        'order': int(item.get('order') or index + 1),
        'explanation': str(item.get('explanation') or ''),
        'correct_text_answers': correct_text_answers,
        'case_sensitive': bool(item.get('case_sensitive', False)),
        'code_snippet': str(item.get('code_snippet') or ''),
        'expected_output': expected_output,
        'is_published': published,
        'choices': choices,
        'matching_pairs': pairs,
    }


class ModuleViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]
    search_fields = ('title', 'description', 'slug')

    def get_queryset(self):
        queryset = Module.objects.select_related('subject').prefetch_related('subjects')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            is_published=True,
        ).filter(
            module_enrollment_filter(self.request.user)
            | active_module_access_filter(self.request.user),
        ).distinct()

    @decorators.action(
        detail=True,
        methods=['get'],
        permission_classes=[permissions.IsAuthenticated],
    )
    def workspace(self, request, pk=None):
        module = self.get_object()
        topics = ModuleTopic.objects.filter(module=module)
        lessons = ModuleLesson.objects.filter(topic__module=module)
        activities = ModuleActivity.objects.filter(module=module)
        if not request.user.is_admin_teacher:
            topics = topics.filter(is_published=True)
            lessons = lessons.filter(is_published=True, topic__is_published=True)
            activities = activities.filter(is_published=True)
            activities = activities.prefetch_related(Prefetch(
                'extensions',
                queryset=ModuleActivityExtension.objects.filter(student=request.user),
            ))
        examples = ModuleLessonExample.objects.filter(lesson__in=lessons)
        lesson_progress = ModuleLessonProgress.objects.filter(
            lesson__in=lessons, student=request.user,
        ) if not request.user.is_admin_teacher else ModuleLessonProgress.objects.none()
        attempts = ModuleActivityAttempt.objects.filter(
            activity__in=activities, student=request.user,
        ).defer(
            'question_snapshot', 'draft_answers',
        ) if not request.user.is_admin_teacher else ModuleActivityAttempt.objects.none()
        context = {'request': request}
        return response.Response({
            'module': ModuleSerializer(module, context=context).data,
            'topics': ModuleTopicSerializer(topics, many=True, context=context).data,
            'lessons': ModuleLessonSerializer(lessons, many=True, context=context).data,
            'lesson_examples': ModuleLessonExampleSerializer(examples, many=True, context=context).data,
            'lesson_progress': ModuleLessonProgressSerializer(lesson_progress, many=True, context=context).data,
            'activities': ModuleActivitySerializer(activities, many=True, context=context).data,
            'activity_attempts': ModuleActivityAttemptSummarySerializer(
                attempts,
                many=True,
                context=context,
            ).data,
            'assessments': AssessmentSerializer(
                Assessment.objects.filter(module=module), many=True, context=context,
            ).data,
            'problems': ProgrammingProblemSerializer(
                ProgrammingProblem.objects.filter(module=module).prefetch_related('test_cases', 'blanks'),
                many=True, context=context,
            ).data,
            'subjects': SubjectSerializer(
                Subject.objects.filter(modules=module) | Subject.objects.filter(learning_module=module),
                many=True, context=context,
            ).data,
        })

    @decorators.action(
        detail=True,
        methods=['get'],
        permission_classes=[permissions.IsAuthenticated],
        url_path='teacher-summary',
    )
    def teacher_summary(self, request, pk=None):
        if not request.user.is_admin_teacher:
            self.permission_denied(request)

        module = self.get_object()
        subject_ids = module_subject_ids(module)
        published_lessons = ModuleLesson.objects.filter(
            topic__module=module,
            topic__is_published=True,
            is_published=True,
        ).select_related('topic')
        published_activities = ModuleActivity.objects.filter(
            module=module,
            is_published=True,
        )
        active_enrollments = ScheduleStudent.objects.filter(
            is_active=True,
            schedule__is_active=True,
            schedule__subject_id__in=subject_ids,
            student__role='STUDENT',
        ).select_related('student', 'schedule', 'schedule__subject')
        grant_student_ids = ModuleAccess.objects.filter(
            module=module,
            student__role='STUDENT',
        ).values_list('student_id', flat=True)
        student_ids = set(
            active_enrollments.values_list('student_id', flat=True),
        ) | set(grant_student_ids)
        students = active_enrollments.model._meta.get_field(
            'student',
        ).remote_field.model.objects.filter(
            id__in=student_ids,
        ).order_by('last_name', 'first_name', 'username')

        enrollment_by_student = {}
        for enrollment in active_enrollments:
            enrollment_by_student.setdefault(enrollment.student_id, enrollment)

        lesson_ids = list(published_lessons.values_list('id', flat=True))
        activity_ids = list(published_activities.values_list('id', flat=True))
        now = timezone.now()
        rows = []

        for student in students:
            grants = list(
                ModuleAccess.objects.filter(
                    module=module,
                    student=student,
                ).order_by('-updated_at', '-activated_at'),
            )
            lesson_progress = list(
                ModuleLessonProgress.objects.filter(
                    lesson_id__in=lesson_ids,
                    student=student,
                ).select_related('lesson').order_by('-last_viewed_at'),
            )
            submissions = list(
                ModuleActivitySubmission.objects.filter(
                    activity_id__in=activity_ids,
                    student=student,
                ),
            )
            latest_grant = grants[0] if grants else None
            completed_count = sum(
                1 for progress in lesson_progress if progress.completed_at
            )
            started_count = len(lesson_progress)
            last_progress = lesson_progress[0] if lesson_progress else None
            submitted_count = len({submission.activity_id for submission in submissions})
            graded_count = sum(
                1
                for submission in submissions
                if submission.graded_at or submission.score is not None
            )
            ungraded_count = len(submissions) - graded_count
            enrollment = enrollment_by_student.get(student.id)

            rows.append({
                'student_id': student.id,
                'student_name': student.get_full_name() or student.username,
                'username': student.username,
                'email': student.email,
                'is_enrolled': enrollment is not None,
                'schedule_id': enrollment.schedule_id if enrollment else None,
                'schedule_display': (
                    f'{enrollment.schedule.subject.code} {enrollment.schedule.section}'.strip()
                    if enrollment
                    else ''
                ),
                'access_status': access_status_for_grants(grants, now),
                'access_expires_at': active_access_expiry(grants),
                'access_activated_at': latest_grant.activated_at if latest_grant else None,
                'lesson_progress': {
                    'started_count': started_count,
                    'completed_count': completed_count,
                    'total_count': len(lesson_ids),
                    'percent_complete': progress_percent(
                        completed_count,
                        len(lesson_ids),
                    ),
                    'last_viewed_at': (
                        last_progress.last_viewed_at
                        if last_progress
                        else None
                    ),
                    'last_viewed_lesson': (
                        last_progress.lesson.title
                        if last_progress
                        else ''
                    ),
                },
                'activity_submissions': {
                    'submitted_count': submitted_count,
                    'pending_count': max(len(activity_ids) - submitted_count, 0),
                    'graded_count': graded_count,
                    'ungraded_count': ungraded_count,
                    'total_count': len(activity_ids),
                },
            })

        summary = {
            'module': module.id,
            'module_title': module.title,
            'total_students': len(rows),
            'total_lessons': len(lesson_ids),
            'total_activities': len(activity_ids),
            'active_access_count': sum(
                1 for row in rows if row['access_status'] == 'ACTIVE'
            ),
            'locked_count': sum(
                1 for row in rows if row['access_status'] == 'LOCKED'
            ),
            'completed_count': sum(
                1
                for row in rows
                if row['lesson_progress']['total_count']
                and row['lesson_progress']['completed_count']
                == row['lesson_progress']['total_count']
            ),
            'ungraded_submission_count': sum(
                row['activity_submissions']['ungraded_count']
                for row in rows
            ),
            'students': rows,
        }
        return response.Response(summary)

    @decorators.action(
        detail=True,
        methods=['get'],
        permission_classes=[permissions.IsAuthenticated],
        url_path='download-pdf',
    )
    def download_pdf(self, request, pk=None):
        module = Module.objects.filter(pk=pk).first()
        if not module or (not module.is_published and not request.user.is_admin_teacher):
            return response.Response({'detail': 'Module not found.'}, status=404)
        if not request.user.is_admin_teacher and not (
            user_has_module_class_access(request.user, module)
            or user_has_module_access(request.user, module)
        ):
            raise PermissionDenied('This module PDF is not available for your account.')
        if not module.pdf_file and module.is_published:
            try:
                module = generate_module_pdf(module)
            except Exception as error:
                return response.Response(
                    {'detail': f'The module PDF could not be generated: {error}'},
                    status=503,
                )
        return pdf_file_response(module, 'This module does not have a PDF.')

    @decorators.action(
        detail=True,
        methods=['post'],
        permission_classes=[permissions.IsAuthenticated],
    )
    def regenerate_pdf(self, request, pk=None):
        if not request.user.is_admin_teacher:
            self.permission_denied(request)

        module = self.get_object()
        try:
            module = generate_module_pdf(module)
        except Exception as error:
            return response.Response(
                {'detail': f'The module PDF could not be generated: {error}'},
                status=503,
            )

        serializer = self.get_serializer(module)
        return response.Response(serializer.data)


def pdf_file_response(instance, missing_message):
    if not instance.pdf_file:
        return response.Response({'detail': missing_message}, status=404)
    return FileResponse(
        instance.pdf_file.open('rb'),
        as_attachment=True,
        filename=instance.pdf_file.name.rsplit('/', 1)[-1],
    )


def module_subject_ids(module):
    subject_ids = set(module.subjects.values_list('id', flat=True))
    if module.subject_id:
        subject_ids.add(module.subject_id)
    return subject_ids


def progress_percent(value, total):
    if not total:
        return 0
    return round((value / total) * 100)


def access_status_for_grants(grants, now):
    if not grants:
        return 'LOCKED'
    if any(grant.is_available for grant in grants):
        return 'ACTIVE'
    if any(
        grant.is_active
        and grant.expires_at
        and grant.expires_at <= now
        for grant in grants
    ):
        return 'EXPIRED'
    if all(not grant.is_active for grant in grants):
        return 'REVOKED'
    return 'LOCKED'


def active_access_expiry(grants):
    active_grants = [
        grant.expires_at
        for grant in grants
        if grant.is_available and grant.expires_at
    ]
    if not active_grants:
        return None
    return max(active_grants)


class ModuleAccessViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleAccessSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = ModuleAccess.objects.select_related(
            'module',
            'student',
            'activated_by',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)

    def perform_create(self, serializer):
        serializer.save(activated_by=self.request.user)


class ModuleTopicViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleTopicSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]
    search_fields = ('title', 'competency_code', 'competency_text')

    def get_queryset(self):
        queryset = ModuleTopic.objects.select_related('module', 'legacy_module')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            is_published=True,
            module__is_published=True,
        ).filter(
            active_module_access_filter(self.request.user, prefix='module__'),
        ).distinct()


class ModuleLessonViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleLessonSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]
    search_fields = ('title', 'overview', 'learning_targets')

    def get_queryset(self):
        queryset = ModuleLesson.objects.select_related('topic', 'topic__module')

        module_id = self.request.query_params.get('module')
        if module_id:
            queryset = queryset.filter(topic__module_id=module_id)

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            is_published=True,
            topic__is_published=True,
            topic__module__is_published=True,
        ).filter(
            active_module_access_filter(self.request.user, prefix='topic__module__'),
        ).distinct()

    @decorators.action(detail=True, methods=['get'], url_path='main-activity-workspace')
    def main_activity_workspace(self, request, pk=None):
        if not request.user.is_admin_teacher:
            raise PermissionDenied('Only teachers can open the Main Activity editor workspace.')
        lesson = self.get_object()
        activity = ModuleActivity.objects.filter(lesson=lesson).select_related(
            'module',
            'topic',
            'lesson',
        ).first()
        return response.Response(serialize_main_activity_editor_workspace(activity, request))

    @decorators.action(
        detail=True,
        methods=['get'],
        permission_classes=[permissions.IsAuthenticated],
    )
    def download_pdf(self, request, pk=None):
        lesson = ModuleLesson.objects.select_related(
            'topic',
            'topic__module',
        ).filter(pk=pk).first()
        if not lesson or (
            not request.user.is_admin_teacher
            and not (
                lesson.is_published
                and lesson.topic.is_published
                and lesson.topic.module.is_published
            )
        ):
            return response.Response({'detail': 'Lesson not found.'}, status=404)
        if (
            not request.user.is_admin_teacher
            and not user_has_module_access(request.user, lesson.topic.module)
        ):
            raise PermissionDenied('This lesson PDF is not available for your account.')
        if not lesson.pdf_file and lesson.is_published:
            try:
                lesson = generate_lesson_pdf(lesson)
            except Exception as error:
                return response.Response(
                    {'detail': f'The lesson PDF could not be generated: {error}'},
                    status=503,
                )
        return pdf_file_response(lesson, 'This lesson does not have a PDF.')

    @decorators.action(
        detail=True,
        methods=['post'],
        permission_classes=[permissions.IsAuthenticated],
    )
    def regenerate_pdf(self, request, pk=None):
        if not request.user.is_admin_teacher:
            self.permission_denied(request)

        lesson = self.get_object()
        try:
            lesson = generate_lesson_pdf(lesson)
        except Exception as error:
            return response.Response(
                {'detail': f'The lesson PDF could not be generated: {error}'},
                status=503,
            )

        serializer = self.get_serializer(lesson)
        return response.Response(serializer.data)

    @decorators.action(
        detail=True,
        methods=['post'],
        permission_classes=[permissions.IsAuthenticated],
    )
    def duplicate(self, request, pk=None):
        if not request.user.is_admin_teacher:
            self.permission_denied(request)

        lesson = self.get_object()
        copy = ModuleLesson.objects.create(
            topic=lesson.topic,
            title=f'Copy of {lesson.title}',
            order=lesson.order + 1,
            learning_targets=lesson.learning_targets,
            before_you_start=lesson.before_you_start,
            short_discussion=lesson.short_discussion,
            guided_examples=lesson.guided_examples,
            lets_practice=lesson.lets_practice,
            challenge_task=lesson.challenge_task,
            objectives=lesson.objectives,
            overview=lesson.overview,
            subtopics=lesson.subtopics,
            acquisition=lesson.acquisition,
            making_meaning=lesson.making_meaning,
            transfer=lesson.transfer,
            examples=lesson.examples,
            teacher_notes=lesson.teacher_notes,
            answer_key=lesson.answer_key,
            expected_outputs=lesson.expected_outputs,
            common_misconceptions=lesson.common_misconceptions,
            teaching_tips=lesson.teaching_tips,
            remediation=lesson.remediation,
            enrichment=lesson.enrichment,
            student_activities=lesson.student_activities,
            resources=lesson.resources,
            assessment_url=lesson.assessment_url,
            pdf_file=lesson.pdf_file,
            is_published=False,
        )
        for example in lesson.lesson_examples.all():
            ModuleLessonExample.objects.create(
                lesson=copy,
                order=example.order,
                title=example.title,
                image=example.image,
                alt_text=example.alt_text,
                body=example.body,
                common_mistake=example.common_mistake,
                is_published=False,
            )

        serializer = self.get_serializer(copy)
        return response.Response(serializer.data)


class ModuleLessonExampleViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleLessonExampleSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = ModuleLessonExample.objects.select_related(
            'lesson',
            'lesson__topic',
            'lesson__topic__module',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            is_published=True,
            lesson__is_published=True,
            lesson__topic__is_published=True,
            lesson__topic__module__is_published=True,
        ).filter(
            active_module_access_filter(
                self.request.user,
                prefix='lesson__topic__module__',
            ),
        ).distinct()


class ModuleLessonAssetViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleLessonAssetSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = ModuleLessonAsset.objects.select_related(
            'lesson',
            'lesson__topic',
            'lesson__topic__module',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            lesson__is_published=True,
            lesson__topic__is_published=True,
            lesson__topic__module__is_published=True,
        ).filter(
            active_module_access_filter(
                self.request.user,
                prefix='lesson__topic__module__',
            ),
        ).distinct()


class ModuleActivityViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleActivitySerializer
    permission_classes = [IsAdminTeacherOrReadOnly]
    search_fields = ('title', 'instructions')

    def get_queryset(self):
        queryset = ModuleActivity.objects.select_related(
            'module',
            'topic',
            'topic__module',
            'lesson',
            'lesson__topic',
            'lesson__topic__module',
            'programming_problem',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            is_published=True,
            module__is_published=True,
        ).filter(
            active_module_access_filter(self.request.user, prefix='module__'),
        ).distinct().prefetch_related(Prefetch(
            'extensions',
            queryset=ModuleActivityExtension.objects.filter(student=self.request.user),
        ))

    @decorators.action(detail=False, methods=['put'], url_path='atomic-save')
    @transaction.atomic
    def atomic_save(self, request):
        if not request.user.is_admin_teacher:
            raise PermissionDenied('Only teachers can edit Main Activities.')

        payload = request.data
        questions = payload.get('questions')
        if not isinstance(questions, list):
            raise serializers.ValidationError({'questions': 'Provide the complete question list.'})

        activity_id = payload.get('id')
        activity = None
        if activity_id:
            activity = ModuleActivity.objects.select_for_update().filter(pk=activity_id).first()
            if not activity:
                raise serializers.ValidationError({'id': 'Main Activity was not found.'})

        is_published = bool(payload.get('is_published', False))
        prepared_questions = []
        published_points = Decimal('0')
        published_count = 0
        for index, item in enumerate(questions):
            prepared = validate_atomic_question(item, index, is_published)
            prepared_questions.append(prepared)
            if prepared['is_published']:
                published_count += 1
                published_points += prepared['points']

        if is_published and not published_count:
            raise serializers.ValidationError({
                'questions': 'Publish at least one complete question before publishing the activity.',
            })

        activity_data = {
            key: payload.get(key)
            for key in (
                'module', 'topic', 'lesson', 'programming_problem', 'title', 'instructions',
                'activity_type', 'order', 'opens_at', 'due_at', 'allow_late_submissions',
                'max_attempts', 'passing_score', 'accepts_text', 'accepts_file',
                'accepts_code', 'is_published',
            )
            if key in payload
        }
        activity_data['points_possible'] = str(published_points)
        activity_serializer = self.get_serializer(
            activity,
            data=activity_data,
            partial=bool(activity),
        )
        activity_serializer.is_valid(raise_exception=True)
        activity = activity_serializer.save()

        retained_ids = []
        for item in prepared_questions:
            question_id = item.pop('id', None)
            choices = item.pop('choices')
            pairs = item.pop('matching_pairs')
            question = None
            if question_id:
                question = activity.questions.select_for_update().filter(pk=question_id).first()
                if not question:
                    raise serializers.ValidationError({
                        'questions': f'Question {question_id} does not belong to this activity.',
                    })
            if question:
                for field, value in item.items():
                    setattr(question, field, value)
                question.save()
            else:
                question = ModuleActivityQuestion.objects.create(activity=activity, **item)
            retained_ids.append(question.id)
            question.choices.all().delete()
            question.matching_pairs.all().delete()
            ModuleActivityQuestionChoice.objects.bulk_create([
                ModuleActivityQuestionChoice(question=question, **choice)
                for choice in choices
            ])
            ModuleActivityMatchingPair.objects.bulk_create([
                ModuleActivityMatchingPair(question=question, **pair)
                for pair in pairs
            ])

        activity.questions.exclude(pk__in=retained_ids).delete()
        return response.Response(
            serialize_main_activity_editor_workspace(activity, request),
            status=status.HTTP_200_OK if activity_id else status.HTTP_201_CREATED,
        )

    @decorators.action(detail=True, methods=['get'], url_path='grading-workspace')
    def grading_workspace(self, request, pk=None):
        if not request.user.is_admin_teacher:
            raise PermissionDenied('Only teachers can open activity grading settings.')
        activity = self.get_object()
        subject_ids = module_subject_ids(activity.module)
        schedules = list(
            SubjectSchedule.objects.filter(
                subject_id__in=subject_ids,
                is_active=True,
            ).select_related('subject', 'school_year_semester', 'school_year_semester__school_year'),
        )
        enrollments = list(
            ScheduleStudent.objects.filter(
                schedule__in=schedules,
                is_active=True,
            ).select_related(
                'student',
                'student__student_profile',
                'schedule',
                'schedule__subject',
                'schedule__school_year_semester',
                'schedule__school_year_semester__school_year',
            ),
        )
        students = sorted(
            {enrollment.student for enrollment in enrollments},
            key=lambda student: (student.last_name, student.first_name, student.id),
        )
        categories = GradeCategory.objects.filter(subject_id__in=subject_ids).order_by(
            'subject_id', 'grading_period', 'category', 'name',
        )
        items = GradeItem.objects.filter(
            module_activity=activity,
            schedule__in=schedules,
        ).select_related(
            'schedule',
            'grade_category',
            'module_activity',
        )
        extensions = activity.extensions.select_related('student').all()
        context = {'request': request}
        return response.Response({
            'users': UserSerializer(students, many=True, context=context).data,
            'schedules': SubjectScheduleSerializer(schedules, many=True, context=context).data,
            'enrollments': ScheduleStudentSerializer(enrollments, many=True, context=context).data,
            'grade_categories': GradeCategorySerializer(categories, many=True, context=context).data,
            'grade_items': GradeItemSerializer(items, many=True, context=context).data,
            'extensions': ModuleActivityExtensionSerializer(extensions, many=True).data,
            'linked_class_count': len({item.schedule_id for item in items}),
        })

    @decorators.action(detail=True, methods=['get', 'put', 'delete'], url_path='extensions')
    def extensions(self, request, pk=None):
        if not request.user.is_admin_teacher:
            raise PermissionDenied('Only teachers can manage activity extensions.')
        activity = self.get_object()
        if request.method == 'GET':
            extensions = activity.extensions.select_related('student').all()
            return response.Response(ModuleActivityExtensionSerializer(extensions, many=True).data)

        student_id = request.data.get('student')
        if not student_id:
            raise serializers.ValidationError({'student': 'Select a student.'})
        if request.method == 'DELETE':
            activity.extensions.filter(student_id=student_id).delete()
            return response.Response(status=status.HTTP_204_NO_CONTENT)

        entry = ModuleActivityExtensionSerializer(data=request.data)
        entry.is_valid(raise_exception=True)
        subject_ids = set(activity.module.subjects.values_list('id', flat=True))
        if activity.module.subject_id:
            subject_ids.add(activity.module.subject_id)
        if not ScheduleStudent.objects.filter(
            student_id=student_id,
            schedule__subject_id__in=subject_ids,
            schedule__is_active=True,
            is_active=True,
        ).exists():
            raise serializers.ValidationError({
                'student': 'This student is not actively enrolled in a class for this module.',
            })
        if activity.due_at and entry.validated_data['due_at'] <= activity.due_at:
            raise serializers.ValidationError({
                'due_at': 'An extension must be later than the activity due date.',
            })
        extension, _ = ModuleActivityExtension.objects.update_or_create(
            activity=activity,
            student_id=student_id,
            defaults={'due_at': entry.validated_data['due_at'], 'granted_by': request.user},
        )
        return response.Response(ModuleActivityExtensionSerializer(extension).data)

    @decorators.action(detail=True, methods=['get'])
    def workspace(self, request, pk=None):
        activity = self.get_object()
        questions = ModuleActivityQuestion.objects.filter(activity=activity).prefetch_related(
            'choices', 'matching_pairs',
        )
        if not request.user.is_admin_teacher:
            questions = questions.filter(is_published=True)
        attempts = ModuleActivityAttempt.objects.filter(activity=activity)
        submissions = ModuleActivitySubmission.objects.filter(activity=activity)
        if not request.user.is_admin_teacher:
            attempts = attempts.filter(student=request.user)
            submissions = submissions.filter(student=request.user)
        context = {'request': request}
        return response.Response({
            'activity': ModuleActivitySerializer(activity, context=context).data,
            'module': ModuleSerializer(activity.module, context=context).data,
            'problem': (
                ProgrammingProblemSerializer(activity.programming_problem, context=context).data
                if activity.programming_problem_id else None
            ),
            'questions': ModuleActivityQuestionSerializer(questions, many=True, context=context).data,
            'attempts': ModuleActivityAttemptSerializer(attempts, many=True, context=context).data,
            'submissions': ModuleActivitySubmissionSerializer(submissions, many=True, context=context).data,
        })


class ModuleActivityQuestionViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleActivityQuestionSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = ModuleActivityQuestion.objects.select_related(
            'activity',
            'activity__module',
            'activity__lesson',
            'activity__lesson__topic',
        ).prefetch_related('choices', 'matching_pairs')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            is_published=True,
            activity__is_published=True,
            activity__activity_type=ModuleActivity.ActivityType.INTERACTIVE,
            activity__module__is_published=True,
            activity__lesson__is_published=True,
            activity__lesson__topic__is_published=True,
        ).filter(
            active_module_access_filter(self.request.user, prefix='activity__module__'),
        ).distinct()


class ModuleActivityQuestionChoiceViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleActivityQuestionChoiceSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = ModuleActivityQuestionChoice.objects.select_related(
            'question',
            'question__activity',
            'question__activity__module',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            question__is_published=True,
            question__activity__is_published=True,
            question__activity__activity_type=ModuleActivity.ActivityType.INTERACTIVE,
            question__activity__module__is_published=True,
            question__activity__lesson__is_published=True,
            question__activity__lesson__topic__is_published=True,
        ).filter(
            active_module_access_filter(
                self.request.user,
                prefix='question__activity__module__',
            ),
        ).distinct()


class ModuleActivityMatchingPairViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleActivityMatchingPairSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = ModuleActivityMatchingPair.objects.select_related(
            'question',
            'question__activity',
            'question__activity__module',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            question__is_published=True,
            question__activity__is_published=True,
            question__activity__activity_type=ModuleActivity.ActivityType.INTERACTIVE,
            question__activity__module__is_published=True,
            question__activity__lesson__is_published=True,
            question__activity__lesson__topic__is_published=True,
        ).filter(
            active_module_access_filter(
                self.request.user,
                prefix='question__activity__module__',
            ),
        ).distinct()


class ModuleActivityAttemptViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleActivityAttemptSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'list' and self.request.query_params.get('view') == 'summary':
            return ModuleActivityAttemptSummarySerializer
        return ModuleActivityAttemptSerializer

    def get_queryset(self):
        queryset = ModuleActivityAttempt.objects.select_related(
            'activity',
            'activity__module',
            'activity__lesson',
            'student',
            'recorded_by',
            'paper_grade_item',
        )

        if self.action == 'list' and self.request.query_params.get('view') == 'summary':
            queryset = queryset.defer('question_snapshot', 'draft_answers')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user).filter(
            active_module_access_filter(
                self.request.user,
                prefix='activity__module__',
            ),
        ).distinct()

    def perform_create(self, serializer):
        student = serializer.validated_data.get('student', self.request.user)
        attempt = serializer.save(
            student=student,
            submission_method=ModuleActivityAttempt.SubmissionMethod.ONLINE,
            recorded_by=None,
            paper_grade_item=None,
        )
        ensure_attempt_snapshot(attempt)

    def destroy(self, request, *args, **kwargs):
        attempt = self.get_object()
        if not request.user.is_admin_teacher and attempt.is_submitted:
            raise PermissionDenied('Submitted attempts cannot be deleted by students.')
        return super().destroy(request, *args, **kwargs)

    @decorators.action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        attempt = self.get_object()
        if not request.user.is_admin_teacher and attempt.student_id != request.user.id:
            raise PermissionDenied('Students can only submit their own attempts.')
        if (
            attempt.submission_method == ModuleActivityAttempt.SubmissionMethod.ONLINE
            and ModuleActivityAttempt.objects.filter(
                activity=attempt.activity,
                student=attempt.student,
                submission_method=ModuleActivityAttempt.SubmissionMethod.PAPER,
                is_submitted=True,
            ).exclude(pk=attempt.pk).exists()
        ):
            raise PermissionDenied(
                'A paper submission has already been recorded for this activity.'
            )
        if attempt.is_submitted:
            serializer = self.get_serializer(attempt)
            return response.Response(serializer.data)

        validate_activity_window(attempt.activity, attempt.student)

        attempt = submit_activity_attempt(attempt)
        serializer = self.get_serializer(attempt)
        return response.Response(serializer.data)

    @decorators.action(detail=True, methods=['put'], url_path='draft')
    @transaction.atomic
    def save_draft(self, request, pk=None):
        attempt = self.get_object()
        if not request.user.is_admin_teacher and attempt.student_id != request.user.id:
            raise PermissionDenied('Students can only save their own answers.')
        if attempt.is_submitted:
            raise serializers.ValidationError({'detail': 'Submitted attempts cannot be edited.'})
        validate_activity_window(attempt.activity, attempt.student)
        ensure_attempt_snapshot(attempt)
        answers = request.data.get('answers')
        if not isinstance(answers, dict):
            raise serializers.ValidationError({'answers': 'Answers must be an object keyed by question.'})
        attempt.draft_answers = normalize_draft_answers(attempt.question_snapshot, answers)
        attempt.save(update_fields=['draft_answers'])
        return response.Response(self.get_serializer(attempt).data)

    @decorators.action(detail=False, methods=['post'], url_path='paper-scores')
    @transaction.atomic
    def record_paper_scores(self, request):
        if not request.user.is_admin_teacher:
            raise PermissionDenied('Only teachers can record paper scores.')

        entry = PaperActivityScoreBatchSerializer(data=request.data)
        entry.is_valid(raise_exception=True)
        item = entry.validated_data['grade_item']
        activity = entry.validated_data['activity']
        attempts = []
        created_count = 0
        updated_count = 0
        for row in entry.validated_data['scores']:
            student = row['student']
            attempt = ModuleActivityAttempt.objects.select_for_update().filter(
                paper_grade_item=item,
                student=student,
            ).first()
            if attempt:
                attempt.score = row['score']
                attempt.max_score = item.points_possible
                attempt.recorded_by = request.user
                attempt.is_submitted = True
                if not attempt.submitted_at:
                    attempt.submitted_at = timezone.now()
                attempt.answers.all().delete()
                attempt.save(update_fields=[
                    'score',
                    'max_score',
                    'recorded_by',
                    'is_submitted',
                    'submitted_at',
                ])
                updated_count += 1
            else:
                last_attempt = ModuleActivityAttempt.objects.filter(
                    activity=activity,
                    student=student,
                ).aggregate(maximum=Max('attempt_number'))['maximum'] or 0
                attempt = ModuleActivityAttempt.objects.create(
                    activity=activity,
                    student=student,
                    attempt_number=last_attempt + 1,
                    submission_method=ModuleActivityAttempt.SubmissionMethod.PAPER,
                    recorded_by=request.user,
                    paper_grade_item=item,
                    score=row['score'],
                    max_score=item.points_possible,
                    submitted_at=timezone.now(),
                    is_submitted=True,
                )
                created_count += 1
            attempts.append(attempt)

        return response.Response({
            'attempts': self.get_serializer(attempts, many=True).data,
            'created_count': created_count,
            'updated_count': updated_count,
        })

    @decorators.action(detail=True, methods=['put'], url_path='paper-score')
    @transaction.atomic
    def update_paper_score(self, request, pk=None):
        if not request.user.is_admin_teacher:
            raise PermissionDenied('Only teachers can correct paper scores.')

        attempt = self.get_object()
        if (
            attempt.submission_method != ModuleActivityAttempt.SubmissionMethod.PAPER
            or not attempt.paper_grade_item_id
        ):
            return response.Response(
                {'detail': 'Only a paper activity score can be corrected here.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        entry = PaperActivityScoreUpdateSerializer(
            data=request.data,
            context={'attempt': attempt},
        )
        entry.is_valid(raise_exception=True)
        attempt.answers.all().delete()
        attempt.score = entry.validated_data['score']
        attempt.max_score = attempt.paper_grade_item.points_possible
        attempt.recorded_by = request.user
        attempt.is_submitted = True
        if not attempt.submitted_at:
            attempt.submitted_at = timezone.now()
        attempt.save(update_fields=[
            'score',
            'max_score',
            'recorded_by',
            'is_submitted',
            'submitted_at',
        ])
        return response.Response(self.get_serializer(attempt).data)


class ModuleActivityAnswerViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleActivityAnswerSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = ModuleActivityAnswer.objects.select_related(
            'attempt',
            'attempt__activity',
            'attempt__activity__module',
            'attempt__student',
            'question',
            'selected_choice',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(attempt__student=self.request.user).filter(
            active_module_access_filter(
                self.request.user,
                prefix='attempt__activity__module__',
            ),
        ).distinct()

    def destroy(self, request, *args, **kwargs):
        answer = self.get_object()
        if answer.attempt.submission_method == ModuleActivityAttempt.SubmissionMethod.PAPER:
            raise PermissionDenied(
                'Paper scores do not expose editable answer records.'
            )
        return super().destroy(request, *args, **kwargs)


class ModuleActivitySubmissionViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleActivitySubmissionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = ModuleActivitySubmission.objects.select_related('activity', 'student')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            student=self.request.user,
        ).filter(
            active_module_access_filter(
                self.request.user,
                prefix='activity__module__',
            ),
        ).distinct()

    def perform_create(self, serializer):
        student = serializer.validated_data.get('student', self.request.user)
        serializer.save(student=student)


class ModuleProgressViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleProgressSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = ModuleProgress.objects.select_related('module', 'student')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            student=self.request.user,
        ).filter(
            active_module_access_filter(self.request.user, prefix='module__'),
        ).distinct()

    def perform_create(self, serializer):
        student = serializer.validated_data.get('student', self.request.user)
        serializer.save(student=student)


class ModuleTopicProgressViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleTopicProgressSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = ModuleTopicProgress.objects.select_related(
            'topic',
            'topic__module',
            'student',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            student=self.request.user,
        ).filter(
            active_module_access_filter(
                self.request.user,
                prefix='topic__module__',
            ),
        ).distinct()

    def perform_create(self, serializer):
        student = serializer.validated_data.get('student', self.request.user)
        serializer.save(student=student)


class ModuleLessonProgressViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleLessonProgressSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = ModuleLessonProgress.objects.select_related(
            'lesson',
            'lesson__topic',
            'lesson__topic__module',
            'student',
        )
        if self.request.user.is_admin_teacher:
            return queryset
        return queryset.filter(
            student=self.request.user,
        ).filter(
            active_module_access_filter(
                self.request.user,
                prefix='lesson__topic__module__',
            ),
        ).distinct()

    def perform_create(self, serializer):
        student = serializer.validated_data.get('student', self.request.user)
        serializer.save(student=student)
