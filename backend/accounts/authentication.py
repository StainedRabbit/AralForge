from django.conf import settings
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication


PRIVACY_OFFICER_ALLOWED_PREFIXES = (
    '/api/privacy/',
    '/api/accounts/users/me/',
    '/api/accounts/users/change-password/',
)


class AralForgeJWTAuthentication(JWTAuthentication):
    """Keep the privacy role out of academic APIs by default."""

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None

        user, token = result
        if (
            settings.ADVANCED_PRIVACY_FEATURES
            and user.is_privacy_officer
            and not request.path.startswith(PRIVACY_OFFICER_ALLOWED_PREFIXES)
        ):
            raise PermissionDenied('Privacy officers cannot access academic records through this endpoint.')
        if settings.ADVANCED_PRIVACY_FEATURES and settings.REAL_STUDENT_PRIVACY_ENFORCEMENT and not request.path.startswith(PRIVACY_OFFICER_ALLOWED_PREFIXES):
            from privacy.models import LegalAcknowledgment
            from privacy.serializers import LEGAL_DOCUMENTS

            accepted = set(LegalAcknowledgment.objects.filter(
                user=user,
            ).values_list('document', 'version', 'action'))
            required = {
                (document, metadata['version'], metadata['action'])
                for document, metadata in LEGAL_DOCUMENTS.items()
            }
            if not required.issubset(accepted):
                raise PermissionDenied('Current Privacy Notice and Terms/AUP acknowledgment is required.')
        return user, token
