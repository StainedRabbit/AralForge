from django.contrib import admin

from .models import Badge, LevelRule, PointLedger, StudentBadge


@admin.register(PointLedger)
class PointLedgerAdmin(admin.ModelAdmin):
    list_display = ('student', 'source', 'points', 'created_at')
    list_filter = ('source',)
    search_fields = ('student__username', 'description')


@admin.register(Badge)
class BadgeAdmin(admin.ModelAdmin):
    list_display = ('name', 'points_required', 'is_active')
    list_filter = ('is_active',)
    search_fields = ('name',)


@admin.register(StudentBadge)
class StudentBadgeAdmin(admin.ModelAdmin):
    list_display = ('student', 'badge', 'awarded_at')
    list_filter = ('badge',)
    search_fields = ('student__username', 'badge__name')


@admin.register(LevelRule)
class LevelRuleAdmin(admin.ModelAdmin):
    list_display = ('level', 'name', 'points_required')
