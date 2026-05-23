from rest_framework import viewsets

from accounts.permissions import IsAdminTeacherOrReadOnly

from .models import Enrollment, Subject
from .serializers import EnrollmentSerializer, SubjectSerializer


class SubjectViewSet(viewsets.ModelViewSet):
    queryset = Subject.objects.all()
    serializer_class = SubjectSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]


class EnrollmentViewSet(viewsets.ModelViewSet):
    serializer_class = EnrollmentSerializer
    permission_classes = [IsAdminTeacherOrReadOnly]

    def get_queryset(self):
        if self.request.user.is_admin_teacher:
            return Enrollment.objects.select_related('subject', 'student')

        return Enrollment.objects.select_related('subject', 'student').filter(student=self.request.user)
