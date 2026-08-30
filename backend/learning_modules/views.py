from decimal import Decimal, InvalidOperation
import json

from django.http import FileResponse
from django.db import transaction
from django.db.models import Count, Exists, F, Max, OuterRef, Prefetch, Q, Subquery
from django.utils import timezone
from rest_framework import decorators, permissions, response, serializers, status, viewsets
from rest_framework.exceptions import PermissionDenied

from accounts.models import User
from accounts.serializers import UserSerializer
from accounts.permissions import IsAdminTeacher, IsAdminTeacherOrReadOnly
from grades.models import GradeCategory, GradeCategoryChoices, GradeItem
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
    ModuleActivityMatchingPair,
    ModuleActivityQuestion,
    ModuleActivityQuestionChoice,
    ModuleActivitySubmission,
    ModuleLesson,
    ModuleLessonAsset,
    ModuleLessonExample,
    ModuleLessonProgress,
    LearningContextType,
    ModuleProgress,
    ModuleTopic,
    ModuleTopicProgress,
    active_module_access_filter,
    add_calendar_months,
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
    ModuleActivityMatchingPairSerializer,
    ModuleActivityQuestionChoiceSerializer,
    ModuleActivityQuestionSerializer,
    ModuleActivitySubmissionSerializer,
    ModuleActivitySubmissionGradeSerializer,
    PaperActivityScoreBatchSerializer,
    PaperActivityScoreUpdateSerializer,
    ModuleLessonAssetSerializer,
    ModuleLessonSerializer,
    ModuleLessonExampleSerializer,
    ModuleLessonProgressSerializer,
    ModuleProgressSerializer,
    ModuleSerializer,
    ModuleSummarySerializer,
    ModuleTopicProgressSerializer,
    ModuleTopicSerializer,
)
from .services.activity_grading import submit_activity_attempt
from .services.activity_snapshots import (
    ensure_attempt_snapshot,
    normalize_draft_answers,
    validate_activity_window,
)
from .services.activity_state import (
    activity_states_for_attempts,
    evaluate_main_activity_state,
)
from .services.learning_context import (
    learning_context_query,
    request_learning_context,
    resolve_learning_context,
)


def bounded_int(value, default=0, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default
    number = max(number, 0)
    return min(number, maximum) if maximum is not None else number


def serialize_main_activity_editor_workspace(activity, request):
    if not activity:
        return {
            'activity': None,
            'questions': [],
            'choices': [],
            'matching_pairs': [],
            'linked_class_count': 0,
        }
    questions = list(activity.questions.prefetch_related(
        Prefetch(
            'choices',
            queryset=ModuleActivityQuestionChoice.objects.order_by('order', 'id'),
        ),
        Prefetch(
            'matching_pairs',
            queryset=ModuleActivityMatchingPair.objects.order_by('order', 'id'),
        ),
    ).order_by('order', 'id'))
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


def serialize_attempt_with_state(attempt, request, *, created=False):
    context_attempts = ModuleActivityAttempt.objects.filter(
        activity=attempt.activity,
        student=attempt.student,
        context_type=attempt.context_type,
        schedule=attempt.schedule,
    ).select_related('activity')
    return {
        'attempt': ModuleActivityAttemptSerializer(
            attempt,
            context={'request': request},
        ).data,
        'state': evaluate_main_activity_state(attempt.activity, context_attempts),
        'created': created,
    }


def reject_non_atomic_lesson_activity_edit(activity):
    """Keep lesson Main Activity revisions behind the atomic editor contract."""
    if activity and activity.lesson_id:
        raise serializers.ValidationError({
            'detail': (
                'Lesson Main Activities must be edited through the atomic-save endpoint.'
            ),
        })


def prepare_period_reassignments(activity, target_period, raw_reassignments):
    if not activity or target_period == activity.grading_period:
        return []

    linked_items = list(
        GradeItem.objects.select_for_update(of=('self',)).filter(
            module_activity=activity,
            schedule__isnull=False,
            schedule__is_active=True,
            schedule__school_year_semester__is_active=True,
        ).select_related('schedule', 'grade_category')
    )
    if not linked_items:
        return []

    linked_schedule_ids = [item.schedule_id for item in linked_items]
    if len(linked_schedule_ids) != len(set(linked_schedule_ids)):
        raise serializers.ValidationError({
            'period_reassignments': 'Resolve duplicate class links before changing the grading period.',
        })
    if not isinstance(raw_reassignments, list):
        raise serializers.ValidationError({
            'period_reassignments': 'Choose a replacement Quiz category for every linked class.',
        })

    parsed = {}
    row_errors = {}
    for index, row in enumerate(raw_reassignments):
        if not isinstance(row, dict):
            row_errors[index] = {'detail': 'Each replacement must be an object.'}
            continue
        try:
            schedule_id = int(row.get('schedule'))
            category_id = int(row.get('grade_category'))
        except (TypeError, ValueError):
            row_errors[index] = {'detail': 'A valid class and Quiz category are required.'}
            continue
        if schedule_id in parsed:
            row_errors[index] = {'schedule': 'Each linked class may appear only once.'}
            continue
        parsed[schedule_id] = category_id

    expected = set(linked_schedule_ids)
    provided = set(parsed)
    if provided != expected:
        missing = sorted(expected - provided)
        unexpected = sorted(provided - expected)
        detail = []
        if missing:
            detail.append(f'Missing linked classes: {missing}.')
        if unexpected:
            detail.append(f'Unexpected classes: {unexpected}.')
        row_errors['detail'] = ' '.join(detail)

    categories = {
        category.id: category
        for category in GradeCategory.objects.select_related('subject').filter(pk__in=parsed.values())
    }
    prepared = []
    for item in linked_items:
        category = categories.get(parsed.get(item.schedule_id))
        errors = {}
        if not category:
            errors['grade_category'] = 'This grade category does not exist.'
        elif category.category != GradeCategoryChoices.QUIZ:
            errors['grade_category'] = 'Select an existing Quiz category.'
        elif category.grading_period != target_period:
            errors['grade_category'] = 'The Quiz category must use the new activity grading period.'
        elif category.subject_id != item.schedule.subject_id:
            errors['grade_category'] = 'This Quiz category does not belong to the linked class subject.'
        if errors:
            row_errors[item.schedule_id] = errors
        elif category:
            prepared.append((item, category))

    if row_errors:
        raise serializers.ValidationError({'period_reassignments': row_errors})
    return prepared


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
        published_topics = Prefetch(
            'topics',
            queryset=ModuleTopic.objects.filter(is_published=True).order_by('order', 'id'),
            to_attr='_published_topics',
        )
        prefetches = ['subjects', published_topics]
        if self.request.user.is_authenticated and not self.request.user.is_admin_teacher:
            prefetches.append(Prefetch(
                'access_grants',
                queryset=ModuleAccess.objects.filter(
                    student=self.request.user,
                    is_active=True,
                    activated_by__isnull=False,
                    expires_at__gt=timezone.now(),
                ).select_related('activated_by').order_by('-updated_at'),
                to_attr='_current_user_grants',
            ))
        queryset = Module.objects.select_related('subject').prefetch_related(*prefetches)

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            is_published=True,
        ).filter(
            module_enrollment_filter(self.request.user)
            | active_module_access_filter(self.request.user),
        ).distinct()

    def get_serializer_class(self):
        if self.action == 'list' and self.request.query_params.get('view') == 'summary':
            return ModuleSummarySerializer
        return ModuleSerializer

    @decorators.action(
        detail=True,
        methods=['get'],
        permission_classes=[permissions.IsAuthenticated],
    )
    def workspace(self, request, pk=None):
        module = self.get_object()
        context = {'request': request}
        subjects = Subject.objects.filter(modules=module) | Subject.objects.filter(
            learning_module=module,
        )
        if (
            not request.user.is_admin_teacher
            and not user_has_module_access(request.user, module)
        ):
            return response.Response({
                'module': ModuleSerializer(module, context=context).data,
                'topics': [],
                'lessons': [],
                'lesson_examples': [],
                'lesson_progress': [],
                'activities': [],
                'activity_attempts': [],
                'activity_states': [],
                'subjects': SubjectSerializer(
                    subjects,
                    many=True,
                    context=context,
                ).data,
            })

        topics = ModuleTopic.objects.filter(module=module)
        lessons = ModuleLesson.objects.filter(topic__module=module)
        activities = ModuleActivity.objects.filter(module=module)
        if not request.user.is_admin_teacher:
            topics = topics.filter(is_published=True)
            lessons = lessons.filter(is_published=True, topic__is_published=True)
            activities = activities.filter(is_published=True).filter(
                Q(lesson__isnull=True)
                | Q(lesson__is_published=True, lesson__topic__is_published=True)
            )
        activities = list(activities)
        examples = ModuleLessonExample.objects.filter(lesson__in=lessons)
        legacy_history_counts = {}
        if not request.user.is_admin_teacher:
            context_type, schedule = request_learning_context(request, module)
            context_filter = learning_context_query(context_type, schedule)
            lesson_progress = ModuleLessonProgress.objects.filter(
                lesson__in=lessons,
                student=request.user,
                **context_filter,
            )
            attempts = list(ModuleActivityAttempt.objects.filter(
                activity__in=activities,
                student=request.user,
                **context_filter,
            ).defer('question_snapshot', 'draft_answers'))
            legacy_rows = ModuleActivityAttempt.objects.filter(
                activity__in=activities,
                student=request.user,
                context_type=LearningContextType.LEGACY,
            ).values('activity_id').annotate(count=Count('id'))
            legacy_history_counts = {
                str(row['activity_id']): row['count']
                for row in legacy_rows
            }
        else:
            lesson_progress = ModuleLessonProgress.objects.none()
            attempts = []
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
            'subjects': SubjectSerializer(
                subjects,
                many=True, context=context,
            ).data,
            'activity_states': (
                activity_states_for_attempts(activities, attempts)
                if not request.user.is_admin_teacher
                else []
            ),
            'learning_context': {
                'context_type': context_type if not request.user.is_admin_teacher else None,
                'schedule': schedule.id if not request.user.is_admin_teacher and schedule else None,
                'label': (
                    f'{schedule.subject.code} {schedule.section}'.strip()
                    if not request.user.is_admin_teacher and schedule
                    else 'Personal Study'
                    if not request.user.is_admin_teacher
                    else 'Teacher preview'
                ),
            },
            'legacy_history_counts': legacy_history_counts,
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
        enrollment_scope = ScheduleStudent.objects.filter(
            is_active=True,
            schedule__is_active=True,
            schedule__subject_id__in=subject_ids,
            student__role='STUDENT',
        )
        schedule_id = request.query_params.get('schedule', '').strip()
        if schedule_id.isdigit():
            enrollment_scope = enrollment_scope.filter(schedule_id=int(schedule_id))

        now = timezone.now()
        grants_for_student = ModuleAccess.objects.filter(
            module=module,
            student_id=OuterRef('pk'),
        )
        active_grants_for_student = grants_for_student.filter(
            is_active=True,
            activated_by__isnull=False,
            expires_at__gt=now,
        )
        expired_grants_for_student = grants_for_student.filter(
            is_active=True,
            activated_by__isnull=False,
            expires_at__lte=now,
        )
        inactive_grants_for_student = grants_for_student.filter(is_active=False)
        latest_activation = grants_for_student.order_by(
            '-updated_at', '-activated_at', '-id',
        ).values('activated_at')[:1]

        students = User.objects.filter(role=User.Role.STUDENT).annotate(
            _has_enrollment=Exists(enrollment_scope.filter(student_id=OuterRef('pk'))),
            _has_grant=Exists(grants_for_student),
            _has_active_grant=Exists(active_grants_for_student),
            _has_expired_grant=Exists(expired_grants_for_student),
            _has_inactive_grant=Exists(inactive_grants_for_student),
            _latest_activation=Subquery(latest_activation),
        )
        if schedule_id.isdigit():
            students = students.filter(_has_enrollment=True)
        else:
            students = students.filter(Q(_has_enrollment=True) | Q(_has_grant=True))

        search = request.query_params.get('search', '').strip()
        if search:
            students = students.filter(
                Q(first_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(username__icontains=search)
                | Q(email__icontains=search)
                | Q(student_profile__student_number__icontains=search)
            )
        access_filter = request.query_params.get('access_status', '').strip().upper()
        if access_filter == 'ACTIVE':
            students = students.filter(_has_active_grant=True)
        elif access_filter == 'EXPIRED':
            students = students.filter(_has_active_grant=False, _has_expired_grant=True)
        elif access_filter == 'REVOKED':
            students = students.filter(
                _has_active_grant=False,
                _has_expired_grant=False,
                _has_inactive_grant=True,
            )
        elif access_filter == 'LOCKED':
            students = students.filter(_has_grant=False)
        elif access_filter == 'AVAILED':
            students = students.filter(_has_grant=True)

        students = students.order_by(
            F('_latest_activation').desc(nulls_last=True),
            'last_name',
            'first_name',
            'username',
            'id',
        )
        count = students.count()
        limit_param = request.query_params.get('limit')
        limit = bounded_int(limit_param, default=count, maximum=100) if limit_param is not None else count
        offset = bounded_int(request.query_params.get('offset'), default=0)
        page_students = list(students[offset:offset + limit])
        page_student_ids = [student.id for student in page_students]

        active_enrollments = enrollment_scope.filter(
            student_id__in=page_student_ids,
        ).select_related('student', 'schedule', 'schedule__subject').order_by('schedule_id', 'id')
        enrollment_by_student = {}
        for enrollment in active_enrollments:
            enrollment_by_student.setdefault(enrollment.student_id, enrollment)

        lesson_ids = list(published_lessons.values_list('id', flat=True))
        activity_ids = list(published_activities.values_list('id', flat=True))
        now = timezone.now()
        grants_by_student = {}
        for grant in ModuleAccess.objects.filter(
            module=module,
            student_id__in=page_student_ids,
        ).order_by('student_id', '-updated_at', '-activated_at'):
            grants_by_student.setdefault(grant.student_id, []).append(grant)
        progress_by_student = {}
        for progress in ModuleLessonProgress.objects.filter(
            lesson_id__in=lesson_ids,
            student_id__in=page_student_ids,
        ).select_related('lesson').order_by('student_id', '-last_viewed_at'):
            progress_by_student.setdefault(progress.student_id, []).append(progress)
        submissions_by_student = {}
        for submission in ModuleActivitySubmission.objects.filter(
            activity_id__in=activity_ids,
            student_id__in=page_student_ids,
        ):
            submissions_by_student.setdefault(submission.student_id, []).append(submission)
        rows = []

        for student in page_students:
            grants = grants_by_student.get(student.id, [])
            lesson_progress = progress_by_student.get(student.id, [])
            submissions = submissions_by_student.get(student.id, [])
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

        all_student_ids = students.values_list('id', flat=True)
        completed_student_count = 0
        if lesson_ids:
            completed_student_count = ModuleLessonProgress.objects.filter(
                lesson_id__in=lesson_ids,
                student_id__in=all_student_ids,
                completed_at__isnull=False,
            ).values('student_id').annotate(
                completed=Count('lesson_id', distinct=True),
            ).filter(completed=len(lesson_ids)).count()
        summary = {
            'module': module.id,
            'module_title': module.title,
            'total_students': count,
            'total_lessons': len(lesson_ids),
            'total_activities': len(activity_ids),
            'active_access_count': students.filter(_has_active_grant=True).count(),
            'locked_count': students.filter(_has_grant=False).count(),
            'completed_count': completed_student_count,
            'ungraded_submission_count': ModuleActivitySubmission.objects.filter(
                activity_id__in=activity_ids,
                student_id__in=all_student_ids,
                graded_at__isnull=True,
                score__isnull=True,
            ).count(),
            'count': count,
            'next': offset + limit if offset + limit < count else None,
            'previous': max(offset - limit, 0) if offset > 0 else None,
            'students': rows,
        }
        return response.Response(summary)

def pdf_file_response(instance, missing_message):
    if not instance.pdf_file:
        return response.Response({'detail': missing_message}, status=404)
    return FileResponse(
        instance.pdf_file.open('rb'),
        as_attachment=True,
        filename=instance.pdf_file.name.rsplit('/', 1)[-1],
    )


def enqueue_topic_pdf(topic, owner):
    from jobs.models import BackgroundJob
    from jobs.tasks import enqueue, generate_topic_pdf_job

    return enqueue(
        generate_topic_pdf_job,
        job_type=BackgroundJob.Type.PDF_GENERATION,
        owner=owner,
        payload={'topic_id': topic.id},
        total=1,
        idempotency_key=f'topic-pdf:{topic.id}',
    )


def module_subject_ids(module):
    subject_ids = set(module.subjects.values_list('id', flat=True))
    if module.subject_id:
        subject_ids.add(module.subject_id)
    return subject_ids


def filter_requested_learning_context(queryset, request):
    schedule_id = request.query_params.get('schedule')
    context_type = request.query_params.get('context')
    if schedule_id:
        return queryset.filter(
            context_type=LearningContextType.CLASS,
            schedule_id=schedule_id,
        )
    if context_type == LearningContextType.PERSONAL:
        return queryset.filter(context_type=LearningContextType.PERSONAL)
    if context_type == LearningContextType.LEGACY:
        return queryset.filter(context_type=LearningContextType.LEGACY)
    return queryset


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

    def perform_update(self, serializer):
        next_active = serializer.validated_data.get(
            'is_active',
            serializer.instance.is_active,
        )
        serializer.save(
            **({'activated_by': self.request.user} if next_active else {}),
        )

    @decorators.action(detail=False, methods=['post'], url_path='batch-activate')
    @transaction.atomic
    def batch_activate(self, request):
        if not request.user.is_admin_teacher:
            self.permission_denied(request)
        module = get_object_or_404(Module, pk=request.data.get('module'))
        schedule = get_object_or_404(
            SubjectSchedule.objects.select_related('subject'),
            pk=request.data.get('schedule'),
        )
        if schedule.subject_id not in module_subject_ids(module):
            raise serializers.ValidationError({
                'module': 'This module is not assigned to the selected class subject.',
            })
        student_ids = list(ScheduleStudent.objects.filter(
            schedule=schedule,
            is_active=True,
            student__role=User.Role.STUDENT,
        ).values_list('student_id', flat=True))
        existing = {
            grant.student_id: grant
            for grant in ModuleAccess.objects.select_for_update().filter(
                module=module,
                student_id__in=student_ids,
                access_type=ModuleAccess.AccessType.ENROLLED,
            )
        }
        expires_at = add_calendar_months(timezone.now(), 5)
        updated_at = timezone.now()
        notes = str(request.data.get('notes') or '')[:500]
        creates = []
        updates = []
        for student_id in student_ids:
            grant = existing.get(student_id)
            if grant:
                grant.is_active = True
                grant.activated_by = request.user
                grant.expires_at = expires_at
                grant.notes = notes
                grant.updated_at = updated_at
                updates.append(grant)
            else:
                creates.append(ModuleAccess(
                    module=module,
                    student_id=student_id,
                    access_type=ModuleAccess.AccessType.ENROLLED,
                    is_active=True,
                    activated_by=request.user,
                    expires_at=expires_at,
                    notes=notes,
                ))
        if creates:
            ModuleAccess.objects.bulk_create(creates, batch_size=500)
        if updates:
            ModuleAccess.objects.bulk_update(
                updates, ('is_active', 'activated_by', 'expires_at', 'notes', 'updated_at'),
                batch_size=500,
            )
        return response.Response({
            'created_count': len(creates),
            'updated_count': len(updates),
            'student_count': len(student_ids),
        })


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

    @decorators.action(
        detail=True,
        methods=['get'],
        permission_classes=[permissions.IsAuthenticated],
        url_path='download_pdf',
    )
    def download_pdf(self, request, pk=None):
        topic = ModuleTopic.objects.select_related('module').prefetch_related(
            'module__subjects',
        ).filter(pk=pk).first()
        if not topic or (
            not request.user.is_admin_teacher
            and not (
                topic.is_published
                and topic.module.is_published
            )
        ):
            return response.Response({'detail': 'Topic not found.'}, status=404)
        if not request.user.is_admin_teacher and not (
            user_has_module_class_access(request.user, topic.module)
            or user_has_module_access(request.user, topic.module)
        ):
            raise PermissionDenied('This topic PDF is not available for your account.')
        if not topic.pdf_file and topic.is_published:
            job = enqueue_topic_pdf(topic, request.user)
            return response.Response({
                'detail': 'The topic PDF is being generated.',
                'job': str(job.id),
                'status': job.status,
            }, status=status.HTTP_202_ACCEPTED)
        return pdf_file_response(topic, 'This topic does not have a PDF.')

    @decorators.action(
        detail=True,
        methods=['post'],
        permission_classes=[permissions.IsAuthenticated],
        url_path='regenerate_pdf',
    )
    def regenerate_pdf(self, request, pk=None):
        if not request.user.is_admin_teacher:
            self.permission_denied(request)

        topic = self.get_object()
        job = enqueue_topic_pdf(topic, request.user)
        return response.Response({
            'detail': 'The topic PDF is being generated.',
            'job': str(job.id),
            'status': job.status,
        }, status=status.HTTP_202_ACCEPTED)


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
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            is_published=True,
            module__is_published=True,
        ).filter(
            Q(lesson__isnull=True)
            | Q(lesson__is_published=True, lesson__topic__is_published=True)
        ).filter(
            active_module_access_filter(self.request.user, prefix='module__'),
        ).distinct()

    def create(self, request, *args, **kwargs):
        if request.data.get('lesson') not in (None, ''):
            raise serializers.ValidationError({
                'detail': (
                    'Lesson Main Activities must be created through the atomic-save endpoint.'
                ),
            })
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        activity = self.get_object()
        reject_non_atomic_lesson_activity_edit(activity)
        if request.data.get('lesson') not in (None, ''):
            raise serializers.ValidationError({
                'detail': (
                    'Lesson Main Activities must be edited through the atomic-save endpoint.'
                ),
            })
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        reject_non_atomic_lesson_activity_edit(self.get_object())
        return super().destroy(request, *args, **kwargs)

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
            if 'expected_revision' not in payload:
                raise serializers.ValidationError({
                    'expected_revision': 'Provide the activity revision being edited.',
                })
            try:
                expected_revision = int(payload.get('expected_revision'))
            except (TypeError, ValueError) as error:
                raise serializers.ValidationError({
                    'expected_revision': 'Provide a valid activity revision.',
                }) from error
            if expected_revision != activity.revision:
                return response.Response(
                    {
                        'detail': 'This Main Activity was changed in another editor.',
                        'current_revision': activity.revision,
                    },
                    status=status.HTTP_409_CONFLICT,
                )

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
                'module', 'topic', 'lesson', 'title', 'instructions',
                'activity_type', 'order', 'opens_at', 'due_at', 'allow_late_submissions',
                'max_attempts', 'passing_score', 'accepts_text', 'accepts_file',
                'grading_period', 'is_published',
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
        target_period = activity_serializer.validated_data.get(
            'grading_period',
            getattr(activity, 'grading_period', None),
        )
        period_reassignments = prepare_period_reassignments(
            activity,
            target_period,
            payload.get('period_reassignments'),
        )
        activity = activity_serializer.save()
        if activity_id:
            ModuleActivity.objects.filter(pk=activity.pk).update(revision=F('revision') + 1)
            activity.refresh_from_db(fields=['revision'])

        for item, category in period_reassignments:
            item_serializer = GradeItemSerializer(
                item,
                data={'grade_category': category.id},
                partial=True,
                context={'request': request},
            )
            item_serializer.is_valid(raise_exception=True)
            item_serializer.save()

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
                Q(subject_id__in=subject_ids, is_active=True)
                | Q(grade_items__module_activity=activity),
            ).distinct().select_related(
                'subject', 'school_year_semester', 'school_year_semester__school_year',
            ),
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
        context = {'request': request}
        return response.Response({
            'users': UserSerializer(students, many=True, context=context).data,
            'schedules': SubjectScheduleSerializer(schedules, many=True, context=context).data,
            'enrollments': ScheduleStudentSerializer(enrollments, many=True, context=context).data,
            'grade_categories': GradeCategorySerializer(categories, many=True, context=context).data,
            'grade_items': GradeItemSerializer(items, many=True, context=context).data,
            'linked_class_count': len({item.schedule_id for item in items}),
        })

    @decorators.action(
        detail=True,
        methods=['post'],
        permission_classes=[permissions.IsAuthenticated],
        url_path='start-attempt',
    )
    @transaction.atomic
    def start_attempt(self, request, pk=None):
        if request.user.is_admin_teacher:
            raise PermissionDenied('Teacher preview does not create student attempts.')

        activity = ModuleActivity.objects.select_for_update(of=('self',)).select_related(
            'module', 'lesson', 'lesson__topic',
        ).get(pk=self.get_object().pk)
        if (
            not activity.is_published
            or activity.activity_type != ModuleActivity.ActivityType.INTERACTIVE
            or not activity.lesson_id
            or not activity.lesson.is_published
            or not activity.lesson.topic.is_published
            or not activity.module.is_published
            or not user_has_module_access(request.user, activity.module)
        ):
            raise PermissionDenied('This activity is not available.')

        context_type, schedule = resolve_learning_context(
            request.user,
            activity.module,
            schedule=request.data.get('schedule') or request.query_params.get('schedule'),
            context_type=(
                request.data.get('context_type')
                or request.query_params.get('context')
            ),
        )
        context_filter = learning_context_query(context_type, schedule)
        attempts = ModuleActivityAttempt.objects.select_for_update().filter(
            activity=activity,
            student=request.user,
            **context_filter,
        )
        paper = attempts.filter(
            submission_method=ModuleActivityAttempt.SubmissionMethod.PAPER,
            status=ModuleActivityAttempt.Status.SUBMITTED,
        ).first()
        if paper:
            return response.Response(
                {
                    'detail': 'A paper submission is already the final record for this activity.',
                    'state': evaluate_main_activity_state(activity, attempts),
                },
                status=status.HTTP_409_CONFLICT,
            )
        existing = attempts.filter(
            submission_method=ModuleActivityAttempt.SubmissionMethod.ONLINE,
            status=ModuleActivityAttempt.Status.IN_PROGRESS,
        ).first()
        if existing:
            ensure_attempt_snapshot(existing)
            return response.Response(
                serialize_attempt_with_state(existing, request, created=False),
            )
        state = evaluate_main_activity_state(activity, attempts)
        if not state['can_start_attempt']:
            raise serializers.ValidationError({
                'detail': 'You have reached the maximum number of attempts.',
            })
        validate_activity_window(activity, request.user)
        attempt_number = attempts.aggregate(maximum=Max('attempt_number'))['maximum'] or 0
        attempt = ModuleActivityAttempt.objects.create(
            activity=activity,
            student=request.user,
            submission_method=ModuleActivityAttempt.SubmissionMethod.ONLINE,
            context_type=context_type,
            schedule=schedule,
            attempt_number=attempt_number + 1,
            activity_revision=activity.revision,
            passing_score_snapshot=activity.passing_score,
        )
        ensure_attempt_snapshot(attempt)
        return response.Response(
            serialize_attempt_with_state(attempt, request, created=True),
            status=status.HTTP_201_CREATED,
        )

    @decorators.action(detail=True, methods=['get'])
    def workspace(self, request, pk=None):
        activity = self.get_object()
        questions = ModuleActivityQuestion.objects.filter(activity=activity).prefetch_related(
            Prefetch(
                'choices',
                queryset=ModuleActivityQuestionChoice.objects.order_by('order', 'id'),
            ),
            Prefetch(
                'matching_pairs',
                queryset=ModuleActivityMatchingPair.objects.order_by('order', 'id'),
            ),
        )
        if not request.user.is_admin_teacher:
            questions = questions.filter(is_published=True)
        attempts = ModuleActivityAttempt.objects.filter(activity=activity)
        submissions = ModuleActivitySubmission.objects.filter(activity=activity)
        if not request.user.is_admin_teacher:
            context_type, schedule = request_learning_context(request, activity.module)
            attempts = attempts.filter(
                student=request.user,
                **learning_context_query(context_type, schedule),
            )
            submissions = submissions.filter(student=request.user)
        attempts = list(attempts)
        context = {'request': request}
        return response.Response({
            'activity': ModuleActivitySerializer(activity, context=context).data,
            'module': ModuleSerializer(activity.module, context=context).data,
            'questions': ModuleActivityQuestionSerializer(questions, many=True, context=context).data,
            'attempts': ModuleActivityAttemptSummarySerializer(attempts, many=True, context=context).data,
            'submissions': ModuleActivitySubmissionSerializer(submissions, many=True, context=context).data,
            'learning_context': {
                'context_type': context_type if not request.user.is_admin_teacher else None,
                'schedule': schedule.id if not request.user.is_admin_teacher and schedule else None,
            },
            'activity_state': (
                evaluate_main_activity_state(activity, attempts)
                if not request.user.is_admin_teacher
                else None
            ),
            'legacy_history_count': ModuleActivityAttempt.objects.filter(
                activity=activity,
                student=request.user,
                context_type=LearningContextType.LEGACY,
            ).count() if not request.user.is_admin_teacher else 0,
        })

    @decorators.action(detail=True, methods=['get'], url_path='legacy-history')
    def legacy_history(self, request, pk=None):
        if request.user.is_admin_teacher:
            raise serializers.ValidationError({
                'detail': 'Use the teacher gradebook to review student history.',
            })
        activity = self.get_object()
        attempts = ModuleActivityAttempt.objects.filter(
            activity=activity,
            student=request.user,
            context_type=LearningContextType.LEGACY,
        ).defer('question_snapshot', 'draft_answers')
        return response.Response({
            'attempts': ModuleActivityAttemptSummarySerializer(
                attempts,
                many=True,
                context={'request': request},
            ).data,
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
        ).prefetch_related(
            Prefetch(
                'choices',
                queryset=ModuleActivityQuestionChoice.objects.order_by('order', 'id'),
            ),
            Prefetch(
                'matching_pairs',
                queryset=ModuleActivityMatchingPair.objects.order_by('order', 'id'),
            ),
        )

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

    def create(self, request, *args, **kwargs):
        activity = ModuleActivity.objects.filter(pk=request.data.get('activity')).first()
        reject_non_atomic_lesson_activity_edit(activity)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        reject_non_atomic_lesson_activity_edit(self.get_object().activity)
        target_activity = ModuleActivity.objects.filter(
            pk=request.data.get('activity'),
        ).first()
        reject_non_atomic_lesson_activity_edit(target_activity)
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        reject_non_atomic_lesson_activity_edit(self.get_object().activity)
        return super().destroy(request, *args, **kwargs)


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

    def create(self, request, *args, **kwargs):
        question = ModuleActivityQuestion.objects.select_related('activity').filter(
            pk=request.data.get('question'),
        ).first()
        reject_non_atomic_lesson_activity_edit(question.activity if question else None)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        reject_non_atomic_lesson_activity_edit(self.get_object().question.activity)
        target_question = ModuleActivityQuestion.objects.select_related('activity').filter(
            pk=request.data.get('question'),
        ).first()
        reject_non_atomic_lesson_activity_edit(
            target_question.activity if target_question else None
        )
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        reject_non_atomic_lesson_activity_edit(self.get_object().question.activity)
        return super().destroy(request, *args, **kwargs)


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

    def create(self, request, *args, **kwargs):
        question = ModuleActivityQuestion.objects.select_related('activity').filter(
            pk=request.data.get('question'),
        ).first()
        reject_non_atomic_lesson_activity_edit(question.activity if question else None)
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        reject_non_atomic_lesson_activity_edit(self.get_object().question.activity)
        target_question = ModuleActivityQuestion.objects.select_related('activity').filter(
            pk=request.data.get('question'),
        ).first()
        reject_non_atomic_lesson_activity_edit(
            target_question.activity if target_question else None
        )
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        reject_non_atomic_lesson_activity_edit(self.get_object().question.activity)
        return super().destroy(request, *args, **kwargs)


class ModuleActivityAttemptViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleActivityAttemptSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'list':
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

        if self.action == 'list':
            queryset = queryset.defer('question_snapshot', 'draft_answers')

        if self.request.user.is_admin_teacher:
            return queryset
        queryset = queryset.filter(student=self.request.user).filter(
            active_module_access_filter(
                self.request.user,
                prefix='activity__module__',
            ),
        ).distinct()
        requested_context = self.request.query_params.get('context')
        schedule_id = self.request.query_params.get('schedule')
        if requested_context == LearningContextType.LEGACY:
            return queryset.filter(context_type=LearningContextType.LEGACY)
        if schedule_id:
            return queryset.filter(
                context_type=LearningContextType.CLASS,
                schedule_id=schedule_id,
            )
        if requested_context == LearningContextType.PERSONAL:
            return queryset.filter(context_type=LearningContextType.PERSONAL)
        return queryset.none()

    def perform_create(self, serializer):
        student = serializer.validated_data.get('student', self.request.user)
        attempt = serializer.save(
            student=student,
            submission_method=ModuleActivityAttempt.SubmissionMethod.ONLINE,
            recorded_by=None,
            paper_grade_item=None,
        )
        ensure_attempt_snapshot(attempt)

    def create(self, request, *args, **kwargs):
        if not request.user.is_admin_teacher:
            raise PermissionDenied(
                'Start online attempts through the activity start-attempt action.'
            )
        return super().create(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not request.user.is_admin_teacher:
            raise PermissionDenied('Student attempts cannot be deleted.')
        return super().destroy(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not request.user.is_admin_teacher:
            raise PermissionDenied('Student attempts cannot be edited directly.')
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        if not request.user.is_admin_teacher:
            raise PermissionDenied('Student attempts cannot be edited directly.')
        return super().partial_update(request, *args, **kwargs)

    def get_locked_attempt(self):
        visible_attempt = self.get_object()
        return ModuleActivityAttempt.objects.select_for_update(
            of=('self',),
        ).select_related(
            'activity',
            'activity__module',
            'activity__lesson',
            'student',
            'recorded_by',
            'paper_grade_item',
        ).get(pk=visible_attempt.pk)

    @decorators.action(detail=True, methods=['post'])
    @transaction.atomic
    def submit(self, request, pk=None):
        attempt = self.get_locked_attempt()
        if request.user.is_admin_teacher or attempt.student_id != request.user.id:
            raise PermissionDenied('Students can only submit their own attempts.')
        if (
            attempt.submission_method == ModuleActivityAttempt.SubmissionMethod.ONLINE
            and ModuleActivityAttempt.objects.filter(
                activity=attempt.activity,
                student=attempt.student,
                submission_method=ModuleActivityAttempt.SubmissionMethod.PAPER,
                status=ModuleActivityAttempt.Status.SUBMITTED,
                context_type=attempt.context_type,
                schedule=attempt.schedule,
            ).exclude(pk=attempt.pk).exists()
        ):
            raise PermissionDenied(
                'A paper submission has already been recorded for this activity.'
            )
        if attempt.status == ModuleActivityAttempt.Status.SUPERSEDED:
            raise serializers.ValidationError({'detail': 'This attempt was superseded.'})
        expected_revision = request.data.get('draft_revision')
        try:
            expected_revision = int(expected_revision)
        except (TypeError, ValueError):
            return response.Response(
                {'detail': 'Provide the expected draft revision.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if expected_revision != attempt.draft_revision:
            return response.Response(
                {
                    'detail': 'Saved answers changed in another session. Reload before submitting.',
                    'current_revision': attempt.draft_revision,
                },
                status=status.HTTP_409_CONFLICT,
            )
        if attempt.status == ModuleActivityAttempt.Status.SUBMITTED:
            return response.Response(serialize_attempt_with_state(attempt, request))

        validate_activity_window(attempt.activity, attempt.student)
        attempt = submit_activity_attempt(attempt)
        return response.Response(serialize_attempt_with_state(attempt, request))

    @decorators.action(detail=True, methods=['patch', 'put'], url_path='draft')
    @transaction.atomic
    def save_draft(self, request, pk=None):
        attempt = self.get_locked_attempt()
        if request.user.is_admin_teacher or attempt.student_id != request.user.id:
            raise PermissionDenied('Students can only save their own answers.')
        if attempt.status != ModuleActivityAttempt.Status.IN_PROGRESS:
            raise serializers.ValidationError({'detail': 'Submitted attempts cannot be edited.'})
        if len(json.dumps(request.data, default=str).encode('utf-8')) > 262_144:
            raise serializers.ValidationError({'detail': 'Draft payload is too large.'})
        base_revision = request.data.get('base_revision')
        try:
            base_revision = int(base_revision)
        except (TypeError, ValueError):
            raise serializers.ValidationError({
                'base_revision': 'Provide the current draft revision.',
            })
        if base_revision != attempt.draft_revision:
            return response.Response(
                {
                    'detail': 'Saved answers changed in another session.',
                    'current_revision': attempt.draft_revision,
                },
                status=status.HTTP_409_CONFLICT,
            )
        validate_activity_window(attempt.activity, attempt.student)
        ensure_attempt_snapshot(attempt)
        answers = request.data.get('answers')
        if not isinstance(answers, dict):
            raise serializers.ValidationError({'answers': 'Answers must be an object keyed by question.'})
        existing = attempt.draft_answers if request.method == 'PATCH' else {}
        attempt.draft_answers = normalize_draft_answers(
            attempt.question_snapshot,
            answers,
            existing=existing,
        )
        attempt.draft_revision += 1
        attempt.draft_saved_at = timezone.now()
        attempt.save(update_fields=['draft_answers', 'draft_revision', 'draft_saved_at'])
        return response.Response({
            'draft_revision': attempt.draft_revision,
            'saved_at': attempt.draft_saved_at,
        })

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
                attempt.status = ModuleActivityAttempt.Status.SUBMITTED
                if not attempt.submitted_at:
                    attempt.submitted_at = timezone.now()
                attempt.answers.all().delete()
                attempt.save(update_fields=[
                    'score',
                    'max_score',
                    'recorded_by',
                    'status',
                    'submitted_at',
                ])
                updated_count += 1
            else:
                last_attempt = ModuleActivityAttempt.objects.filter(
                    activity=activity,
                    student=student,
                    context_type=LearningContextType.CLASS,
                    schedule=item.schedule,
                ).aggregate(maximum=Max('attempt_number'))['maximum'] or 0
                attempt = ModuleActivityAttempt.objects.create(
                    activity=activity,
                    student=student,
                    schedule=item.schedule,
                    context_type=LearningContextType.CLASS,
                    attempt_number=last_attempt + 1,
                    submission_method=ModuleActivityAttempt.SubmissionMethod.PAPER,
                    recorded_by=request.user,
                    paper_grade_item=item,
                    score=row['score'],
                    max_score=item.points_possible,
                    submitted_at=timezone.now(),
                    status=ModuleActivityAttempt.Status.SUBMITTED,
                )
                created_count += 1
            ModuleActivityAttempt.objects.filter(
                activity=activity,
                student=student,
                context_type=LearningContextType.CLASS,
                schedule=item.schedule,
                submission_method=ModuleActivityAttempt.SubmissionMethod.ONLINE,
                status=ModuleActivityAttempt.Status.IN_PROGRESS,
            ).update(status=ModuleActivityAttempt.Status.SUPERSEDED)
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
        attempt.status = ModuleActivityAttempt.Status.SUBMITTED
        if not attempt.submitted_at:
            attempt.submitted_at = timezone.now()
        attempt.save(update_fields=[
            'score',
            'max_score',
            'recorded_by',
            'status',
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

    def create(self, request, *args, **kwargs):
        if not request.user.is_admin_teacher:
            raise PermissionDenied(
                'Save student answers through the revisioned draft endpoint.'
            )
        return super().create(request, *args, **kwargs)

    def update(self, request, *args, **kwargs):
        if not request.user.is_admin_teacher:
            raise PermissionDenied(
                'Save student answers through the revisioned draft endpoint.'
            )
        return super().update(request, *args, **kwargs)

    def partial_update(self, request, *args, **kwargs):
        kwargs['partial'] = True
        return self.update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        if not request.user.is_admin_teacher:
            raise PermissionDenied(
                'Save student answers through the revisioned draft endpoint.'
            )
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
        queryset = ModuleActivitySubmission.objects.select_related(
            'activity__module',
            'student',
        )

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

    @decorators.action(
        detail=True,
        methods=['get'],
        permission_classes=[IsAdminTeacher],
    )
    def review(self, request, pk=None):
        return response.Response(serialize_submission_review(self.get_object(), request))

    @decorators.action(
        detail=True,
        methods=['post'],
        permission_classes=[IsAdminTeacher],
    )
    def grade(self, request, pk=None):
        submission = self.get_object()
        entry = ModuleActivitySubmissionGradeSerializer(
            data=request.data,
            context={'submission': submission},
        )
        entry.is_valid(raise_exception=True)
        submission.score = entry.validated_data['score']
        submission.feedback = entry.validated_data.get('feedback', '')
        submission.graded_at = timezone.now()
        submission.save(update_fields=('score', 'feedback', 'graded_at'))
        return response.Response(serialize_submission_review(submission, request))


def serialize_submission_review(submission, request):
    activity = submission.activity
    module = activity.module
    linked_items = GradeItem.objects.filter(
        module_activity=activity,
        schedule__isnull=False,
    ).select_related(
        'grade_category',
        'schedule__subject',
    ).order_by('schedule__subject__code', 'schedule__section', 'id')
    serialized = ModuleActivitySubmissionSerializer(
        submission,
        context={'request': request},
    ).data
    return {
        **serialized,
        'student_name': submission.student.get_full_name().strip() or submission.student.username,
        'student_username': submission.student.username,
        'activity_title': activity.title,
        'activity_type': activity.activity_type,
        'activity_points_possible': activity.points_possible,
        'module_id': module.id,
        'module_title': module.title,
        'subject_id': module.subject_id,
        'topic_id': activity.topic_id,
        'lesson_id': activity.lesson_id,
        'linked_grade_items': [
            {
                'id': item.id,
                'schedule_id': item.schedule_id,
                'subject_code': item.schedule.subject.code,
                'section': item.schedule.section,
                'grade_category_id': item.grade_category_id,
                'grading_period': item.grade_category.grading_period,
            }
            for item in linked_items
        ],
    }


class ModuleProgressViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleProgressSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = ModuleProgress.objects.select_related('module', 'student')

        if self.request.user.is_admin_teacher:
            return queryset

        queryset = queryset.filter(
            student=self.request.user,
        ).filter(
            active_module_access_filter(self.request.user, prefix='module__'),
        ).exclude(context_type=LearningContextType.LEGACY).distinct()
        return filter_requested_learning_context(queryset, self.request)

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

        queryset = queryset.filter(
            student=self.request.user,
        ).filter(
            active_module_access_filter(
                self.request.user,
                prefix='topic__module__',
            ),
        ).exclude(context_type=LearningContextType.LEGACY).distinct()
        return filter_requested_learning_context(queryset, self.request)

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
        queryset = queryset.filter(
            student=self.request.user,
        ).filter(
            active_module_access_filter(
                self.request.user,
                prefix='lesson__topic__module__',
            ),
        ).exclude(context_type=LearningContextType.LEGACY).distinct()
        return filter_requested_learning_context(queryset, self.request)

    def perform_create(self, serializer):
        student = serializer.validated_data.get('student', self.request.user)
        serializer.save(student=student)
