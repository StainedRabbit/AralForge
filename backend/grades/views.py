from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsAdminTeacherOrReadOnly
from subjects.models import Subject, active_subject_access_filter

from .models import (
    FinalGrade,
    GradeCategory,
    GradeItem,
    GradingTemplate,
    GradingTemplateItem,
    PeriodGrade,
    StudentCategoryGrade,
    StudentGradeItemScore,
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
)


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
        queryset = StudentCategoryGrade.objects.select_related('subject', 'student', 'grade_category')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)


class GradeItemViewSet(viewsets.ModelViewSet):
    serializer_class = GradeItemSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = GradeItem.objects.select_related(
            'grade_category',
            'grade_category__subject',
            'assessment',
            'module_activity',
            'attendance_session',
            'coding_problem',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(
            active_subject_access_filter(
                self.request.user,
                subject_prefix='grade_category__subject__',
            )
        ).distinct()


class StudentGradeItemScoreViewSet(viewsets.ModelViewSet):
    serializer_class = StudentGradeItemScoreSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = StudentGradeItemScore.objects.select_related(
            'grade_item',
            'grade_item__grade_category',
            'grade_item__grade_category__subject',
            'student',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)


class PeriodGradeViewSet(viewsets.ModelViewSet):
    serializer_class = PeriodGradeSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = PeriodGrade.objects.select_related('subject', 'student')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)


class FinalGradeViewSet(viewsets.ModelViewSet):
    serializer_class = FinalGradeSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = FinalGrade.objects.select_related('subject', 'student')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)
