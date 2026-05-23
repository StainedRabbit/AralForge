from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import StudentProfileViewSet, UserViewSet

app_name = 'accounts'

router = DefaultRouter()
router.register('users', UserViewSet, basename='user')
router.register('students', StudentProfileViewSet, basename='student')

urlpatterns = [
    path('', include(router.urls)),
]
