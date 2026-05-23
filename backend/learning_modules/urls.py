from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import ModuleActivitySubmissionViewSet, ModuleActivityViewSet, ModuleViewSet

app_name = 'learning_modules'

router = DefaultRouter()
router.register('modules', ModuleViewSet, basename='module')
router.register('activities', ModuleActivityViewSet, basename='module-activity')
router.register('submissions', ModuleActivitySubmissionViewSet, basename='module-activity-submission')

urlpatterns = [
    path('', include(router.urls)),
]
