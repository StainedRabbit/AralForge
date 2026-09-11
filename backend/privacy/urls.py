from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    LegalAcknowledgmentView,
    LegalHoldViewSet,
    LegalStatusView,
    PrivacyRequestViewSet,
    RetentionPolicyViewSet,
    TermClosureViewSet,
)


router = DefaultRouter()
router.register('requests', PrivacyRequestViewSet, basename='privacy-request')
router.register('retention-policies', RetentionPolicyViewSet, basename='retention-policy')
router.register('term-closures', TermClosureViewSet, basename='term-closure')
router.register('legal-holds', LegalHoldViewSet, basename='legal-hold')

urlpatterns = [
    path('legal-status/', LegalStatusView.as_view(), name='legal-status'),
    path('acknowledgments/', LegalAcknowledgmentView.as_view(), name='legal-acknowledgment'),
    path('', include(router.urls)),
]
