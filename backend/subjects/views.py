from datetime import timedelta

from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework import serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsAdminTeacherOrReadOnly
from accounts.models import StudentProfile, User
from accounts.services import (
    create_student_account,
)
from config.cache import CachedReferenceListMixin
from jobs.models import BackgroundJob
from jobs.serializers import BackgroundJobSerializer
from jobs.tasks import enqueue, expire_pending_roster_imports

from .models import ScheduleStudent, SchoolYear, SchoolYearSemester, Subject, SubjectSchedule
from .serializers import (
    ScheduleStudentSerializer,
    SchoolYearSemesterSerializer,
    SchoolYearSerializer,
    RosterStudentCreateSerializer,
    SubjectScheduleSerializer,
    SubjectSerializer,
)
from .roster_import import MAX_ROSTER_IMPORT_ROWS, validate_roster_rows
from .tasks import import_roster_job


class SubjectViewSet(CachedReferenceListMixin, viewsets.ModelViewSet):
    cache_namespace = 'subjects'
    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]


class SchoolYearViewSet(CachedReferenceListMixin, viewsets.ModelViewSet):
    cache_namespace = 'school-years'
    queryset = SchoolYear.objects.all()
    serializer_class = SchoolYearSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]


class SchoolYearSemesterViewSet(CachedReferenceListMixin, viewsets.ModelViewSet):
    cache_namespace = 'school-year-semesters'
    queryset = SchoolYearSemester.objects.select_related('school_year')
    serializer_class = SchoolYearSemesterSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]


class SubjectScheduleViewSet(viewsets.ModelViewSet):
    serializer_class = SubjectScheduleSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_base_queryset(self):
        queryset = SubjectSchedule.objects.select_related(
            'subject',
            'school_year_semester__school_year',
        )

        if not self.request.user.is_admin_teacher:
            queryset = queryset.filter(students__student=self.request.user).distinct()

        return queryset.order_by(
            'school_year_semester_id',
            'subject__code',
            'days',
            'start_time',
            'pk',
        )

    def get_queryset(self):
        queryset = self.get_base_queryset()
        term = self.request.query_params.get('term')
        schedule_status = self.request.query_params.get('status', '').strip().lower()
        search = self.request.query_params.get('search', '').strip()

        if term and term.isdigit():
            queryset = queryset.filter(school_year_semester_id=int(term))
        if schedule_status == 'active':
            queryset = queryset.filter(is_active=True)
        elif schedule_status in {'archived', 'inactive'}:
            queryset = queryset.filter(is_active=False)
        if search:
            queryset = queryset.filter(
                Q(subject__code__icontains=search)
                | Q(subject__name__icontains=search)
                | Q(section__icontains=search)
                | Q(room__icontains=search)
                | Q(days__icontains=search),
            )

        return queryset

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        if 'limit' not in request.query_params:
            return Response(self.get_serializer(queryset, many=True).data)

        limit = bounded_int(request.query_params.get('limit'), default=50, maximum=100)
        offset = bounded_int(request.query_params.get('offset'), default=0)
        count = queryset.count()
        results = queryset[offset:offset + limit]
        return Response({
            'count': count,
            'next': offset + limit if offset + limit < count else None,
            'previous': max(offset - limit, 0) if offset else None,
            'results': self.get_serializer(results, many=True).data,
        })

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user, updated_by=self.request.user)

    def perform_update(self, serializer):
        next_active = serializer.validated_data.get('is_active', serializer.instance.is_active)
        archive_fields = {}
        if serializer.instance.is_active and not next_active:
            archive_fields = {
                'archived_at': timezone.now(),
                'archived_by': self.request.user,
            }
        elif not serializer.instance.is_active and next_active:
            archive_fields = {'archived_at': None, 'archived_by': None}
        serializer.save(updated_by=self.request.user, **archive_fields)

    def destroy(self, request, *args, **kwargs):
        schedule = self.get_object()
        dependencies = schedule_dependency_counts(schedule)
        if dependencies:
            return Response(
                {
                    'detail': 'Archive this class instead. Used classes cannot be permanently deleted.',
                    'dependencies': dependencies,
                },
                status=status.HTTP_409_CONFLICT,
            )
        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'])
    def archive(self, request, pk=None):
        schedule = self.get_object()
        schedule.archive(request.user)
        return Response(self.get_serializer(schedule).data)

    @action(detail=True, methods=['post'])
    def restore(self, request, pk=None):
        schedule = self.get_object()
        serializer = self.get_serializer(schedule, data={'is_active': True}, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save(
            is_active=True,
            archived_at=None,
            archived_by=None,
            updated_by=request.user,
        )
        return Response(serializer.data)

    @action(detail=True, methods=['get'])
    def roster(self, request, pk=None):
        # Roster filters such as `status` and `search` apply to enrollments, not
        # to the parent schedule selected by this detail action.
        schedule = get_object_or_404(self.get_base_queryset(), pk=pk)
        self.check_object_permissions(request, schedule)
        queryset = schedule.students.select_related('student__student_profile')
        enrollment_status = request.query_params.get('status', '').strip().lower()
        search = request.query_params.get('search', '').strip()

        if enrollment_status == 'active':
            queryset = queryset.filter(is_active=True)
        elif enrollment_status == 'inactive':
            queryset = queryset.filter(is_active=False)
        if search:
            queryset = queryset.filter(
                Q(student__first_name__icontains=search)
                | Q(student__last_name__icontains=search)
                | Q(student__username__icontains=search)
                | Q(student__email__icontains=search)
                | Q(student__student_profile__student_number__icontains=search),
            )

        queryset = queryset.order_by(
            'student__last_name',
            'student__first_name',
            'student__username',
        )
        total_count = schedule.students.count()
        active_count = schedule.students.filter(is_active=True).count()
        count = queryset.count()
        limit = bounded_int(request.query_params.get('limit'), default=50, maximum=100)
        offset = bounded_int(request.query_params.get('offset'), default=0)
        enrollments = list(queryset[offset:offset + limit])
        summaries = grade_summaries(schedule, enrollments)
        results = []
        for enrollment in enrollments:
            item = ScheduleStudentSerializer(enrollment).data
            item['email'] = enrollment.student.email
            item['grade_summary'] = summaries.get(enrollment.student_id, {})
            results.append(item)

        return Response({
            'count': count,
            'total_count': total_count,
            'active_count': active_count,
            'inactive_count': total_count - active_count,
            'next': offset + limit if offset + limit < count else None,
            'previous': max(offset - limit, 0) if offset else None,
            'results': results,
        })

    @action(detail=True, methods=['get'], url_path='workspace')
    def workspace(self, request, pk=None):
        schedule = self.get_object()
        section = request.query_params.get('section', '').strip().lower()
        if section not in {'attendance', 'scores', 'grades'}:
            raise serializers.ValidationError({
                'section': 'Use attendance, scores, or grades.',
            })
        enrollments = list(schedule.students.select_related(
            'student', 'student__student_profile', 'schedule__subject',
            'schedule__school_year_semester__school_year',
        ).order_by('student__last_name', 'student__first_name', 'student__username'))
        student_ids = [enrollment.student_id for enrollment in enrollments]

        from accounts.serializers import StudentProfileSerializer, UserSerializer
        from attendance.models import AttendanceRecord, AttendanceSession
        from attendance.serializers import AttendanceRecordSerializer, AttendanceSessionSerializer
        from grades.models import (
            FinalGrade, GradeCategory, GradeItem, PeriodGrade,
            StudentCategoryGrade, StudentGradeItemScore,
        )
        from grades.serializers import (
            FinalGradeSerializer, GradeCategorySerializer, GradeItemSerializer,
            PeriodGradeSerializer, StudentCategoryGradeSerializer,
            StudentGradeItemScoreSerializer,
        )

        context = {'request': request}
        users = [enrollment.student for enrollment in enrollments]
        profiles = [
            enrollment.student.student_profile
            for enrollment in enrollments
            if hasattr(enrollment.student, 'student_profile')
        ]
        payload = {
            'users': UserSerializer(users, many=True, context=context).data,
            'profiles': StudentProfileSerializer(profiles, many=True, context=context).data,
            'enrollments': ScheduleStudentSerializer(enrollments, many=True, context=context).data,
            'attendance_sessions': [],
            'attendance_records': [],
            'grade_categories': [],
            'grade_items': [],
            'grade_item_scores': [],
            'category_grades': [],
            'period_grades': [],
            'final_grades': [],
        }

        if section == 'attendance':
            sessions = AttendanceSession.objects.filter(schedule=schedule)
            payload['attendance_sessions'] = AttendanceSessionSerializer(
                sessions, many=True, context=context,
            ).data
            payload['attendance_records'] = AttendanceRecordSerializer(
                AttendanceRecord.objects.filter(session__schedule=schedule),
                many=True,
                context=context,
            ).data
            return Response(payload)

        categories = GradeCategory.objects.filter(subject=schedule.subject)
        items = GradeItem.objects.filter(schedule=schedule).select_related(
            'grade_category', 'module_activity', 'attendance_session',
        )
        payload['grade_categories'] = GradeCategorySerializer(
            categories, many=True, context=context,
        ).data
        payload['grade_items'] = GradeItemSerializer(
            items, many=True, context=context,
        ).data
        if section == 'scores':
            return Response(payload)

        payload.update({
            'grade_item_scores': StudentGradeItemScoreSerializer(
                StudentGradeItemScore.objects.filter(
                    grade_item__schedule=schedule, student_id__in=student_ids,
                ).select_related('grade_item__grade_category__subject', 'grade_item__schedule', 'student'),
                many=True, context=context,
            ).data,
            'category_grades': StudentCategoryGradeSerializer(
                StudentCategoryGrade.objects.filter(schedule=schedule, student_id__in=student_ids)
                .select_related('schedule', 'subject', 'student', 'grade_category'),
                many=True, context=context,
            ).data,
            'period_grades': PeriodGradeSerializer(
                PeriodGrade.objects.filter(schedule=schedule, student_id__in=student_ids)
                .select_related('schedule', 'subject', 'student'),
                many=True, context=context,
            ).data,
            'final_grades': FinalGradeSerializer(
                FinalGrade.objects.filter(schedule=schedule, student_id__in=student_ids)
                .select_related('schedule', 'subject', 'student'),
                many=True, context=context,
            ).data,
        })
        return Response(payload)

    @action(detail=True, methods=['post'], url_path='enroll-students')
    def enroll_students(self, request, pk=None):
        schedule = self.get_object()
        student_ids = request.data.get('student_ids')
        if not isinstance(student_ids, list) or not student_ids:
            raise serializers.ValidationError({'student_ids': 'Select at least one student.'})

        try:
            normalized_ids = list(dict.fromkeys(int(value) for value in student_ids))
        except (TypeError, ValueError) as error:
            raise serializers.ValidationError({'student_ids': 'Student IDs must be integers.'}) from error

        students = list(User.objects.filter(id__in=normalized_ids, role=User.Role.STUDENT))
        found_ids = {student.id for student in students}
        missing_ids = [student_id for student_id in normalized_ids if student_id not in found_ids]
        if missing_ids:
            raise serializers.ValidationError({'student_ids': f'Unknown student IDs: {missing_ids}.'})

        result = enroll_users(schedule, students, request.user)
        return Response(result)

    @action(detail=True, methods=['post'], url_path='create-student')
    @transaction.atomic
    def create_student(self, request, pk=None):
        schedule = self.get_object()
        if not schedule.is_active:
            return Response(
                {'detail': 'Restore this class before adding a new student.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = RosterStudentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        student_number = serializer.validated_data['student_number']
        existing_profile = (
            StudentProfile.objects.select_for_update()
            .select_related('user')
            .filter(student_number__iexact=student_number)
            .first()
        )
        if existing_profile:
            return existing_roster_student_response(schedule, existing_profile)

        username_conflict = User.objects.filter(username__iexact=student_number).exists()
        if username_conflict:
            return Response({
                'code': 'student_unavailable',
                'detail': 'This student number conflicts with an existing account. Review it in Student Management.',
            }, status=status.HTTP_409_CONFLICT)

        profile = create_student_account(
            student_number=student_number,
            first_name=serializer.validated_data['first_name'],
            last_name=serializer.validated_data['last_name'],
            email=serializer.validated_data.get('email', ''),
            is_active=True,
        )
        enrollment = ScheduleStudent.objects.create(
            schedule=schedule,
            student=profile.user,
            added_by=request.user,
        )
        return Response({
            'student': roster_student_metadata(profile, 'active'),
            'enrollment': ScheduleStudentSerializer(
                enrollment,
                context=self.get_serializer_context(),
            ).data,
            'credentials': {
                'username': profile.student_number,
                'temporary_password': profile.student_number,
                'must_change_password': True,
            },
        }, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='import-roster')
    def import_roster(self, request, pk=None):
        schedule = self.get_object()
        rows = request.data.get('rows')
        dry_run = bool(request.data.get('dry_run', False))
        if not isinstance(rows, list) or not rows:
            raise serializers.ValidationError({'rows': 'Provide at least one roster row.'})
        if len(rows) > MAX_ROSTER_IMPORT_ROWS:
            raise serializers.ValidationError({'rows': 'Roster imports are limited to 1,000 rows.'})

        validation = validate_roster_rows(schedule, rows)
        preview = validation.preview
        if dry_run:
            return Response(preview)
        if not preview['valid']:
            return Response(preview, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            SubjectSchedule.objects.select_for_update().get(pk=schedule.id)
            job = enqueue(
                import_roster_job,
                job_type=BackgroundJob.Type.IMPORT,
                owner=request.user,
                payload={
                    'schedule_id': schedule.id,
                    'actor_id': request.user.id,
                    'rows': validation.rows,
                },
                total=len(validation.rows),
                idempotency_key=f'roster-import:{schedule.id}',
                dispatch_failure_payload={'schedule_id': schedule.id},
            )
        if job.owner_id != request.user.id:
            return Response(
                {'detail': 'Another teacher is already importing this roster.'},
                status=status.HTTP_409_CONFLICT,
            )
        job.refresh_from_db()
        if job.status == BackgroundJob.Status.FAILED and 'rows' in job.payload:
            job.payload = {'schedule_id': schedule.id}
            job.save(update_fields=('payload',))
        return Response(
            {**preview, 'job': BackgroundJobSerializer(job).data},
            status=status.HTTP_202_ACCEPTED,
        )

    @action(detail=True, methods=['get'], url_path='roster-import-status')
    def roster_import_status(self, request, pk=None):
        schedule = self.get_object()
        expire_pending_roster_imports(BackgroundJob.objects.filter(
            owner=request.user,
            idempotency_key=f'roster-import:{schedule.id}',
        ))
        cutoff = timezone.now() - timedelta(days=1)
        job = BackgroundJob.objects.filter(
            job_type=BackgroundJob.Type.IMPORT,
            owner=request.user,
            idempotency_key=f'roster-import:{schedule.id}',
            created_at__gte=cutoff,
        ).first()
        return Response({
            'job': BackgroundJobSerializer(job).data if job else None,
        })


class ScheduleStudentViewSet(viewsets.ModelViewSet):
    serializer_class = ScheduleStudentSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]
    cursor_ordering = ('id',)

    def get_queryset(self):
        queryset = ScheduleStudent.objects.select_related(
            'schedule__subject',
            'schedule__school_year_semester__school_year',
            'student__student_profile',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)

    def perform_create(self, serializer):
        serializer.save(added_by=self.request.user)

    def perform_update(self, serializer):
        next_active = serializer.validated_data.get('is_active', serializer.instance.is_active)
        audit_fields = {}
        if serializer.instance.is_active and not next_active:
            audit_fields = {
                'deactivated_at': timezone.now(),
                'deactivated_by': self.request.user,
            }
        elif not serializer.instance.is_active and next_active:
            audit_fields = {'deactivated_at': None, 'deactivated_by': None}
        serializer.save(**audit_fields)

    def destroy(self, request, *args, **kwargs):
        enrollment = self.get_object()
        enrollment.set_active(False, request.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


def bounded_int(value, default=0, maximum=None):
    try:
        number = max(int(value), 0)
    except (TypeError, ValueError):
        number = default
    return min(number, maximum) if maximum is not None else number


def schedule_dependency_counts(schedule):
    dependencies = {}
    for relation in schedule._meta.related_objects:
        accessor = relation.get_accessor_name()
        related = getattr(schedule, accessor, None)
        if related is None or not hasattr(related, 'count'):
            continue
        count = related.count()
        if count:
            dependencies[accessor] = count
    return dependencies


def roster_student_metadata(profile, enrollment_status):
    return {
        'id': profile.user_id,
        'display_name': profile.user.get_full_name().strip() or profile.student_number,
        'student_number': profile.student_number,
        'enrollment_status': enrollment_status,
    }


def existing_roster_student_response(schedule, profile):
    user = profile.user
    if user.role != User.Role.STUDENT or not user.is_active or not profile.is_active:
        return Response({
            'code': 'student_unavailable',
            'detail': 'This student account is disabled and must be reviewed in Student Management.',
            'student': roster_student_metadata(profile, 'unavailable'),
        }, status=status.HTTP_409_CONFLICT)

    enrollment = (
        ScheduleStudent.objects.select_for_update()
        .filter(schedule=schedule, student=user)
        .first()
    )
    if enrollment and enrollment.is_active:
        enrollment_status = 'active'
        detail = 'This student is already active in the roster.'
    elif enrollment:
        enrollment_status = 'inactive'
        detail = 'This student already exists and can be reactivated.'
    else:
        enrollment_status = 'not_enrolled'
        detail = 'This student already exists and can be added to this class.'

    return Response({
        'code': 'student_exists',
        'detail': detail,
        'student': roster_student_metadata(profile, enrollment_status),
    }, status=status.HTTP_409_CONFLICT)


@transaction.atomic
def enroll_users(schedule, students, actor):
    added = 0
    reactivated = 0
    already_active = 0
    existing = {
        enrollment.student_id: enrollment
        for enrollment in ScheduleStudent.objects.select_for_update().filter(
            schedule=schedule,
            student__in=students,
        )
    }
    for student in students:
        enrollment = existing.get(student.id)
        if enrollment and enrollment.is_active:
            already_active += 1
        elif enrollment:
            enrollment.set_active(True, actor)
            reactivated += 1
        else:
            ScheduleStudent.objects.create(
                schedule=schedule,
                student=student,
                added_by=actor,
            )
            added += 1
    return {
        'added_count': added,
        'reactivated_count': reactivated,
        'already_active_count': already_active,
    }


def grade_summaries(schedule, enrollments):
    from grades.models import FinalGrade, PeriodGrade

    student_ids = [enrollment.student_id for enrollment in enrollments]
    summaries = {student_id: {} for student_id in student_ids}
    for grade in PeriodGrade.objects.filter(schedule=schedule, student_id__in=student_ids):
        summaries[grade.student_id][grade.grading_period.lower()] = grade.raw_score
    for grade in FinalGrade.objects.filter(schedule=schedule, student_id__in=student_ids):
        summaries[grade.student_id].update({
            'prelim': grade.prelim_grade,
            'midterm': grade.midterm_grade,
            'prefinal': grade.prefinal_grade,
            'final': grade.final_period_grade,
            'overall': grade.final_grade,
            'remarks': grade.remarks,
        })
    return summaries
