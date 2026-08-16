from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    FinalGradeViewSet,
    GradeCategoryViewSet,
    GradeItemViewSet,
    GradingTemplateItemViewSet,
    GradingTemplateViewSet,
    PeriodGradeViewSet,
    StudentCategoryGradeViewSet,
    StudentGradeItemScoreViewSet,
    SubjectGradingPolicyViewSet,
    StudentGradeOverviewView,
    TeacherGradebookView,
)

app_name = 'grades'

router = DefaultRouter()
router.register('templates', GradingTemplateViewSet, basename='grading-template')
router.register('template-items', GradingTemplateItemViewSet, basename='grading-template-item')
router.register('subject-policies', SubjectGradingPolicyViewSet, basename='subject-grading-policy')
router.register('categories', GradeCategoryViewSet, basename='grade-category')
router.register('items', GradeItemViewSet, basename='grade-item')
router.register('item-scores', StudentGradeItemScoreViewSet, basename='student-grade-item-score')
router.register('student-categories', StudentCategoryGradeViewSet, basename='student-category-grade')
router.register('periods', PeriodGradeViewSet, basename='period-grade')
router.register('finals', FinalGradeViewSet, basename='final-grade')

urlpatterns = [
    path('overview/', StudentGradeOverviewView.as_view(), name='student-grade-overview'),
    path('gradebook/', TeacherGradebookView.as_view(), name='teacher-gradebook'),
    path('', include(router.urls)),
]
