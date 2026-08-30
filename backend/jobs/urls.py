from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import BackgroundJobViewSet


router = DefaultRouter()
router.register('', BackgroundJobViewSet, basename='background-job')

urlpatterns = [path('', include(router.urls))]
