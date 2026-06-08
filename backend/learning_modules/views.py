from rest_framework import permissions, viewsets

from accounts.permissions import IsAdminTeacherOrReadOnly

from .models import Module, ModuleActivity, ModuleActivitySubmission, ModuleProgress
from .serializers import (
    ModuleActivitySerializer,
    ModuleActivitySubmissionSerializer,
    ModuleProgressSerializer,
    ModuleSerializer,
)


class ModuleViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = Module.objects.prefetch_related('subjects')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(is_published=True)


class ModuleActivityViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleActivitySerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = ModuleActivity.objects.select_related('module', 'programming_problem')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(is_published=True, module__is_published=True)


class ModuleActivitySubmissionViewSet(viewsets.ModelViewSet):
    serializer_class = ModuleActivitySubmissionSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        queryset = ModuleActivitySubmission.objects.select_related('activity', 'student')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)

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

        return queryset.filter(student=self.request.user)

    def perform_create(self, serializer):
        student = serializer.validated_data.get('student', self.request.user)
        serializer.save(student=student)
