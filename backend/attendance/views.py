from rest_framework import viewsets

from accounts.permissions import IsAdminTeacherOrReadOnly

from .models import AttendanceRecord, AttendanceSession
from .serializers import AttendanceRecordSerializer, AttendanceSessionSerializer


class AttendanceSessionViewSet(viewsets.ModelViewSet):
    queryset = AttendanceSession.objects.select_related('subject')
    serializer_class = AttendanceSessionSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]


class AttendanceRecordViewSet(viewsets.ModelViewSet):
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = AttendanceRecord.objects.select_related('session', 'session__subject', 'student')

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user)
