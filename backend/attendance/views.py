from django.db import IntegrityError, transaction
from django.db.models import Exists, OuterRef, Q
from django.shortcuts import get_object_or_404
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from accounts.permissions import IsAdminTeacherOrReadOnly
from subjects.models import ScheduleStudent

from .models import AttendanceRecord, AttendanceSession
from .serializers import (
    AttendanceRecordSerializer,
    AttendanceRosterRecordSerializer,
    AttendanceSessionSerializer,
    attendance_points,
    snapshot_session_roster,
)


class AttendanceSessionViewSet(viewsets.ModelViewSet):
    serializer_class = AttendanceSessionSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        queryset = AttendanceSession.objects.select_related(
            'schedule',
            'subject',
            'school_year_semester__school_year',
        ).prefetch_related('roster_students')
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

    def get_write_session(self, pk, student_id=None):
        queryset = AttendanceSession.objects.only('id', 'points_possible', 'schedule_id')
        if student_id is not None:
            snapshot = AttendanceSession.roster_students.through.objects.filter(
                attendancesession_id=OuterRef('pk'),
            )
            queryset = queryset.annotate(
                snapshot_has_student=Exists(snapshot.filter(user_id=student_id)),
                snapshot_has_students=Exists(snapshot),
            )
        session = get_object_or_404(
            queryset,
            pk=pk,
        )
        self.check_object_permissions(self.request, session)
        return session

    @action(detail=False, methods=['post'], url_path='start')
    def start_session(self, request):
        serializer = AttendanceSessionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        submitted = serializer.validated_data
        lookup = {
            'date': submitted['date'],
            'schedule': submitted['schedule'],
            'title': submitted.get('title', ''),
        }
        defaults = {
            'notes': submitted.get('notes', ''),
            'points_possible': submitted.get('points_possible', 1),
            'school_year_semester': submitted['school_year_semester'],
            'subject': submitted['subject'],
        }

        try:
            with transaction.atomic():
                session, created = AttendanceSession.objects.get_or_create(
                    **lookup,
                    defaults=defaults,
                )
        except IntegrityError:
            session = AttendanceSession.objects.get(**lookup)
            created = False

        snapshot_session_roster(session)
        records = session.records.select_related('student').all()
        return Response({
            'created': created,
            'records': AttendanceRecordSerializer(records, many=True).data,
            'session': AttendanceSessionSerializer(session).data,
        }, status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)

    @action(detail=True, methods=['put'], url_path='roster')
    def save_roster(self, request, pk=None):
        session = self.get_write_session(pk)

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

        roster_student_ids = session_student_ids(session)
        if set(submitted_ids) != roster_student_ids:
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

    @action(detail=True, methods=['put', 'delete'], url_path='mark')
    def mark_student(self, request, pk=None):
        try:
            student_id_hint = int(request.data.get('student'))
        except (TypeError, ValueError):
            student_id_hint = None
        session = self.get_write_session(pk, student_id_hint)

        if not session.schedule_id:
            return Response(
                {'detail': 'Legacy attendance sessions cannot use class roll call.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if request.method == 'DELETE':
            try:
                student_id = int(request.data.get('student'))
            except (TypeError, ValueError):
                return Response(
                    {'detail': 'Choose a student.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not session_has_student(session, student_id):
                return Response(
                    {'detail': 'The student is not part of this attendance roster.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            AttendanceRecord.objects.filter(session=session, student_id=student_id).delete()
            return Response(status=status.HTTP_204_NO_CONTENT)

        serializer = AttendanceRosterRecordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        submitted = serializer.validated_data
        if not session_has_student(session, submitted['student']):
            return Response(
                {'detail': 'The student is not part of this attendance roster.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        attendance_record, _ = AttendanceRecord.objects.update_or_create(
            session=session,
            student_id=submitted['student'],
            defaults={
                'points_earned': attendance_points(
                    submitted['status'],
                    session.points_possible,
                ),
                'remarks': submitted.get('remarks', ''),
                'status': submitted['status'],
            },
        )
        return Response(
            AttendanceRecordSerializer(attendance_record).data,
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


def session_student_ids(session):
    snapshot_ids = set(
        session_roster_memberships(session).values_list('user_id', flat=True),
    )
    if snapshot_ids:
        return snapshot_ids
    return set(
        ScheduleStudent.objects.filter(
            is_active=True,
            schedule_id=session.schedule_id,
        ).values_list('student_id', flat=True),
    )


def session_has_student(session, student_id):
    if hasattr(session, 'snapshot_has_student'):
        if session.snapshot_has_student:
            return True
        if session.snapshot_has_students:
            return False
        return ScheduleStudent.objects.filter(
            is_active=True,
            schedule_id=session.schedule_id,
            student_id=student_id,
        ).exists()

    snapshot = session_roster_memberships(session)
    if snapshot.filter(user_id=student_id).exists():
        return True
    if snapshot.exists():
        return False
    return ScheduleStudent.objects.filter(
        is_active=True,
        schedule_id=session.schedule_id,
        student_id=student_id,
    ).exists()


def session_roster_memberships(session):
    return AttendanceSession.roster_students.through.objects.filter(
        attendancesession_id=session.id,
    )
