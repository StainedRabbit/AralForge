from django.contrib import admin

from .models import AttendanceRecord, AttendanceSession


@admin.register(AttendanceSession)
class AttendanceSessionAdmin(admin.ModelAdmin):
    list_display = ('subject', 'school_year_semester', 'title', 'date', 'points_possible')
    list_filter = ('subject', 'school_year_semester', 'date')
    search_fields = ('subject__code', 'subject__name', 'school_year_semester__school_year__start_year', 'title')


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ('session', 'student', 'status', 'points_earned')
    list_filter = ('status', 'session__subject', 'session__school_year_semester')
    search_fields = ('student__username', 'session__subject__code')
