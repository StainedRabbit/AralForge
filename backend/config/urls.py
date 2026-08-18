"""
URL configuration for config project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path
from rest_framework_simplejwt.views import TokenRefreshView

from accounts.auth import CompletePasswordSetupView, EzoryxTokenObtainPairView
from config.health import health_check

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/health/', health_check, name='health-check'),
    path('api/auth/token/', EzoryxTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/complete-password-setup/', CompletePasswordSetupView.as_view(), name='complete_password_setup'),
    path('api/accounts/', include('accounts.urls')),
    path('api/subjects/', include('subjects.urls')),
    path('api/modules/', include('learning_modules.urls')),
    path('api/assessments/', include('assessments.urls')),
    path('api/attendance/', include('attendance.urls')),
    path('api/grades/', include('grades.urls')),
    path('api/coding/', include('coding.urls')),
    path('api/gamification/', include('gamification.urls')),
    path('api/overview/', include('overview.urls')),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
