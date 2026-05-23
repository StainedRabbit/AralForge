from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    FinalGradeViewSet,
    GradeCategoryViewSet,
    GradingTemplateItemViewSet,
    GradingTemplateViewSet,
    PeriodGradeViewSet,
    StudentCategoryGradeViewSet,
)

app_name = 'grades'

router = DefaultRouter()
router.register('templates', GradingTemplateViewSet, basename='grading-template')
router.register('template-items', GradingTemplateItemViewSet, basename='grading-template-item')
router.register('categories', GradeCategoryViewSet, basename='grade-category')
router.register('student-categories', StudentCategoryGradeViewSet, basename='student-category-grade')
router.register('periods', PeriodGradeViewSet, basename='period-grade')
router.register('finals', FinalGradeViewSet, basename='final-grade')

urlpatterns = [
    path('', include(router.urls)),
]
