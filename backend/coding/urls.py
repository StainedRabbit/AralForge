from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import CodeSubmissionViewSet, ProgrammingProblemViewSet, TestCaseViewSet

app_name = 'coding'

router = DefaultRouter()
router.register('problems', ProgrammingProblemViewSet, basename='programming-problem')
router.register('test-cases', TestCaseViewSet, basename='test-case')
router.register('submissions', CodeSubmissionViewSet, basename='code-submission')

urlpatterns = [
    path('', include(router.urls)),
]
