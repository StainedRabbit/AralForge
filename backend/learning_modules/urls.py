from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ModuleAccessViewSet,
    ModuleActivitySubmissionViewSet,
    ModuleActivityViewSet,
    ModuleProgressViewSet,
    ModuleViewSet,
)

app_name = 'learning_modules'

router = DefaultRouter()
router.register('modules', ModuleViewSet, basename='module')
router.register('access', ModuleAccessViewSet, basename='module-access')
router.register('activities', ModuleActivityViewSet, basename='module-activity')
router.register('submissions', ModuleActivitySubmissionViewSet, basename='module-activity-submission')
router.register('progress', ModuleProgressViewSet, basename='module-progress')

urlpatterns = [
    path('', include(router.urls)),
]
