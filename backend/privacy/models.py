import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


class ImmutableModel(models.Model):
    class Meta:
        abstract = True

    def save(self, *args, **kwargs):
        if self.pk and type(self).objects.filter(pk=self.pk).exists():
            raise ValidationError(f'{type(self).__name__} records are immutable.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError(f'{type(self).__name__} records cannot be deleted.')


class LegalAcknowledgment(ImmutableModel):
    class Document(models.TextChoices):
        PRIVACY = 'PRIVACY', 'Privacy Notice'
        TERMS = 'TERMS', 'Terms of Use'
        ACCEPTABLE_USE = 'ACCEPTABLE_USE', 'Acceptable Use and Academic Integrity'

    class Action(models.TextChoices):
        ACKNOWLEDGED = 'ACKNOWLEDGED', 'Acknowledged'
        AGREED = 'AGREED', 'Agreed'

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='legal_acknowledgments',
    )
    document = models.CharField(max_length=30, choices=Document)
    version = models.CharField(max_length=30)
    effective_date = models.DateField()
    action = models.CharField(max_length=20, choices=Action)
    acknowledged_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'document', 'version', 'action'],
                name='unique_legal_acknowledgment',
            ),
        ]
        ordering = ['acknowledged_at', 'id']


class PrivacyRequest(models.Model):
    class RequestType(models.TextChoices):
        ACCESS = 'ACCESS', 'Access'
        CORRECTION = 'CORRECTION', 'Correction'
        PORTABILITY = 'PORTABILITY', 'Portability'
        OBJECTION = 'OBJECTION', 'Objection'
        ERASURE_BLOCKING = 'ERASURE_BLOCKING', 'Erasure or blocking'

    class Status(models.TextChoices):
        SUBMITTED = 'SUBMITTED', 'Submitted'
        IDENTITY_VERIFICATION = 'IDENTITY_VERIFICATION', 'Identity verification'
        IN_REVIEW = 'IN_REVIEW', 'In review'
        APPROVED = 'APPROVED', 'Approved'
        DENIED = 'DENIED', 'Denied'
        COMPLETED = 'COMPLETED', 'Completed'
        CANCELLED = 'CANCELLED', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subject = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='privacy_requests',
    )
    request_type = models.CharField(max_length=30, choices=RequestType)
    details = models.TextField(max_length=4000)
    status = models.CharField(max_length=30, choices=Status, default=Status.SUBMITTED)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='assigned_privacy_requests',
        null=True,
        blank=True,
    )
    public_response = models.TextField(max_length=4000, blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    decided_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-submitted_at']
        indexes = [
            models.Index(fields=['status', 'submitted_at'], name='privacy_status_submitted_idx'),
            models.Index(fields=['subject', 'submitted_at'], name='privacy_subject_submitted_idx'),
        ]

    def clean(self):
        if self.assigned_to_id and self.assigned_to.role != self.assigned_to.Role.PRIVACY_OFFICER:
            raise ValidationError({'assigned_to': 'Privacy requests may only be assigned to a privacy officer.'})


class PrivacyRequestEvent(ImmutableModel):
    request = models.ForeignKey(PrivacyRequest, on_delete=models.CASCADE, related_name='events')
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='privacy_request_events',
        null=True,
        blank=True,
    )
    event = models.CharField(max_length=40)
    from_status = models.CharField(max_length=30, blank=True)
    to_status = models.CharField(max_length=30, blank=True)
    public_message = models.TextField(max_length=2000, blank=True)
    internal_note = models.TextField(max_length=4000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']


class RetentionPolicy(models.Model):
    version = models.CharField(max_length=40, unique=True)
    retention_days_after_term_close = models.PositiveIntegerField()
    wording = models.TextField(max_length=4000)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='approved_retention_policies',
    )
    approved_at = models.DateTimeField()
    is_active = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-approved_at', '-id']
        constraints = [
            models.UniqueConstraint(
                fields=['is_active'], condition=models.Q(is_active=True),
                name='single_active_retention_policy',
            ),
        ]

    def clean(self):
        if self.approved_by_id and self.approved_by.role != self.approved_by.Role.PRIVACY_OFFICER:
            raise ValidationError({'approved_by': 'A retention policy requires school DPO approval.'})


class LegalHold(models.Model):
    term = models.ForeignKey(
        'subjects.SchoolYearSemester', on_delete=models.PROTECT, related_name='legal_holds',
    )
    reason = models.TextField(max_length=2000)
    placed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='placed_legal_holds',
    )
    placed_at = models.DateTimeField(auto_now_add=True)
    released_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='released_legal_holds',
        null=True, blank=True,
    )
    released_at = models.DateTimeField(null=True, blank=True)
    release_reason = models.TextField(max_length=2000, blank=True)

    class Meta:
        ordering = ['-placed_at']
        constraints = [
            models.UniqueConstraint(
                fields=['term'], condition=models.Q(released_at__isnull=True),
                name='single_active_legal_hold_per_term',
            ),
        ]


class TermClosure(models.Model):
    term = models.OneToOneField(
        'subjects.SchoolYearSemester', on_delete=models.PROTECT, related_name='privacy_closure',
    )
    retention_policy = models.ForeignKey(
        RetentionPolicy, on_delete=models.PROTECT, related_name='term_closures',
    )
    official_export_sha256 = models.CharField(max_length=64)
    official_transfer_reference = models.CharField(max_length=500)
    transfer_verified_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='verified_term_transfers',
    )
    transfer_verified_at = models.DateTimeField()
    dpo_approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='approved_term_closures',
        null=True, blank=True,
    )
    dpo_approved_at = models.DateTimeField(null=True, blank=True)
    purge_after = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def clean(self):
        if self.dpo_approved_by_id and self.dpo_approved_by.role != self.dpo_approved_by.Role.PRIVACY_OFFICER:
            raise ValidationError({'dpo_approved_by': 'Term closure requires school DPO approval.'})
        if self.transfer_verified_by_id and self.transfer_verified_by.role != self.transfer_verified_by.Role.ADMIN:
            raise ValidationError({'transfer_verified_by': 'An administrator must verify the official transfer.'})


class PurgeRun(ImmutableModel):
    class Mode(models.TextChoices):
        DRY_RUN = 'DRY_RUN', 'Dry run'
        EXECUTE = 'EXECUTE', 'Execute'

    class Result(models.TextChoices):
        READY = 'READY', 'Ready'
        BLOCKED = 'BLOCKED', 'Blocked'
        COMPLETED = 'COMPLETED', 'Completed'

    closure = models.ForeignKey(TermClosure, on_delete=models.PROTECT, related_name='purge_runs')
    mode = models.CharField(max_length=20, choices=Mode)
    result = models.CharField(max_length=20, choices=Result)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='retention_purge_runs',
    )
    counts = models.JSONField(default=dict)
    blockers = models.JSONField(default=list)
    completed_at = models.DateTimeField(auto_now_add=True)
