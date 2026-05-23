from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import BadgeViewSet, LevelRuleViewSet, PointLedgerViewSet, StudentBadgeViewSet

app_name = 'gamification'

router = DefaultRouter()
router.register('points', PointLedgerViewSet, basename='point-ledger')
router.register('badges', BadgeViewSet, basename='badge')
router.register('student-badges', StudentBadgeViewSet, basename='student-badge')
router.register('levels', LevelRuleViewSet, basename='level-rule')

urlpatterns = [
    path('', include(router.urls)),
]
