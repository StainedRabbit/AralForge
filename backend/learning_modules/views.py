from django.http import FileResponse
from django.utils import timezone
from rest_framework import decorators, permissions, response, viewsets
from rest_framework.exceptions import PermissionDenied

from accounts.permissions import IsAdminTeacherOrReadOnly
from subjects.models import ScheduleStudent

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
    ModuleActivityMatchingPairSerializer,
    ModuleActivityQuestionChoiceSerializer,
    ModuleActivityQuestionSerializer,
    ModuleActivitySubmissionSerializer,
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
from .services.pdf_generation import generate_lesson_pdf, generate_module_pdf


class ModuleViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

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

    def get_queryset(self):
        queryset = ModuleLesson.objects.select_related('topic', 'topic__module')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            is_published=True,
            topic__is_published=True,
            topic__module__is_published=True,
        ).filter(
            active_module_access_filter(self.request.user, prefix='topic__module__'),
        ).distinct()

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
            key_terms=lesson.key_terms,
            before_you_start=lesson.before_you_start,
            short_discussion=lesson.short_discussion,
            guided_examples=lesson.guided_examples,
            lets_practice=lesson.lets_practice,
            apply_what_you_learned=lesson.apply_what_you_learned,
            challenge_task=lesson.challenge_task,
            rubric=lesson.rubric,
            reflection=lesson.reflection,
            evidence_of_learning=lesson.evidence_of_learning,
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
                mini_check=example.mini_check,
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
        ).distinct()


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

    def get_queryset(self):
        queryset = ModuleActivityAttempt.objects.select_related(
            'activity',
            'activity__module',
            'activity__lesson',
            'student',
        )

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
        serializer.save(student=student)

    @decorators.action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        attempt = self.get_object()
        if not request.user.is_admin_teacher and attempt.student_id != request.user.id:
            raise PermissionDenied('Students can only submit their own attempts.')
        if attempt.is_submitted:
            serializer = self.get_serializer(attempt)
            return response.Response(serializer.data)

        attempt = submit_activity_attempt(attempt)
        serializer = self.get_serializer(attempt)
        return response.Response(serializer.data)


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
