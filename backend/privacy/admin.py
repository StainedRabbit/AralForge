from django.contrib import admin

from .models import LegalAcknowledgment, PrivacyRequest, PrivacyRequestEvent


@admin.register(LegalAcknowledgment)
class LegalAcknowledgmentAdmin(admin.ModelAdmin):
    list_display = ('user', 'document', 'version', 'action', 'acknowledged_at')
    list_filter = ('document', 'version', 'action')
    readonly_fields = ('user', 'document', 'version', 'effective_date', 'action', 'acknowledged_at')

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class PrivacyRequestEventInline(admin.TabularInline):
    model = PrivacyRequestEvent
    extra = 0
    readonly_fields = ('actor', 'event', 'from_status', 'to_status', 'public_message', 'internal_note', 'created_at')
    can_delete = False


@admin.register(PrivacyRequest)
class PrivacyRequestAdmin(admin.ModelAdmin):
    list_display = ('id', 'subject', 'request_type', 'status', 'assigned_to', 'submitted_at')
    list_filter = ('request_type', 'status')
    readonly_fields = ('submitted_at', 'updated_at', 'decided_at', 'completed_at')
    inlines = (PrivacyRequestEventInline,)


@admin.register(PrivacyRequestEvent)
class PrivacyRequestEventAdmin(admin.ModelAdmin):
    list_display = ('request', 'event', 'actor', 'from_status', 'to_status', 'created_at')
    readonly_fields = ('request', 'actor', 'event', 'from_status', 'to_status', 'public_message', 'internal_note', 'created_at')

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
