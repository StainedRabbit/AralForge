from django.contrib import admin

from .models import AttendanceRecord, AttendanceSession


@admin.register(AttendanceSession)
class AttendanceSessionAdmin(admin.ModelAdmin):
    list_display = ('subject', 'title', 'date', 'points_possible')
    list_filter = ('subject', 'date')
    search_fields = ('subject__code', 'subject__name', 'title')


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ('session', 'student', 'status', 'points_earned')
    list_filter = ('status', 'session__subject')
    search_fields = ('student__username', 'session__subject__code')
