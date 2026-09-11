import re
from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.conf import settings
from django.middleware.csrf import get_token
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken, Token
from rest_framework_simplejwt.views import TokenObtainPairView
from rest_framework_simplejwt.serializers import TokenRefreshSerializer

from .models import StudentProfile


LEGACY_STUDENT_USERNAME_PATTERN = re.compile(r'^student-(\d+)$')


class PasswordSetupToken(Token):
    token_type = 'password_setup'
    lifetime = timedelta(minutes=15)


class AralForgeTokenObtainPairSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        identifier = attrs.get(self.username_field, '').strip()
        password = attrs.get('password', '')
        request = self.context.get('request')
        user = authenticate(request=request, username=identifier, password=password)

        if user is None:
            legacy_match = LEGACY_STUDENT_USERNAME_PATTERN.fullmatch(identifier)
            student_number = legacy_match.group(1) if legacy_match else identifier
            profiles = StudentProfile.objects.select_related('user').filter(
                student_number__iexact=student_number,
                is_active=True,
                user__is_active=True,
                user__role=get_user_model().Role.STUDENT,
            )
            if profiles.count() == 1:
                user = authenticate(
                    request=request,
                    username=profiles.first().user.username,
                    password=password,
                )

        if user is None:
            raise AuthenticationFailed('No active account found with the given credentials.')

        self.user = user
        if user.must_change_password:
            token = PasswordSetupToken.for_user(user)
            return {
                'must_change_password': True,
                'password_setup_token': str(token),
            }

        refresh = self.get_token(user)
        return {'refresh': str(refresh), 'access': str(refresh.access_token)}


class AralForgeTokenObtainPairView(TokenObtainPairView):
    serializer_class = AralForgeTokenObtainPairSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        refresh = response.data.pop('refresh', None)
        if refresh:
            set_refresh_cookie(response, refresh)
        return response


class CompletePasswordSetupSerializer(serializers.Serializer):
    password_setup_token = serializers.CharField()
    new_password = serializers.CharField(trim_whitespace=False)
    confirm_password = serializers.CharField(trim_whitespace=False)

    def validate(self, attrs):
        if attrs['new_password'] != attrs['confirm_password']:
            raise serializers.ValidationError({'confirm_password': 'Passwords do not match.'})
        try:
            token = PasswordSetupToken(attrs['password_setup_token'])
            user = get_user_model().objects.get(
                id=token['user_id'],
                is_active=True,
                must_change_password=True,
            )
        except (TokenError, get_user_model().DoesNotExist, KeyError) as error:
            raise serializers.ValidationError({'password_setup_token': 'This password setup link is invalid or expired.'}) from error
        validate_password(attrs['new_password'], user)
        attrs['user'] = user
        return attrs


class CompletePasswordSetupView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'password_setup'

    def post(self, request):
        serializer = CompletePasswordSetupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        user.set_password(serializer.validated_data['new_password'])
        user.must_change_password = False
        user.save(update_fields=('password', 'must_change_password'))
        refresh = RefreshToken.for_user(user)
        response = Response({'access': str(refresh.access_token)})
        set_refresh_cookie(response, str(refresh))
        return response


class CookieTokenRefreshView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'token_refresh'

    def post(self, request):
        enforce_csrf(request)
        raw_refresh = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
        if not raw_refresh:
            return Response(status=204)
        serializer = TokenRefreshSerializer(data={'refresh': raw_refresh})
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError:
            return Response(status=204)
        response = Response({'access': serializer.validated_data['access']})
        rotated = serializer.validated_data.get('refresh')
        if rotated:
            set_refresh_cookie(response, rotated)
        return response


class LogoutView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        enforce_csrf(request)
        raw_refresh = request.COOKIES.get(settings.AUTH_REFRESH_COOKIE_NAME)
        if raw_refresh:
            try:
                RefreshToken(raw_refresh).blacklist()
            except TokenError:
                pass
        response = Response(status=204)
        clear_refresh_cookie(response)
        return response


class CsrfTokenView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({'csrf_token': get_token(request)})


def set_refresh_cookie(response, value):
    response.set_cookie(
        settings.AUTH_REFRESH_COOKIE_NAME,
        value,
        max_age=int(RefreshToken.lifetime.total_seconds()),
        httponly=True,
        secure=settings.AUTH_REFRESH_COOKIE_SECURE,
        samesite=settings.AUTH_REFRESH_COOKIE_SAMESITE,
        path='/api/auth/',
    )


def clear_refresh_cookie(response):
    response.delete_cookie(
        settings.AUTH_REFRESH_COOKIE_NAME,
        path='/api/auth/',
        samesite=settings.AUTH_REFRESH_COOKIE_SAMESITE,
    )


def enforce_csrf(request):
    from rest_framework.authentication import CSRFCheck

    check = CSRFCheck(lambda inner_request: None)
    check.process_request(request._request)
    reason = check.process_view(request._request, None, (), {})
    if reason:
        raise AuthenticationFailed(f'CSRF validation failed: {reason}')
