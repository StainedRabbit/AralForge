from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import EnrollmentViewSet, SubjectViewSet

app_name = 'subjects'

router = DefaultRouter()
router.register('subjects', SubjectViewSet, basename='subject')
router.register('enrollments', EnrollmentViewSet, basename='enrollment')

urlpatterns = [
    path('', include(router.urls)),
]
