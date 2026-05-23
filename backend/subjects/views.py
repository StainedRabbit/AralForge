from rest_framework import viewsets

from accounts.permissions import IsAdminTeacherOrReadOnly

from .models import ScheduleStudent, SchoolYear, SchoolYearSemester, Subject, SubjectSchedule
from .serializers import (
    ScheduleStudentSerializer,
    SchoolYearSemesterSerializer,
    SchoolYearSerializer,
    SubjectScheduleSerializer,
    SubjectSerializer,
)


class SubjectViewSet(viewsets.ModelViewSet):
    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]


class SchoolYearViewSet(viewsets.ModelViewSet):
    queryset = SchoolYear.objects.all()
    serializer_class = SchoolYearSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]


class SchoolYearSemesterViewSet(viewsets.ModelViewSet):
    queryset = SchoolYearSemester.objects.select_related('school_year')
    serializer_class = SchoolYearSemesterSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]


class SubjectScheduleViewSet(viewsets.ModelViewSet):
    queryset = SubjectSchedule.objects.select_related('subject', 'school_year_semester__school_year')
    serializer_class = SubjectScheduleSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]


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
