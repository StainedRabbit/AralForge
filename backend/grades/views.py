from decimal import Decimal

from django.db import transaction
from django.db.models import Max, Q
from django.shortcuts import get_object_or_404
from rest_framework import permissions, serializers, status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminTeacher, IsAdminTeacherOrReadOnly
from gamification.models import LevelRule, PointLedger
from gamification.serializers import LevelRuleSerializer, PointLedgerSerializer
from learning_modules.models import ModuleActivity
from subjects.models import ScheduleStudent, Subject, SubjectSchedule
from subjects.serializers import ScheduleStudentSerializer, SubjectScheduleSerializer

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


class TeacherGradebookView(APIView):
    permission_classes = [IsAdminTeacher]

    def get(self, request):
        schedule_id = request.query_params.get('schedule')
        if not schedule_id or not schedule_id.isdigit():
            return Response({'detail': 'A valid schedule is required.'}, status=400)
        schedule = get_object_or_404(SubjectSchedule.objects.select_related('subject'), pk=schedule_id)
        period = request.query_params.get('period', '').strip()
        categories = GradeCategory.objects.filter(subject=schedule.subject)
        if period:
            categories = categories.filter(grading_period=period)
        items = GradeItem.objects.filter(schedule=schedule, grade_category__in=categories).select_related('grade_category')
        scores = StudentGradeItemScore.objects.filter(grade_item__in=items).select_related('grade_item', 'student')
        enrollments = ScheduleStudent.objects.filter(schedule=schedule, is_active=True).select_related('student__student_profile')
        context = {'request': request}
        return Response({
            'schedule': SubjectScheduleSerializer(schedule, context=context).data,
            'enrollments': ScheduleStudentSerializer(enrollments, many=True, context=context).data,
            'categories': GradeCategorySerializer(categories, many=True, context=context).data,
            'items': GradeItemSerializer(items, many=True, context=context).data,
            'scores': StudentGradeItemScoreSerializer(scores, many=True, context=context).data,
        })


class SubjectGradingPolicyViewSet(viewsets.ModelViewSet):
    queryset = SubjectGradingPolicy.objects.select_related('subject', 'source_template')
    serializer_class = SubjectGradingPolicySerializer
    permission_classes = [IsAdminTeacherOrReadOnly]


class GradingTemplateViewSet(viewsets.ModelViewSet):
    queryset = GradingTemplate.objects.prefetch_related('items')
    serializer_class = GradingTemplateSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

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


class GradeCategoryViewSet(viewsets.ModelViewSet):
    queryset = GradeCategory.objects.select_related('subject', 'template_item')
    serializer_class = GradeCategorySerializer
    permission_classes = [IsAdminTeacherOrReadOnly]


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
            'assessment',
            'module_activity',
            'attendance_session',
            'coding_problem',
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
