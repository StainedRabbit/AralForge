from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ScheduleStudentViewSet,
    SchoolYearSemesterViewSet,
    SchoolYearViewSet,
    SubjectScheduleViewSet,
    SubjectViewSet,
)

app_name = 'subjects'

router = DefaultRouter()
router.register('subjects', SubjectViewSet, basename='subject')
router.register('school-years', SchoolYearViewSet, basename='school-year')
router.register('school-year-semesters', SchoolYearSemesterViewSet, basename='school-year-semester')
router.register('subject-schedules', SubjectScheduleViewSet, basename='subject-schedule')
router.register('schedule-students', ScheduleStudentViewSet, basename='schedule-student')

urlpatterns = [
    path('', include(router.urls)),
]
