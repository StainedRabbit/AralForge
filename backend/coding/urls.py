from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CodeBlankAnswerViewSet,
    CodeBlankViewSet,
    CodeSubmissionViewSet,
    ProgrammingProblemViewSet,
    TestCaseViewSet,
)

app_name = 'coding'

router = DefaultRouter()
router.register('problems', ProgrammingProblemViewSet, basename='programming-problem')
router.register('test-cases', TestCaseViewSet, basename='test-case')
router.register('blanks', CodeBlankViewSet, basename='code-blank')
router.register('submissions', CodeSubmissionViewSet, basename='code-submission')
router.register('blank-answers', CodeBlankAnswerViewSet, basename='code-blank-answer')

urlpatterns = [
    path('', include(router.urls)),
]
