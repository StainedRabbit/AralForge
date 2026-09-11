from rest_framework import serializers

from .models import (
    LegalAcknowledgment,
    LegalHold,
    PrivacyRequest,
    PrivacyRequestEvent,
    PurgeRun,
    RetentionPolicy,
    TermClosure,
)


LEGAL_DOCUMENTS = {
    LegalAcknowledgment.Document.PRIVACY: {
        'version': '2026-09-10',
        'effective_date': '2026-09-10',
        'action': LegalAcknowledgment.Action.ACKNOWLEDGED,
        'path': '/legal/privacy',
    },
    LegalAcknowledgment.Document.TERMS: {
        'version': '2026-09-10',
        'effective_date': '2026-09-10',
        'action': LegalAcknowledgment.Action.AGREED,
        'path': '/legal/terms',
    },
    LegalAcknowledgment.Document.ACCEPTABLE_USE: {
        'version': '2026-09-10',
        'effective_date': '2026-09-10',
        'action': LegalAcknowledgment.Action.AGREED,
        'path': '/legal/acceptable-use',
    },
}


class LegalAcknowledgmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = LegalAcknowledgment
        fields = ('id', 'document', 'version', 'effective_date', 'action', 'acknowledged_at')
        read_only_fields = fields


class LegalAcknowledgmentCreateSerializer(serializers.Serializer):
    document = serializers.ChoiceField(choices=LegalAcknowledgment.Document)
    version = serializers.CharField(max_length=30)

    def validate(self, attrs):
        current = LEGAL_DOCUMENTS[attrs['document']]
        if attrs['version'] != current['version']:
            raise serializers.ValidationError({'version': 'This legal-document version is not current.'})
        attrs.update(current)
        return attrs


class PrivacyRequestEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()

    class Meta:
        model = PrivacyRequestEvent
        fields = (
            'id', 'event', 'from_status', 'to_status', 'public_message',
            'internal_note', 'actor', 'actor_name', 'created_at',
        )
        read_only_fields = fields

    def get_actor_name(self, obj):
        if not obj.actor:
            return ''
        return obj.actor.get_display_name()

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get('request')
        if not request or request.user.role not in {
            request.user.Role.ADMIN,
            request.user.Role.PRIVACY_OFFICER,
        }:
            data.pop('internal_note', None)
        return data


class PrivacyRequestSerializer(serializers.ModelSerializer):
    events = PrivacyRequestEventSerializer(many=True, read_only=True)
    subject_name = serializers.CharField(source='subject.get_display_name', read_only=True)
    subject_number = serializers.CharField(source='subject.student_profile.student_number', read_only=True, default='')
    assigned_to_name = serializers.CharField(source='assigned_to.get_display_name', read_only=True, default='')

    class Meta:
        model = PrivacyRequest
        fields = (
            'id', 'subject', 'subject_name', 'subject_number', 'request_type',
            'details', 'status', 'assigned_to', 'assigned_to_name', 'public_response',
            'submitted_at', 'updated_at', 'decided_at', 'completed_at', 'events',
        )
        read_only_fields = (
            'id', 'subject', 'subject_name', 'subject_number', 'status', 'assigned_to',
            'assigned_to_name', 'public_response', 'submitted_at', 'updated_at',
            'decided_at', 'completed_at', 'events',
        )

    def validate_details(self, value):
        value = value.strip()
        if len(value) < 10:
            raise serializers.ValidationError('Please provide enough detail for the school DPO to identify the request.')
        return value


class PrivacyTransitionSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=(
        PrivacyRequest.Status.IDENTITY_VERIFICATION,
        PrivacyRequest.Status.IN_REVIEW,
        PrivacyRequest.Status.APPROVED,
        PrivacyRequest.Status.DENIED,
    ))
    public_message = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    internal_note = serializers.CharField(max_length=4000, required=False, allow_blank=True)


class PrivacyExecutionSerializer(serializers.Serializer):
    public_message = serializers.CharField(max_length=2000)
    internal_note = serializers.CharField(max_length=4000, required=False, allow_blank=True)


class RetentionPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = RetentionPolicy
        fields = (
            'id', 'version', 'retention_days_after_term_close', 'wording',
            'approved_by', 'approved_at', 'is_active', 'created_at',
        )
        read_only_fields = ('id', 'approved_by', 'approved_at', 'is_active', 'created_at')


class TermClosureSerializer(serializers.ModelSerializer):
    class Meta:
        model = TermClosure
        fields = (
            'id', 'term', 'retention_policy', 'official_export_sha256',
            'official_transfer_reference', 'transfer_verified_by', 'transfer_verified_at',
            'dpo_approved_by', 'dpo_approved_at', 'purge_after', 'created_at',
        )
        read_only_fields = (
            'id', 'retention_policy', 'transfer_verified_by', 'transfer_verified_at',
            'dpo_approved_by', 'dpo_approved_at', 'purge_after', 'created_at',
        )

    def validate_official_export_sha256(self, value):
        value = value.strip().lower()
        if len(value) != 64 or any(character not in '0123456789abcdef' for character in value):
            raise serializers.ValidationError('Provide the 64-character SHA-256 digest of the transferred export.')
        return value


class LegalHoldSerializer(serializers.ModelSerializer):
    class Meta:
        model = LegalHold
        fields = (
            'id', 'term', 'reason', 'placed_by', 'placed_at',
            'released_by', 'released_at', 'release_reason',
        )
        read_only_fields = ('id', 'placed_by', 'placed_at', 'released_by', 'released_at', 'release_reason')


class PurgeRunSerializer(serializers.ModelSerializer):
    class Meta:
        model = PurgeRun
        fields = ('id', 'closure', 'mode', 'result', 'actor', 'counts', 'blockers', 'completed_at')
        read_only_fields = fields
