import re
from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer
from rest_framework_simplejwt.tokens import RefreshToken, Token
from rest_framework_simplejwt.views import TokenObtainPairView

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

    def post(self, request):
        serializer = CompletePasswordSetupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = serializer.validated_data['user']
        user.set_password(serializer.validated_data['new_password'])
        user.must_change_password = False
        user.save(update_fields=('password', 'must_change_password'))
        refresh = RefreshToken.for_user(user)
        return Response({'refresh': str(refresh), 'access': str(refresh.access_token)})
