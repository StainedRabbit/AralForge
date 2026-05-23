from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AnswerViewSet,
    AssessmentAttemptViewSet,
    AssessmentViewSet,
    ChoiceViewSet,
    QuestionViewSet,
)

app_name = 'assessments'

router = DefaultRouter()
router.register('assessments', AssessmentViewSet, basename='assessment')
router.register('questions', QuestionViewSet, basename='question')
router.register('choices', ChoiceViewSet, basename='choice')
router.register('attempts', AssessmentAttemptViewSet, basename='assessment-attempt')
router.register('answers', AnswerViewSet, basename='answer')

urlpatterns = [
    path('', include(router.urls)),
]
