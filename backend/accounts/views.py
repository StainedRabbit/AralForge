from rest_framework import viewsets

from .models import StudentProfile, User
from .permissions import IsAdminTeacher, IsAdminTeacherOrReadOnly
from .serializers import StudentProfileSerializer, UserSerializer


class UserViewSet(viewsets.ModelViewSet):
    serializer_class = UserSerializer

    def get_queryset(self):
        if self.request.user.is_admin_teacher:
            return User.objects.all()

        return User.objects.filter(id=self.request.user.id)

    def get_permissions(self):
        if self.action in ('create', 'destroy'):
            return [IsAdminTeacher()]

        return [IsAdminTeacherOrReadOnly()]


class StudentProfileViewSet(viewsets.ModelViewSet):
    serializer_class = StudentProfileSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        if self.request.user.is_admin_teacher:
            return StudentProfile.objects.select_related('user')

        return StudentProfile.objects.select_related('user').filter(user=self.request.user)
