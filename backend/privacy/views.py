from django.db import transaction
from datetime import timedelta

from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.exceptions import ValidationError
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User

from .models import (
    LegalAcknowledgment,
    LegalHold,
    PrivacyRequest,
    PrivacyRequestEvent,
    PurgeRun,
    RetentionPolicy,
    TermClosure,
)
from .retention import execute_retention_purge, retention_preview
from .serializers import (
    LEGAL_DOCUMENTS,
    LegalAcknowledgmentCreateSerializer,
    LegalAcknowledgmentSerializer,
    PrivacyExecutionSerializer,
    PrivacyRequestSerializer,
    PrivacyTransitionSerializer,
    LegalHoldSerializer,
    PurgeRunSerializer,
    RetentionPolicySerializer,
    TermClosureSerializer,
)


class LegalStatusView(APIView):
    def get(self, request):
        acknowledgments = LegalAcknowledgment.objects.filter(user=request.user)
        accepted = {(item.document, item.version, item.action) for item in acknowledgments}
        documents = [
            {
                'document': document,
                **metadata,
                'accepted': (document, metadata['version'], metadata['action']) in accepted,
            }
            for document, metadata in LEGAL_DOCUMENTS.items()
        ]
        return Response({
            'complete': all(item['accepted'] for item in documents),
            'documents': documents,
        })


class LegalAcknowledgmentView(APIView):
    def post(self, request):
        serializer = LegalAcknowledgmentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        values = serializer.validated_data
        acknowledgment, _ = LegalAcknowledgment.objects.get_or_create(
            user=request.user,
            document=values['document'],
            version=values['version'],
            action=values['action'],
            defaults={'effective_date': values['effective_date']},
        )
        return Response(
            LegalAcknowledgmentSerializer(acknowledgment).data,
            status=status.HTTP_201_CREATED,
        )


class PrivacyRequestViewSet(viewsets.ModelViewSet):
    serializer_class = PrivacyRequestSerializer
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        queryset = PrivacyRequest.objects.select_related(
            'subject__student_profile', 'assigned_to',
        ).prefetch_related('events__actor')
        user = self.request.user
        if user.role in {User.Role.ADMIN, User.Role.PRIVACY_OFFICER}:
            return queryset
        return queryset.filter(subject=user)

    @transaction.atomic
    def perform_create(self, serializer):
        if self.request.user.role != User.Role.STUDENT:
            raise ValidationError('Only students may submit a privacy request through this form.')
        privacy_request = serializer.save(subject=self.request.user)
        PrivacyRequestEvent.objects.create(
            request=privacy_request,
            actor=self.request.user,
            event='SUBMITTED',
            to_status=PrivacyRequest.Status.SUBMITTED,
            public_message='Your request was submitted to the school privacy office.',
        )

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def cancel(self, request, pk=None):
        privacy_request = self.get_object()
        if privacy_request.subject_id != request.user.id:
            return Response({'detail': 'Only the requester may cancel this request.'}, status=403)
        if privacy_request.status not in {
            PrivacyRequest.Status.SUBMITTED,
            PrivacyRequest.Status.IDENTITY_VERIFICATION,
        }:
            return Response({'detail': 'This request can no longer be cancelled.'}, status=400)
        previous = privacy_request.status
        privacy_request.status = PrivacyRequest.Status.CANCELLED
        privacy_request.save(update_fields=['status', 'updated_at'])
        PrivacyRequestEvent.objects.create(
            request=privacy_request, actor=request.user, event='CANCELLED',
            from_status=previous, to_status=privacy_request.status,
            public_message='The requester cancelled this request.',
        )
        return Response(self.get_serializer(privacy_request).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def transition(self, request, pk=None):
        if request.user.role != User.Role.PRIVACY_OFFICER:
            return Response({'detail': 'Only the school privacy officer may decide requests.'}, status=403)
        privacy_request = self.get_object()
        serializer = PrivacyTransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        target = serializer.validated_data['status']
        allowed = {
            PrivacyRequest.Status.SUBMITTED: {
                PrivacyRequest.Status.IDENTITY_VERIFICATION, PrivacyRequest.Status.IN_REVIEW,
            },
            PrivacyRequest.Status.IDENTITY_VERIFICATION: {PrivacyRequest.Status.IN_REVIEW},
            PrivacyRequest.Status.IN_REVIEW: {
                PrivacyRequest.Status.APPROVED, PrivacyRequest.Status.DENIED,
            },
        }
        if target not in allowed.get(privacy_request.status, set()):
            return Response({'detail': 'That status transition is not allowed.'}, status=400)
        previous = privacy_request.status
        privacy_request.status = target
        privacy_request.assigned_to = request.user
        privacy_request.public_response = serializer.validated_data.get('public_message', '')
        if target in {PrivacyRequest.Status.APPROVED, PrivacyRequest.Status.DENIED}:
            privacy_request.decided_at = timezone.now()
        privacy_request.full_clean()
        privacy_request.save()
        PrivacyRequestEvent.objects.create(
            request=privacy_request, actor=request.user, event='STATUS_CHANGED',
            from_status=previous, to_status=target,
            public_message=serializer.validated_data.get('public_message', ''),
            internal_note=serializer.validated_data.get('internal_note', ''),
        )
        return Response(self.get_serializer(privacy_request).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def execute(self, request, pk=None):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({'detail': 'Only an administrator may record execution.'}, status=403)
        privacy_request = self.get_object()
        if privacy_request.status != PrivacyRequest.Status.APPROVED:
            return Response({'detail': 'Only an approved request may be executed.'}, status=400)
        serializer = PrivacyExecutionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        previous = privacy_request.status
        privacy_request.status = PrivacyRequest.Status.COMPLETED
        privacy_request.public_response = serializer.validated_data['public_message']
        privacy_request.completed_at = timezone.now()
        privacy_request.save()
        PrivacyRequestEvent.objects.create(
            request=privacy_request, actor=request.user, event='EXECUTED',
            from_status=previous, to_status=privacy_request.status,
            public_message=serializer.validated_data['public_message'],
            internal_note=serializer.validated_data.get('internal_note', ''),
        )
        return Response(self.get_serializer(privacy_request).data)


class RetentionPolicyViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = RetentionPolicy.objects.select_related('approved_by')
    serializer_class = RetentionPolicySerializer

    @action(detail=False, methods=['post'], url_path='approve')
    @transaction.atomic
    def approve(self, request):
        if request.user.role != User.Role.PRIVACY_OFFICER:
            return Response({'detail': 'Only the school DPO may approve retention policy versions.'}, status=403)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        RetentionPolicy.objects.filter(is_active=True).update(is_active=False)
        policy = serializer.save(
            approved_by=request.user, approved_at=timezone.now(), is_active=True,
        )
        policy.full_clean()
        return Response(self.get_serializer(policy).data, status=201)


class TermClosureViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = TermClosure.objects.select_related(
        'term', 'retention_policy', 'transfer_verified_by', 'dpo_approved_by',
    )
    serializer_class = TermClosureSerializer

    @action(detail=False, methods=['post'], url_path='record-transfer')
    @transaction.atomic
    def record_transfer(self, request):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({'detail': 'Only an administrator may verify official-grade transfer.'}, status=403)
        policy = RetentionPolicy.objects.filter(is_active=True).first()
        if not policy:
            raise ValidationError({'retention_policy': 'No DPO-approved retention policy is active.'})
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        closure = serializer.save(
            retention_policy=policy,
            transfer_verified_by=request.user,
            transfer_verified_at=timezone.now(),
        )
        return Response(self.get_serializer(closure).data, status=201)

    @action(detail=True, methods=['post'], url_path='dpo-approve')
    @transaction.atomic
    def dpo_approve(self, request, pk=None):
        if request.user.role != User.Role.PRIVACY_OFFICER:
            return Response({'detail': 'Only the school DPO may approve a term closure.'}, status=403)
        closure = self.get_object()
        if closure.dpo_approved_at:
            raise ValidationError({'detail': 'This term closure is already approved.'})
        closure.dpo_approved_by = request.user
        closure.dpo_approved_at = timezone.now()
        closure.purge_after = closure.dpo_approved_at + timedelta(
            days=closure.retention_policy.retention_days_after_term_close,
        )
        closure.full_clean()
        closure.save(update_fields=('dpo_approved_by', 'dpo_approved_at', 'purge_after'))
        return Response(self.get_serializer(closure).data)

    @action(detail=True, methods=['post'], url_path='purge-preview')
    def purge_preview(self, request, pk=None):
        if request.user.role not in {User.Role.ADMIN, User.Role.PRIVACY_OFFICER}:
            return Response({'detail': 'Only an administrator or the school DPO may preview a purge.'}, status=403)
        closure = self.get_object()
        counts, blockers = retention_preview(closure)
        run = PurgeRun.objects.create(
            closure=closure, mode=PurgeRun.Mode.DRY_RUN,
            result=PurgeRun.Result.BLOCKED if blockers else PurgeRun.Result.READY,
            actor=request.user, counts=counts, blockers=blockers,
        )
        return Response(PurgeRunSerializer(run).data)

    @action(detail=True, methods=['post'], url_path='purge-execute')
    def purge_execute(self, request, pk=None):
        if request.user.role != User.Role.ADMIN and not request.user.is_superuser:
            return Response({'detail': 'Only an administrator may execute an approved purge.'}, status=403)
        run = execute_retention_purge(self.get_object(), request.user)
        return Response(PurgeRunSerializer(run).data)


class LegalHoldViewSet(viewsets.ReadOnlyModelViewSet):
    queryset = LegalHold.objects.select_related('term', 'placed_by', 'released_by')
    serializer_class = LegalHoldSerializer

    @transaction.atomic
    def create(self, request, *args, **kwargs):
        if request.user.role != User.Role.PRIVACY_OFFICER:
            return Response({'detail': 'Only the school DPO may place a legal hold.'}, status=403)
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        hold = serializer.save(placed_by=request.user)
        return Response(self.get_serializer(hold).data, status=201)

    @action(detail=True, methods=['post'])
    def release(self, request, pk=None):
        if request.user.role != User.Role.PRIVACY_OFFICER:
            return Response({'detail': 'Only the school DPO may release a legal hold.'}, status=403)
        hold = self.get_object()
        reason = str(request.data.get('reason', '')).strip()
        if not reason:
            raise ValidationError({'reason': 'A release reason is required.'})
        hold.released_by = request.user
        hold.released_at = timezone.now()
        hold.release_reason = reason
        hold.save(update_fields=('released_by', 'released_at', 'release_reason'))
        return Response(self.get_serializer(hold).data)
