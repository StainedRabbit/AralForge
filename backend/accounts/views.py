from django.db.models import BooleanField, Exists, OuterRef, Q, Value
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from subjects.models import ScheduleStudent

from .models import StudentProfile, User
from .permissions import IsAdminTeacher, IsAdminTeacherOrReadOnly
from .serializers import (
    AvailableStudentSerializer,
    ChangePasswordSerializer,
    StudentProfileSerializer,
    UserSerializer,
)


class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer
    search_fields = ('username', 'first_name', 'middle_name', 'last_name', 'email', 'student_profile__student_number')
    cursor_ordering = ('last_name', 'first_name', 'id')

    def get_queryset(self):
        if self.request.user.is_admin_teacher:
            return User.objects.all()

        return User.objects.filter(id=self.request.user.id)

    def get_permissions(self):
        if self.action == 'change_password':
            return [IsAuthenticated()]

        if self.action in ('create', 'destroy'):
            return [IsAdminTeacher()]

        return [IsAdminTeacherOrReadOnly()]

    @action(detail=False, methods=['get'])
    def me(self, request):
        profile = StudentProfile.objects.select_related('user').filter(user=request.user).first()
        return Response({
            'user': UserSerializer(request.user, context={'request': request}).data,
            'student_profile': (
                StudentProfileSerializer(profile, context={'request': request}).data
                if profile else None
            ),
        })

    @action(detail=False, methods=['post'], url_path='change-password')
    def change_password(self, request):
        serializer = ChangePasswordSerializer(
            data=request.data,
            context={'request': request},
        )
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data['new_password'])
        request.user.must_change_password = False
        request.user.save(update_fields=('password', 'must_change_password'))
        return Response({'detail': 'Password changed successfully.'})

    @action(detail=False, methods=['get'], permission_classes=[IsAdminTeacher])
    def available_students(self, request):
        queryset = User.objects.filter(
            is_active=True,
            role=User.Role.STUDENT,
        ).select_related('student_profile')
        schedule_id = bounded_int(request.query_params.get('schedule'), default=0)
        search = request.query_params.get('search', '').strip()

        if schedule_id:
            enrolled_ids = ScheduleStudent.objects.filter(
                is_active=True,
                schedule_id=schedule_id,
            ).values('student_id')
            queryset = queryset.exclude(id__in=enrolled_ids)
            queryset = queryset.annotate(
                has_inactive_enrollment=Exists(
                    ScheduleStudent.objects.filter(
                        is_active=False,
                        schedule_id=schedule_id,
                        student_id=OuterRef('pk'),
                    ),
                ),
            )
        else:
            queryset = queryset.annotate(
                has_inactive_enrollment=Value(False, output_field=BooleanField()),
            )

        if search:
            queryset = queryset.filter(
                Q(first_name__icontains=search) | Q(middle_name__icontains=search)
                | Q(last_name__icontains=search)
                | Q(username__icontains=search)
                | Q(email__icontains=search)
                | Q(student_profile__student_number__icontains=search),
            )

        queryset = queryset.order_by('last_name', 'first_name', 'id')
        count = queryset.count()
        limit = bounded_int(request.query_params.get('limit'), default=50, maximum=100)
        offset = bounded_int(request.query_params.get('offset'), default=0)
        results = queryset[offset:offset + limit]

        return Response({
            'count': count,
            'next': offset + limit if offset + limit < count else None,
            'previous': max(offset - limit, 0) if offset > 0 else None,
            'results': AvailableStudentSerializer(results, many=True).data,
        })


class StudentProfileViewSet(viewsets.ModelViewSet):
    serializer_class = StudentProfileSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]
    search_fields = ('student_number', 'user__username', 'user__first_name', 'user__middle_name', 'user__last_name')
    cursor_ordering = ('student_number', 'id')

    def get_queryset(self):
        if self.request.user.is_admin_teacher:
            return StudentProfile.objects.select_related('user')

        return StudentProfile.objects.select_related('user').filter(user=self.request.user)


def bounded_int(value, default=0, maximum=None):
    try:
        number = int(value)
    except (TypeError, ValueError):
        number = default

    number = max(number, 0)

    if maximum is not None:
        return min(number, maximum)

    return number
