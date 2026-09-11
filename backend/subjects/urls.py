from django.urls import include, path
from django.conf import settings
from rest_framework.routers import DefaultRouter

from .views import (
    ScheduleStudentViewSet,
    SchoolYearSemesterViewSet,
    SchoolYearViewSet,
    SubjectScheduleViewSet,
    SubjectViewSet,
    ScheduleInstructorViewSet,
)

app_name = 'subjects'

router = DefaultRouter()
router.register('subjects', SubjectViewSet, basename='subject')
router.register('school-years', SchoolYearViewSet, basename='school-year')
router.register('school-year-semesters', SchoolYearSemesterViewSet, basename='school-year-semester')
router.register('subject-schedules', SubjectScheduleViewSet, basename='subject-schedule')
router.register('schedule-students', ScheduleStudentViewSet, basename='schedule-student')
if settings.ADVANCED_PRIVACY_FEATURES:
    router.register('schedule-instructors', ScheduleInstructorViewSet, basename='schedule-instructor')

urlpatterns = [
    path('', include(router.urls)),
]
