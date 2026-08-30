import re

from django.core.exceptions import ValidationError as DjangoValidationError
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
    clean_student_number,
    create_student_account,
    validate_student_number_available,
)
from config.cache import CachedReferenceListMixin

from .models import ScheduleStudent, SchoolYear, SchoolYearSemester, Subject, SubjectSchedule
from .serializers import (
    ScheduleStudentSerializer,
    SchoolYearSemesterSerializer,
    SchoolYearSerializer,
    SubjectScheduleSerializer,
    SubjectSerializer,
)


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

        sessions = AttendanceSession.objects.filter(schedule=schedule)
        session_ids = sessions.values_list('id', flat=True)
        categories = GradeCategory.objects.filter(subject=schedule.subject)
        items = GradeItem.objects.filter(schedule=schedule).select_related(
            'grade_category', 'module_activity', 'attendance_session',
        )
        context = {'request': request}
        users = [enrollment.student for enrollment in enrollments]
        profiles = [
            enrollment.student.student_profile
            for enrollment in enrollments
            if hasattr(enrollment.student, 'student_profile')
        ]
        return Response({
            'users': UserSerializer(users, many=True, context=context).data,
            'profiles': StudentProfileSerializer(profiles, many=True, context=context).data,
            'enrollments': ScheduleStudentSerializer(enrollments, many=True, context=context).data,
            'attendance_sessions': AttendanceSessionSerializer(sessions, many=True, context=context).data,
            'attendance_records': AttendanceRecordSerializer(
                AttendanceRecord.objects.filter(session_id__in=session_ids), many=True, context=context,
            ).data,
            'grade_categories': GradeCategorySerializer(categories, many=True, context=context).data,
            'grade_items': GradeItemSerializer(items, many=True, context=context).data,
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

    @action(detail=True, methods=['post'], url_path='import-roster')
    @transaction.atomic
    def import_roster(self, request, pk=None):
        schedule = self.get_object()
        rows = request.data.get('rows')
        dry_run = bool(request.data.get('dry_run', False))
        if not isinstance(rows, list) or not rows:
            raise serializers.ValidationError({'rows': 'Provide at least one roster row.'})
        if len(rows) > 1000:
            raise serializers.ValidationError({'rows': 'Roster imports are limited to 1,000 rows.'})

        profiles_by_number = {
            profile.student_number.strip().casefold(): profile
            for profile in StudentProfile.objects.select_for_update().select_related('user')
        }
        enrollments_by_student = {
            enrollment.student_id: enrollment
            for enrollment in ScheduleStudent.objects.select_for_update().filter(schedule=schedule)
        }
        seen = set()
        validated = []
        row_results = []
        has_errors = False
        summary = {'create_count': 0, 'enroll_count': 0, 'reactivate_count': 0, 'already_active_count': 0}
        for index, row in enumerate(rows, start=1):
            if not isinstance(row, dict):
                row_results.append({'row': index, 'status': 'error', 'error': 'Row must be an object.'})
                has_errors = True
                continue
            student_number = str(row.get('student_number') or '').strip()
            first_name = normalize_imported_person_name(row.get('first_name'))
            middle_name = normalize_imported_person_name(row.get('middle_name'))
            last_name = normalize_imported_person_name(row.get('last_name'))
            normalized = student_number.casefold()
            if not normalized:
                row_results.append({'row': index, 'status': 'error', 'error': 'Student number is required.'})
                has_errors = True
                continue
            if len(student_number) > StudentProfile._meta.get_field('student_number').max_length:
                row_results.append({
                    'row': index,
                    'student_number': student_number,
                    'status': 'error',
                    'error': 'Student number is too long.',
                })
                has_errors = True
                continue
            if normalized in seen:
                row_results.append({
                    'row': index,
                    'student_number': student_number,
                    'status': 'error',
                    'error': 'Duplicate student number in this file.',
                })
                has_errors = True
                continue
            seen.add(normalized)
            profile = profiles_by_number.get(normalized)
            if profile and (
                profile.user.role != User.Role.STUDENT
                or not profile.user.is_active
                or not profile.is_active
            ):
                row_results.append({
                    'row': index,
                    'student_number': student_number,
                    'status': 'error',
                    'error': 'This student account is disabled and must be reviewed in Student Management.',
                })
                has_errors = True
                continue
            if profile:
                enrollment = enrollments_by_student.get(profile.user_id)
                if enrollment and enrollment.is_active:
                    row_status = 'already_enrolled'
                    summary['already_active_count'] += 1
                elif enrollment:
                    row_status = 'reactivate'
                    summary['reactivate_count'] += 1
                else:
                    row_status = 'enroll'
                    summary['enroll_count'] += 1
                validated.append({'profile': profile, 'status': row_status})
                row_results.append({
                    'row': index,
                    'student_number': profile.student_number,
                    'student_id': profile.user_id,
                    'student_name': profile.user.get_full_name() or profile.student_number,
                    'status': row_status,
                })
                continue

            if not first_name or not last_name:
                row_results.append({
                    'row': index,
                    'student_number': student_number,
                    'status': 'error',
                    'error': 'First name and last name are required for a new student.',
                })
                has_errors = True
                continue
            try:
                clean_student_number(student_number)
                validate_student_number_available(student_number)
            except DjangoValidationError as error:
                row_results.append({
                    'row': index,
                    'student_number': student_number,
                    'status': 'error',
                    'error': ' '.join(error.messages),
                })
                has_errors = True
                continue
            account_first_name = ' '.join(part for part in (first_name, middle_name) if part)
            if len(account_first_name) > 150 or len(last_name) > 150:
                row_results.append({
                    'row': index,
                    'student_number': student_number,
                    'status': 'error',
                    'error': 'The combined first and middle name, and the last name, must each be 150 characters or fewer.',
                })
                has_errors = True
                continue
            validated.append({
                'first_name': account_first_name,
                'last_name': last_name,
                'student_number': student_number,
                'status': 'create',
            })
            summary['create_count'] += 1
            row_results.append({
                'row': index,
                'student_number': student_number,
                'student_name': f'{account_first_name} {last_name}',
                'status': 'create',
            })

        preview = {
            'valid': not has_errors,
            'row_count': len(rows),
            'ready_count': len(validated),
            'rows': row_results,
            **summary,
        }
        if dry_run:
            return Response(preview)
        if has_errors:
            return Response(preview, status=status.HTTP_400_BAD_REQUEST)

        students = []
        credentials = []
        for entry in validated:
            profile = entry.get('profile')
            if profile:
                students.append(profile.user)
                continue
            profile = create_student_account(
                student_number=entry['student_number'],
                first_name=entry['first_name'],
                last_name=entry['last_name'],
                email='',
                is_active=True,
            )
            students.append(profile.user)
            credentials.append({
                'student_number': entry['student_number'],
                'temporary_password': entry['student_number'],
            })

        preview.update(enroll_users(schedule, students, request.user))
        preview['created_count'] = len(credentials)
        preview['credentials'] = credentials
        return Response(preview)


class ScheduleStudentViewSet(viewsets.ModelViewSet):
    serializer_class = ScheduleStudentSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

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


def normalize_imported_person_name(value):
    cleaned = ' '.join(str(value or '').split())
    return re.sub(
        r"(^|[\s\-'\u2019])([^\W\d_])",
        lambda match: f'{match.group(1)}{match.group(2).upper()}',
        cleaned,
        flags=re.UNICODE,
    )
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
