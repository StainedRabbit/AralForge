from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ModuleAccessViewSet,
    ModuleActivityAnswerViewSet,
    ModuleActivityAttemptViewSet,
    ModuleActivityMatchingPairViewSet,
    ModuleActivityQuestionChoiceViewSet,
    ModuleActivityQuestionViewSet,
    ModuleActivitySubmissionViewSet,
    ModuleActivityViewSet,
    ModuleLessonAssetViewSet,
    ModuleLessonViewSet,
    ModuleLessonExampleViewSet,
    ModuleLessonProgressViewSet,
    ModuleProgressViewSet,
    ModuleTopicProgressViewSet,
    ModuleTopicViewSet,
    ModuleViewSet,
)

app_name = 'learning_modules'

router = DefaultRouter()
router.register('modules', ModuleViewSet, basename='module')
router.register('topics', ModuleTopicViewSet, basename='module-topic')
router.register('lessons', ModuleLessonViewSet, basename='module-lesson')
router.register('lesson-assets', ModuleLessonAssetViewSet, basename='module-lesson-asset')
router.register('lesson-examples', ModuleLessonExampleViewSet, basename='module-lesson-example')
router.register('access', ModuleAccessViewSet, basename='module-access')
router.register('activities', ModuleActivityViewSet, basename='module-activity')
router.register('activity-questions', ModuleActivityQuestionViewSet, basename='module-activity-question')
router.register('activity-choices', ModuleActivityQuestionChoiceViewSet, basename='module-activity-choice')
router.register('activity-matching-pairs', ModuleActivityMatchingPairViewSet, basename='module-activity-matching-pair')
router.register('activity-attempts', ModuleActivityAttemptViewSet, basename='module-activity-attempt')
router.register('activity-answers', ModuleActivityAnswerViewSet, basename='module-activity-answer')
router.register('submissions', ModuleActivitySubmissionViewSet, basename='module-activity-submission')
router.register('progress', ModuleProgressViewSet, basename='module-progress')
router.register('topic-progress', ModuleTopicProgressViewSet, basename='module-topic-progress')
router.register('lesson-progress', ModuleLessonProgressViewSet, basename='module-lesson-progress')

urlpatterns = [
    path('', include(router.urls)),
]
