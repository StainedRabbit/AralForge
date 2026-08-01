from decimal import Decimal

from django.db import transaction
from django.db.models import Q
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsAdminTeacherOrReadOnly

from .models import AttendanceRecord, AttendanceSession
from .serializers import (
    AttendanceRecordSerializer,
    AttendanceRosterRecordSerializer,
    AttendanceSessionSerializer,
)


class AttendanceSessionViewSet(viewsets.ModelViewSet):
    serializer_class = AttendanceSessionSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = AttendanceSession.objects.select_related(
            'schedule',
            'subject',
            'school_year_semester__school_year',
        )
        if self.request.user.is_admin_teacher:
            return queryset
        return queryset.filter(
            Q(
                schedule__students__student=self.request.user,
                schedule__students__is_active=True,
                schedule__is_active=True,
            )
            | Q(
                schedule__isnull=True,
                subject__schedules__students__student=self.request.user,
                subject__schedules__students__is_active=True,
                subject__schedules__is_active=True,
            ),
        ).distinct()

    @action(detail=True, methods=['put'], url_path='roster')
    def save_roster(self, request, pk=None):
        session = self.get_object()

        if not session.schedule_id:
            return Response(
                {'detail': 'Legacy attendance sessions cannot use class roster saving.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        records = request.data.get('records')
        if not isinstance(records, list):
            return Response(
                {'detail': 'Records must be provided as a list.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = AttendanceRosterRecordSerializer(data=records, many=True)
        serializer.is_valid(raise_exception=True)
        submitted = serializer.validated_data
        submitted_ids = [record['student'] for record in submitted]

        if len(submitted_ids) != len(set(submitted_ids)):
            return Response(
                {'detail': 'Each student can appear only once.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        active_student_ids = set(
            session.schedule.students.filter(is_active=True).values_list('student_id', flat=True),
        )
        if set(submitted_ids) != active_student_ids:
            return Response(
                {'detail': 'The attendance roster changed. Reload the class and try again.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            saved_records = []
            for record in submitted:
                attendance_record, _ = AttendanceRecord.objects.update_or_create(
                    session=session,
                    student_id=record['student'],
                    defaults={
                        'points_earned': attendance_points(
                            record['status'],
                            session.points_possible,
                        ),
                        'remarks': record.get('remarks', ''),
                        'status': record['status'],
                    },
                )
                saved_records.append(attendance_record)

        return Response(
            AttendanceRecordSerializer(saved_records, many=True).data,
            status=status.HTTP_200_OK,
        )


class AttendanceRecordViewSet(viewsets.ModelViewSet):
    serializer_class = AttendanceRecordSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = AttendanceRecord.objects.select_related(
            'session',
            'session__subject',
            'session__school_year_semester__school_year',
            'student',
        )

        if self.request.user.is_admin_teacher:
            return queryset

        return queryset.filter(student=self.request.user).filter(
            Q(
                session__schedule__students__student=self.request.user,
                session__schedule__students__is_active=True,
                session__schedule__is_active=True,
            )
            | Q(
                session__schedule__isnull=True,
                session__subject__schedules__students__student=self.request.user,
                session__subject__schedules__students__is_active=True,
                session__subject__schedules__is_active=True,
            ),
        ).distinct()


def attendance_points(record_status, points_possible):
    if record_status in {'PRESENT', 'EXCUSED'}:
        return points_possible
    if record_status == 'LATE':
        return points_possible / Decimal('2')
    return Decimal('0')
