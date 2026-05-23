from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AttendanceRecordViewSet, AttendanceSessionViewSet

app_name = 'attendance'

router = DefaultRouter()
router.register('sessions', AttendanceSessionViewSet, basename='attendance-session')
router.register('records', AttendanceRecordViewSet, basename='attendance-record')

urlpatterns = [
    path('', include(router.urls)),
]
