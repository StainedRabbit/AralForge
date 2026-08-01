from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsAdminTeacherOrReadOnly
from subjects.models import Subject

from .models import (
    FinalGrade,
    GradeCategory,
    GradeItem,
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

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            schedule__students__student=self.request.user,
            schedule__students__is_active=True,
            schedule__is_active=True,
        ).distinct()

    @action(detail=True, methods=['post'])
    def resync(self, request, pk=None):
        from .source_sync import sync_grade_item

        item = self.get_object()
        return Response({'synchronized_scores': sync_grade_item(item)})


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
