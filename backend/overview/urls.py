from django.urls import path

from .views import DashboardView, NavigationView

app_name = 'overview'

urlpatterns = [
    path('navigation/', NavigationView.as_view(), name='navigation'),
    path('dashboard/', DashboardView.as_view(), name='dashboard'),
]
