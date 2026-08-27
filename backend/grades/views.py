from decimal import Decimal

from django.db import transaction
from django.db.models import Count, Max, Q, Sum
from django.shortcuts import get_object_or_404
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminTeacher, IsAdminTeacherOrReadOnly
from accounts.models import User
from accounts.serializers import UserSerializer
from attendance.models import AttendanceSession
from gamification.models import LevelRule, PointLedger
from gamification.serializers import LevelRuleSerializer, PointLedgerSerializer
from learning_modules.models import Module, ModuleActivity, ModuleActivityAttempt
from learning_modules.serializers import (
    ModuleActivityAttemptSerializer,
    ModuleActivitySerializer,
)
from subjects.models import SchoolYearSemester, ScheduleStudent, Subject, SubjectSchedule
from subjects.serializers import (
    ScheduleStudentSerializer,
    SchoolYearSemesterSerializer,
    SubjectScheduleSerializer,
)

from .models import (
    FinalGrade,
    GradeCategory,
    GradeCategoryChoices,
    GradeItem,
    GradeItemSourceType,
    GradingTemplate,
    GradingTemplateItem,
    PeriodGrade,
    StudentCategoryGrade,
    StudentGradeItemScore,
    SubjectGradingPolicy,
)
from .serializers import (
    FinalGradeSerializer,
    GradeCategorySerializer,
    GradeItemSerializer,
    GradingTemplateItemSerializer,
    GradingTemplateSerializer,
    PeriodGradeSerializer,
    StudentCategoryGradeSerializer,
    StudentGradeItemScoreSerializer,
    SubjectGradingPolicySerializer,
)


class StudentGradeOverviewView(APIView):
    def get(self, request):
        if request.user.is_admin_teacher:
            return Response({'detail': 'Student grade overview is only available to students.'}, status=403)
        enrollments = ScheduleStudent.objects.select_related(
            'schedule__subject', 'schedule__school_year_semester__school_year', 'student',
        ).filter(student=request.user, is_active=True, schedule__is_active=True)
        schedule_ids = enrollments.values_list('schedule_id', flat=True)
        categories = GradeCategory.objects.filter(subject__schedules__id__in=schedule_ids).distinct()
        context = {'request': request}
        return Response({
            'enrollments': ScheduleStudentSerializer(enrollments, many=True, context=context).data,
            'schedules': SubjectScheduleSerializer(
                SubjectSchedule.objects.filter(id__in=schedule_ids), many=True, context=context,
            ).data,
            'categories': GradeCategorySerializer(categories, many=True, context=context).data,
            'category_grades': StudentCategoryGradeSerializer(
                StudentCategoryGrade.objects.filter(student=request.user, schedule_id__in=schedule_ids), many=True, context=context,
            ).data,
            'period_grades': PeriodGradeSerializer(
                PeriodGrade.objects.filter(student=request.user, schedule_id__in=schedule_ids), many=True, context=context,
            ).data,
            'final_grades': FinalGradeSerializer(
                FinalGrade.objects.filter(student=request.user, schedule_id__in=schedule_ids), many=True, context=context,
            ).data,
            'points': PointLedgerSerializer(PointLedger.objects.filter(student=request.user), many=True, context=context).data,
            'levels': LevelRuleSerializer(LevelRule.objects.all(), many=True, context=context).data,
        })


class TeacherGradesOverviewView(APIView):
    permission_classes = [IsAdminTeacher]

    def get(self, request):
        limit = bounded_query_int(request.query_params.get('limit'), 12, 50)
        offset = bounded_query_int(request.query_params.get('offset'), 0)
        term = request.query_params.get('term', '').strip()
        search = request.query_params.get('search', '').strip()

        schedules = SubjectSchedule.objects.select_related(
            'subject', 'school_year_semester__school_year',
        ).filter(is_active=True)
        if term.isdigit():
            schedules = schedules.filter(school_year_semester_id=int(term))
        if search:
            schedules = schedules.filter(
                Q(subject__code__icontains=search)
                | Q(subject__name__icontains=search)
                | Q(section__icontains=search)
                | Q(room__icontains=search)
            )
        schedules = schedules.order_by(
            '-school_year_semester__school_year__start_year',
            'school_year_semester__semester',
            'subject__code',
            'section',
            'id',
        )
        count = schedules.count()
        page = list(schedules[offset:offset + limit])
        schedule_ids = [schedule.id for schedule in page]
        subject_ids = {schedule.subject_id for schedule in page}

        enrollment_counts = grouped_counts(
            ScheduleStudent.objects.filter(schedule_id__in=schedule_ids, is_active=True),
            'schedule_id',
        )
        item_counts = grouped_counts(
            GradeItem.objects.filter(schedule_id__in=schedule_ids),
            'schedule_id',
        )
        pending_counts = {
            row['schedule_id']: row['total'] or 0
            for row in StudentCategoryGrade.objects.filter(schedule_id__in=schedule_ids)
            .values('schedule_id')
            .annotate(total=Sum('pending_item_count'))
        }
        completed_period_counts = grouped_counts(
            PeriodGrade.objects.filter(
                schedule_id__in=schedule_ids,
                completion_status='COMPLETE',
            ),
            'schedule_id',
        )
        category_rows = list(
            GradeCategory.objects.filter(subject_id__in=subject_ids)
            .values('subject_id', 'grading_period', 'weight')
        )

        results = []
        periods = ('PRELIM', 'MIDTERM', 'PREFINAL', 'FINAL')
        for schedule in page:
            subject_categories = [
                row for row in category_rows if row['subject_id'] == schedule.subject_id
            ]
            configured_periods = sum(
                any(row['grading_period'] == period for row in subject_categories)
                for period in periods
            )
            weights_ready = all(
                abs(sum(
                    (row['weight'] for row in subject_categories if row['grading_period'] == period),
                    Decimal('0'),
                ) - Decimal('100')) < Decimal('0.01')
                and any(row['grading_period'] == period for row in subject_categories)
                for period in periods
            )
            student_count = enrollment_counts.get(schedule.id, 0)
            expected_periods = student_count * len(periods)
            completed_periods = completed_period_counts.get(schedule.id, 0)
            results.append({
                'schedule': SubjectScheduleSerializer(schedule).data,
                'active_student_count': student_count,
                'grade_item_count': item_counts.get(schedule.id, 0),
                'pending_item_count': pending_counts.get(schedule.id, 0),
                'configured_period_count': configured_periods,
                'weights_ready': weights_ready,
                'completed_period_count': completed_periods,
                'expected_period_count': expected_periods,
                'completion_percent': round(
                    min(100, (completed_periods / expected_periods) * 100)
                ) if expected_periods else 0,
            })

        active_schedules = SubjectSchedule.objects.filter(is_active=True)
        summary = {
            'active_classes': active_schedules.count(),
            'active_enrollments': ScheduleStudent.objects.filter(
                schedule__is_active=True, is_active=True,
            ).count(),
            'grade_items': GradeItem.objects.filter(schedule__is_active=True).count(),
            'pending_records': (
                StudentCategoryGrade.objects.filter(completion_status='PENDING').count()
                + PeriodGrade.objects.filter(completion_status='PENDING').count()
                + FinalGrade.objects.filter(completion_status='PENDING').count()
            ),
            'completed_finals': FinalGrade.objects.filter(completion_status='COMPLETE').count(),
        }
        terms = SchoolYearSemester.objects.select_related('school_year').order_by(
            '-school_year__start_year', 'semester', 'id',
        )
        return Response({
            'summary': summary,
            'terms': SchoolYearSemesterSerializer(terms, many=True).data,
            'count': count,
            'next': offset + limit if offset + limit < count else None,
            'previous': max(0, offset - limit) if offset > 0 else None,
            'results': results,
        })


class TeacherGradebookView(APIView):
    permission_classes = [IsAdminTeacher]

    def get(self, request):
        schedule_id = request.query_params.get('schedule')
        if not schedule_id or not schedule_id.isdigit():
            return Response({'detail': 'A valid schedule is required.'}, status=400)
        schedule = get_object_or_404(
            SubjectSchedule.objects.select_related('subject', 'school_year_semester__school_year'),
            pk=schedule_id,
        )
        period = request.query_params.get('period', 'PRELIM').strip().upper()
        categories = GradeCategory.objects.filter(subject=schedule.subject)
        if period:
            categories = categories.filter(grading_period=period)
        categories = categories.order_by('category', 'name', 'id')
        requested_category = request.query_params.get('category', '').strip()
        selected_category = next(
            (category for category in categories if requested_category.isdigit() and category.id == int(requested_category)),
            categories.first(),
        )
        items = list(
            GradeItem.objects.filter(schedule=schedule, grade_category=selected_category)
            .select_related('grade_category')
            .order_by('grade_category_id', 'order', 'id')
        ) if selected_category else []
        requested_item = request.query_params.get('item', '').strip()
        selected_item = next(
            (item for item in items if requested_item.isdigit() and item.id == int(requested_item)),
            items[0] if items else None,
        )
        limit = bounded_query_int(request.query_params.get('limit'), 50, 100)
        offset = bounded_query_int(request.query_params.get('offset'), 0)
        search = request.query_params.get('search', '').strip()
        roster_filter = request.query_params.get('filter', 'ALL').strip().upper()
        enrollment_queryset = ScheduleStudent.objects.filter(schedule=schedule, is_active=True)
        total_count = enrollment_queryset.count()
        requested_student = request.query_params.get('student', '').strip()
        if requested_student.isdigit():
            enrollment_queryset = enrollment_queryset.filter(student_id=int(requested_student))
        if search:
            enrollment_queryset = enrollment_queryset.filter(
                Q(student__first_name__icontains=search)
                | Q(student__last_name__icontains=search)
                | Q(student__username__icontains=search)
                | Q(student__student_profile__student_number__icontains=search)
            )
        enrollments = list(
            enrollment_queryset
            .select_related('student__student_profile')
            .order_by('student__last_name', 'student__first_name', 'student__username', 'id')
        )
        selected_scores = {}
        selected_attempts = {}
        if selected_item:
            selected_scores = {
                score.student_id: score
                for score in StudentGradeItemScore.objects.filter(grade_item=selected_item)
            }
            if selected_item.module_activity_id:
                selected_attempts = {
                    (attempt.student_id, attempt.submission_method): attempt
                    for attempt in ModuleActivityAttempt.objects.filter(
                        activity_id=selected_item.module_activity_id,
                        student_id__in=[row.student_id for row in enrollments],
                        is_submitted=True,
                    ).order_by('id')
                }

        status_by_student = {
            row.student_id: gradebook_roster_status(
                selected_item,
                selected_scores.get(row.student_id),
                selected_attempts.get((row.student_id, 'PAPER')),
                selected_attempts.get((row.student_id, 'ONLINE')),
            )
            for row in enrollments
        }
        status_counts = {
            key: sum(status == key for status in status_by_student.values())
            for key in ('PENDING', 'ONLINE', 'PAPER', 'EXCUSED', 'OVERRIDDEN')
        }
        filtered = enrollments
        if roster_filter != 'ALL':
            filtered = [
                row for row in filtered if status_by_student.get(row.student_id) == roster_filter
            ]
        count = len(filtered)
        page_enrollments = filtered[offset:offset + limit]
        page_student_ids = [row.student_id for row in page_enrollments]
        item_ids = [item.id for item in items]
        scores = StudentGradeItemScore.objects.filter(
            grade_item_id__in=item_ids,
            student_id__in=page_student_ids,
        ).select_related('grade_item', 'student')
        category_grades = StudentCategoryGrade.objects.filter(
            schedule=schedule,
            grade_category__in=categories,
            student_id__in=page_student_ids,
        ).select_related('schedule', 'subject', 'student', 'grade_category')
        activity_ids = {item.module_activity_id for item in items if item.module_activity_id}
        attempts = ModuleActivityAttempt.objects.filter(
            activity_id__in=activity_ids,
            student_id__in=page_student_ids,
        ).select_related('student')
        activities = ModuleActivity.objects.filter(id__in=activity_ids).select_related('module', 'lesson')
        recorded_by_ids = attempts.exclude(recorded_by_id=None).values_list('recorded_by_id', flat=True)
        users = User.objects.filter(id__in=recorded_by_ids)
        context = {'request': request}
        return Response({
            'schedule': SubjectScheduleSerializer(schedule, context=context).data,
            'enrollments': ScheduleStudentSerializer(page_enrollments, many=True, context=context).data,
            'categories': GradeCategorySerializer(categories, many=True, context=context).data,
            'items': GradeItemSerializer(items, many=True, context=context).data,
            'scores': StudentGradeItemScoreSerializer(scores, many=True, context=context).data,
            'category_grades': StudentCategoryGradeSerializer(category_grades, many=True, context=context).data,
            'modules': [],
            'activities': ModuleActivitySerializer(activities, many=True, context=context).data,
            'activity_attempts': ModuleActivityAttemptSerializer(attempts, many=True, context=context).data,
            'attendance_sessions': [],
            'users': UserSerializer(users, many=True, context=context).data,
            'status_counts': status_counts,
            'count': count,
            'total_count': total_count,
            'next': offset + limit if offset + limit < count else None,
            'previous': max(0, offset - limit) if offset > 0 else None,
        })


class TeacherGradeSourceOptionsView(APIView):
    permission_classes = [IsAdminTeacher]

    def get(self, request):
        schedule = get_object_or_404(
            SubjectSchedule.objects.select_related('subject'),
            pk=request.query_params.get('schedule'),
        )
        source_type = request.query_params.get('type', 'MODULE_ACTIVITY').strip().upper()
        search = request.query_params.get('search', '').strip()
        limit = bounded_query_int(request.query_params.get('limit'), 20, 50)
        offset = bounded_query_int(request.query_params.get('offset'), 0)
        if source_type == 'MODULE_ACTIVITY':
            modules = Module.objects.filter(
                Q(subject=schedule.subject) | Q(subjects=schedule.subject),
            ).distinct()
            queryset = ModuleActivity.objects.filter(module__in=modules).order_by('title', 'id')
            if search:
                queryset = queryset.filter(title__icontains=search)
            count = queryset.count()
            rows = queryset[offset:offset + limit]
            results = [
                {'value': row.id, 'label': row.title, 'points': row.points_possible}
                for row in rows
            ]
        elif source_type == 'ATTENDANCE':
            queryset = AttendanceSession.objects.filter(schedule=schedule).order_by('-date', '-id')
            if search:
                queryset = queryset.filter(title__icontains=search)
            count = queryset.count()
            rows = queryset[offset:offset + limit]
            results = [
                {
                    'value': row.id,
                    'label': row.title or str(row.date),
                    'points': row.points_possible,
                }
                for row in rows
            ]
        else:
            return Response({'detail': 'Type must be MODULE_ACTIVITY or ATTENDANCE.'}, status=400)
        return Response({
            'count': count,
            'next': offset + limit if offset + limit < count else None,
            'previous': max(0, offset - limit) if offset > 0 else None,
            'results': results,
        })


def bounded_query_int(value, default, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    parsed = max(0, parsed)
    return min(parsed, maximum) if maximum is not None else parsed


def grouped_counts(queryset, field):
    return {
        row[field]: row['total']
        for row in queryset.values(field).annotate(total=Count('id'))
    }


def gradebook_roster_status(item, score, paper_attempt, online_attempt):
    if not item:
        return 'PENDING'
    if score and score.status == StudentGradeItemScore.Status.EXCUSED:
        return 'EXCUSED'
    if score and score.origin == StudentGradeItemScore.Origin.OVERRIDE:
        return 'OVERRIDDEN'
    if paper_attempt:
        return 'PAPER'
    if online_attempt or score:
        return 'ONLINE'
    return 'PENDING'


class SubjectGradingPolicyViewSet(viewsets.ModelViewSet):
    queryset = SubjectGradingPolicy.objects.select_related('subject', 'source_template')
    serializer_class = SubjectGradingPolicySerializer
    permission_classes = [IsAdminTeacherOrReadOnly]
    search_fields = ('subject__code', 'subject__name', 'source_template__name')


class GradingTemplateViewSet(viewsets.ModelViewSet):
    queryset = GradingTemplate.objects.prefetch_related('items')
    serializer_class = GradingTemplateSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]
    search_fields = ('name', 'description')

    @action(detail=True, methods=['post'], url_path='apply-to-subject')
    def apply_to_subject(self, request, pk=None):
        template = self.get_object()
        subject_id = request.data.get('subject')
        subject = get_object_or_404(Subject, pk=subject_id)
        categories = template.apply_to_subject(subject)
        return Response({'synced_categories': len(categories)})


class GradingTemplateItemViewSet(viewsets.ModelViewSet):
    queryset = GradingTemplateItem.objects.select_related('template')
    serializer_class = GradingTemplateItemSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]
    search_fields = ('name', 'category', 'grading_period', 'template__name')


class GradeCategoryViewSet(viewsets.ModelViewSet):
    queryset = GradeCategory.objects.select_related('subject', 'template_item')
    serializer_class = GradeCategorySerializer
    permission_classes = [IsAdminTeacherOrReadOnly]
    search_fields = ('name', 'category', 'grading_period', 'subject__code', 'subject__name')


class StudentCategoryGradeViewSet(viewsets.ModelViewSet):
    serializer_class = StudentCategoryGradeSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = StudentCategoryGrade.objects.select_related('schedule', 'subject', 'student', 'grade_category')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user).filter(
            Q(schedule__isnull=True)
            | Q(
                schedule__students__student=self.request.user,
                schedule__students__is_active=True,
                schedule__is_active=True,
            ),
        ).distinct()


class GradeItemViewSet(viewsets.ModelViewSet):
    serializer_class = GradeItemSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = GradeItem.objects.select_related(
            'grade_category',
            'grade_category__subject',
            'schedule',
            'module_activity',
            'attendance_session',
        )

        if not self.request.user.is_admin_teacher:
            queryset = queryset.filter(
                schedule__students__student=self.request.user,
                schedule__students__is_active=True,
                schedule__is_active=True,
            ).distinct()

        schedule = self.request.query_params.get('schedule')
        source_type = self.request.query_params.get('source_type')
        grading_period = self.request.query_params.get('period')
        item_date = self.request.query_params.get('date')
        if schedule:
            queryset = queryset.filter(schedule_id=schedule)
        if source_type:
            queryset = queryset.filter(source_type=source_type)
        if grading_period:
            queryset = queryset.filter(grade_category__grading_period=grading_period)
        if item_date:
            queryset = queryset.filter(date=item_date)
        return queryset

    @action(detail=False, methods=['post'], url_path='assign-main-activity')
    @transaction.atomic
    def assign_main_activity(self, request):
        require_teacher(request)
        activity_id = request.data.get('module_activity')
        assignments = request.data.get('assignments')
        if not activity_id:
            raise serializers.ValidationError({'module_activity': 'A Main Activity is required.'})
        if not isinstance(assignments, list) or not assignments:
            raise serializers.ValidationError({'assignments': 'Select at least one class assignment.'})

        activity = get_object_or_404(
            ModuleActivity.objects.select_related('module', 'lesson').prefetch_related('questions'),
            pk=activity_id,
        )
        readiness_errors = main_activity_readiness_errors(activity)
        if readiness_errors:
            raise serializers.ValidationError({'module_activity': readiness_errors})

        validated_rows = validate_main_activity_assignments(activity, assignments)
        items = []
        created_count = 0
        updated_count = 0
        for schedule, category, existing_item in validated_rows:
            values = {
                'schedule': schedule.id,
                'grade_category': category.id,
                'title': activity.title,
                'points_possible': activity.points_possible,
                'is_required': True,
                'source_type': GradeItemSourceType.MODULE_ACTIVITY,
                'module_activity': activity.id,
            }
            if existing_item:
                item_serializer = self.get_serializer(existing_item, data=values, partial=True)
                updated_count += 1
            else:
                maximum = GradeItem.objects.filter(
                    schedule=schedule,
                    grade_category=category,
                ).aggregate(maximum=Max('order'))['maximum']
                values['order'] = (maximum if maximum is not None else -1) + 1
                item_serializer = self.get_serializer(data=values)
                created_count += 1
            item_serializer.is_valid(raise_exception=True)
            items.append(item_serializer.save())

        return Response({
            'items': self.get_serializer(items, many=True).data,
            'created_count': created_count,
            'updated_count': updated_count,
        })

    @action(detail=False, methods=['post'], url_path='score-sheet')
    @transaction.atomic
    def score_sheet(self, request):
        require_teacher(request)
        schedule = get_object_or_404(
            SubjectSchedule.objects.select_for_update(of=('self',)).select_related('subject'),
            pk=request.data.get('schedule'),
        )
        if not schedule.is_active:
            raise serializers.ValidationError({'schedule': 'Archived classes cannot record scores.'})

        category = get_object_or_404(GradeCategory, pk=request.data.get('grade_category'))
        if category.category == 'ATTENDANCE':
            raise serializers.ValidationError({
                'grade_category': 'Use the attendance workflow for attendance categories.',
            })
        if not request.data.get('date'):
            raise serializers.ValidationError({'date': 'A score-sheet date is required.'})
        order = GradeItem.objects.filter(
            schedule=schedule,
            grade_category=category,
        ).aggregate(maximum=Max('order'))['maximum']
        item_serializer = self.get_serializer(data={
            'schedule': schedule.id,
            'grade_category': category.id,
            'title': request.data.get('title'),
            'date': request.data.get('date'),
            'points_possible': request.data.get('points_possible'),
            'order': (order if order is not None else -1) + 1,
            'is_required': True,
            'source_type': 'MANUAL',
        })
        item_serializer.is_valid(raise_exception=True)
        item = item_serializer.save()
        save_score_sheet_roster(item, request.data.get('records'))
        return Response(score_sheet_payload(item), status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'put'], url_path='roster')
    @transaction.atomic
    def roster(self, request, pk=None):
        require_teacher(request)
        item = self.get_object()
        if request.method == 'PUT':
            if not item.schedule_id or not item.schedule.is_active:
                raise serializers.ValidationError({'schedule': 'Archived or unassigned classes cannot record scores.'})
            if item.source_type != 'MANUAL':
                raise serializers.ValidationError({'source_type': 'Only manual score sheets can be edited here.'})
            SubjectSchedule.objects.select_for_update(of=('self',)).get(pk=item.schedule_id)
            save_score_sheet_roster(item, request.data.get('records'))
            item.refresh_from_db()
        return Response(score_sheet_payload(item))

    @action(detail=True, methods=['post'])
    def resync(self, request, pk=None):
        from .source_sync import sync_grade_item

        item = self.get_object()
        return Response({'synchronized_scores': sync_grade_item(item)})


def require_teacher(request):
    if not request.user.is_admin_teacher:
        raise PermissionDenied('Only the teacher can manage class score sheets.')


def main_activity_readiness_errors(activity):
    errors = []
    if activity.activity_type != ModuleActivity.ActivityType.INTERACTIVE or not activity.lesson_id:
        errors.append('Only an interactive lesson Main Activity can be assigned.')
    if not activity.is_published:
        errors.append('Publish the Main Activity before assigning it.')
    if not activity.title.strip():
        errors.append('Add a title before assigning it.')
    if not activity.instructions.strip():
        errors.append('Add instructions before assigning it.')
    if activity.points_possible <= 0:
        errors.append('Points possible must be greater than zero.')
    if not any(question.is_published for question in activity.questions.all()):
        errors.append('Publish at least one question before assigning it.')
    return errors


def validate_main_activity_assignments(activity, assignments):
    row_errors = {}
    parsed_rows = []
    schedule_ids = []
    category_ids = []
    for index, assignment in enumerate(assignments):
        if not isinstance(assignment, dict):
            row_errors[index] = {'detail': 'Each assignment must be an object.'}
            continue
        try:
            schedule_id = int(assignment.get('schedule'))
            category_id = int(assignment.get('grade_category'))
        except (TypeError, ValueError):
            row_errors[index] = {'detail': 'A valid class and Quiz category are required.'}
            continue
        if schedule_id in schedule_ids:
            row_errors[index] = {'schedule': 'Each class may appear only once.'}
            continue
        schedule_ids.append(schedule_id)
        category_ids.append(category_id)
        parsed_rows.append((index, schedule_id, category_id))

    schedules = {
        schedule.id: schedule
        for schedule in SubjectSchedule.objects.select_for_update(of=('self',)).select_related('subject').filter(pk__in=schedule_ids)
    }
    categories = {
        category.id: category
        for category in GradeCategory.objects.select_related('subject').filter(pk__in=category_ids)
    }
    validated = []
    for index, schedule_id, category_id in parsed_rows:
        schedule = schedules.get(schedule_id)
        category = categories.get(category_id)
        errors = {}
        if not schedule:
            errors['schedule'] = 'This class does not exist.'
        elif not schedule.is_active:
            errors['schedule'] = 'Archived classes cannot be assigned.'
        if not category:
            errors['grade_category'] = 'This grade category does not exist.'
        elif category.category != GradeCategoryChoices.QUIZ:
            errors['grade_category'] = 'Select an existing Quiz category.'
        if schedule and category and schedule.subject_id != category.subject_id:
            errors['grade_category'] = 'This Quiz category does not belong to the selected class subject.'
        if schedule and not (
            activity.module.subject_id == schedule.subject_id
            or activity.module.subjects.filter(pk=schedule.subject_id).exists()
        ):
            errors['schedule'] = 'This class subject is not associated with the Main Activity module.'

        linked_items = []
        if schedule:
            linked_items = list(
                GradeItem.objects.select_for_update(of=('self',)).filter(
                    schedule=schedule,
                    module_activity=activity,
                )
            )
            if len(linked_items) > 1:
                errors['schedule'] = 'This class has duplicate links that must be resolved first.'
        if errors:
            row_errors[index] = errors
        else:
            validated.append((schedule, category, linked_items[0] if linked_items else None))

    if row_errors:
        raise serializers.ValidationError({'assignments': row_errors})
    return validated


def active_score_roster(item):
    if not item.schedule_id:
        return []
    return list(
        ScheduleStudent.objects.select_for_update(of=('self',))
        .select_related('student', 'student__student_profile')
        .filter(schedule=item.schedule, is_active=True)
        .order_by('student__last_name', 'student__first_name', 'student_id')
    )


def validate_score_sheet_records(item, records, enrollments):
    if not isinstance(records, list):
        raise serializers.ValidationError({'records': 'Provide the complete active class roster.'})

    active_ids = {enrollment.student_id for enrollment in enrollments}
    submitted_ids = []
    validated = []
    score_field = serializers.DecimalField(
        max_digits=7,
        decimal_places=2,
        min_value=Decimal('0'),
        max_value=item.points_possible,
    )
    row_errors = {}
    for index, record in enumerate(records):
        if not isinstance(record, dict):
            row_errors[index] = {'detail': 'Each roster row must be an object.'}
            continue
        try:
            student_id = int(record.get('student'))
        except (TypeError, ValueError):
            row_errors[index] = {'student': 'A valid student is required.'}
            continue
        submitted_ids.append(student_id)
        row_status = str(record.get('status') or 'GRADED').upper()
        remarks = str(record.get('remarks') or '').strip()
        if row_status not in {'GRADED', 'EXCUSED'}:
            row_errors[index] = {'status': 'Status must be graded or excused.'}
            continue
        if row_status == 'EXCUSED':
            if not remarks:
                row_errors[index] = {'remarks': 'An excuse reason is required.'}
                continue
            raw_score = None
        else:
            value = record.get('raw_score')
            try:
                raw_score = score_field.run_validation('0' if value in (None, '') else value)
            except serializers.ValidationError as error:
                row_errors[index] = {'raw_score': error.detail}
                continue
        validated.append({
            'student_id': student_id,
            'raw_score': raw_score,
            'status': row_status,
            'remarks': remarks,
        })

    if len(submitted_ids) != len(set(submitted_ids)):
        raise serializers.ValidationError({'records': 'Each student can appear only once.'})
    if set(submitted_ids) != active_ids:
        raise serializers.ValidationError({
            'records': 'The active class roster changed. Reload the score sheet and try again.',
        })
    if row_errors:
        raise serializers.ValidationError({'records': row_errors})
    return validated


def save_score_sheet_roster(item, records):
    enrollments = active_score_roster(item)
    if not enrollments:
        raise serializers.ValidationError({'records': 'Add at least one active student before recording scores.'})
    validated = validate_score_sheet_records(item, records, enrollments)
    for record in validated:
        StudentGradeItemScore.objects.update_or_create(
            grade_item=item,
            student_id=record['student_id'],
            defaults={
                'raw_score': record['raw_score'],
                'status': record['status'],
                'origin': StudentGradeItemScore.Origin.MANUAL,
                'override_reason': record['remarks'] if record['status'] == 'EXCUSED' else '',
                'remarks': record['remarks'],
            },
        )


def score_sheet_payload(item):
    active_enrollments = list(
        item.schedule.students.select_related('student', 'student__student_profile')
        .filter(is_active=True)
        .order_by('student__last_name', 'student__first_name', 'student_id')
    ) if item.schedule_id else []
    scores = list(
        item.student_scores.select_related('student', 'student__student_profile')
        .order_by('student__last_name', 'student__first_name', 'student_id')
    )
    scores_by_student = {score.student_id: score for score in scores}
    active_ids = {enrollment.student_id for enrollment in active_enrollments}
    rows = [score_sheet_row(enrollment.student, True, scores_by_student.get(enrollment.student_id))
            for enrollment in active_enrollments]
    rows.extend(
        score_sheet_row(score.student, False, score)
        for score in scores
        if score.student_id not in active_ids
    )
    graded = [score for score in scores if score.status == StudentGradeItemScore.Status.GRADED]
    return {
        'item': GradeItemSerializer(item).data,
        'rows': rows,
        'counts': {
            'student_count': len(rows),
            'active_count': len(active_enrollments),
            'graded_count': len(graded),
            'zero_count': sum(score.raw_score == 0 for score in graded),
            'excused_count': sum(
                score.status == StudentGradeItemScore.Status.EXCUSED for score in scores
            ),
        },
    }


def score_sheet_row(student, is_active, score):
    profile = getattr(student, 'student_profile', None)
    return {
        'student': student.id,
        'student_name': student.get_full_name() or student.username,
        'student_number': profile.student_number if profile else '',
        'is_active': is_active,
        'score_id': score.id if score else None,
        'raw_score': format(score.raw_score, 'f') if score and score.raw_score is not None else None,
        'status': score.status if score else 'GRADED',
        'remarks': score.remarks if score else '',
    }


class StudentGradeItemScoreViewSet(viewsets.ModelViewSet):
    serializer_class = StudentGradeItemScoreSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = StudentGradeItemScore.objects.select_related(
            'grade_item',
            'grade_item__grade_category',
            'grade_item__grade_category__subject',
            'grade_item__schedule',
            'student',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user).filter(
            Q(grade_item__schedule__isnull=True)
            | Q(
                grade_item__schedule__students__student=self.request.user,
                grade_item__schedule__students__is_active=True,
                grade_item__schedule__is_active=True,
            ),
        ).distinct()

    @action(detail=False, methods=['post'])
    def excuse(self, request):
        item = get_object_or_404(GradeItem, pk=request.data.get('grade_item'))
        student_id = request.data.get('student')
        reason = str(request.data.get('reason', '')).strip()
        if not reason:
            return Response({'reason': ['An excuse reason is required.']}, status=400)
        from accounts.models import User

        student = get_object_or_404(User, pk=student_id)
        from .serializers import validate_schedule_student

        validate_schedule_student(item.schedule, student)
        score, _ = StudentGradeItemScore.objects.update_or_create(
            grade_item=item,
            student=student,
            defaults={
                'raw_score': None,
                'status': StudentGradeItemScore.Status.EXCUSED,
                'origin': StudentGradeItemScore.Origin.OVERRIDE,
                'override_reason': reason,
                'remarks': reason,
            },
        )
        return Response(self.get_serializer(score).data)

    @action(detail=True, methods=['post'])
    def override(self, request, pk=None):
        score = self.get_object()
        reason = str(request.data.get('reason', '')).strip()
        raw_score = request.data.get('raw_score')
        if not reason:
            return Response({'reason': ['An override reason is required.']}, status=400)
        serializer = self.get_serializer(
            score,
            data={'raw_score': raw_score, 'status': 'GRADED'},
            partial=True,
        )
        # Override is an explicit privileged transition, so bypass the ordinary automatic-score guard.
        if score.origin == StudentGradeItemScore.Origin.AUTOMATIC:
            score.origin = StudentGradeItemScore.Origin.MANUAL
        serializer.is_valid(raise_exception=True)
        score.origin = StudentGradeItemScore.Origin.OVERRIDE
        score.override_reason = reason
        score.raw_score = serializer.validated_data['raw_score']
        score.status = StudentGradeItemScore.Status.GRADED
        score.save()
        return Response(self.get_serializer(score).data)

    @action(detail=True, methods=['post'], url_path='clear-override')
    def clear_override(self, request, pk=None):
        score = self.get_object()
        if score.origin != StudentGradeItemScore.Origin.OVERRIDE:
            return Response({'detail': 'This score is not overridden.'}, status=400)
        item = score.grade_item
        student = score.student
        score.delete()
        from .source_sync import sync_grade_item

        sync_grade_item(item)
        refreshed = StudentGradeItemScore.objects.filter(grade_item=item, student=student).first()
        return Response(self.get_serializer(refreshed).data if refreshed else {'detail': 'Score is pending.'})


class PeriodGradeViewSet(viewsets.ModelViewSet):
    serializer_class = PeriodGradeSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = PeriodGrade.objects.select_related('schedule', 'subject', 'student')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user).filter(
            Q(schedule__isnull=True)
            | Q(
                schedule__students__student=self.request.user,
                schedule__students__is_active=True,
                schedule__is_active=True,
            ),
        ).distinct()


class FinalGradeViewSet(viewsets.ModelViewSet):
    serializer_class = FinalGradeSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = FinalGrade.objects.select_related('schedule', 'subject', 'student')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user).filter(
            Q(schedule__isnull=True)
            | Q(
                schedule__students__student=self.request.user,
                schedule__students__is_active=True,
                schedule__is_active=True,
            ),
        ).distinct()
