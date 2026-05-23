from rest_framework import viewsets

from accounts.permissions import IsAdminTeacherOrReadOnly

from .models import Badge, LevelRule, PointLedger, StudentBadge
from .serializers import BadgeSerializer, LevelRuleSerializer, PointLedgerSerializer, StudentBadgeSerializer


class PointLedgerViewSet(viewsets.ModelViewSet):
    serializer_class = PointLedgerSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = PointLedger.objects.select_related('student')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)


class BadgeViewSet(viewsets.ModelViewSet):
    serializer_class = BadgeSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = Badge.objects.all()

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(is_active=True)


class StudentBadgeViewSet(viewsets.ModelViewSet):
    serializer_class = StudentBadgeSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = StudentBadge.objects.select_related('student', 'badge')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)


class LevelRuleViewSet(viewsets.ModelViewSet):
    queryset = LevelRule.objects.all()
    serializer_class = LevelRuleSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]
