from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import StudentProfile, User


@admin.register(User)
class EzoryxUserAdmin(UserAdmin):
    fieldsets = UserAdmin.fieldsets + (
        ('Ezoryx', {'fields': ('role', 'must_change_password')}),
    )
    add_fieldsets = UserAdmin.add_fieldsets + (
        ('Ezoryx', {'fields': ('role', 'must_change_password')}),
    )
    list_display = (
        'username',
        'email',
        'first_name',
        'last_name',
        'role',
        'must_change_password',
        'is_staff',
    )
    list_filter = ('role', 'must_change_password', 'is_staff', 'is_superuser', 'is_active')


@admin.register(StudentProfile)
class StudentProfileAdmin(admin.ModelAdmin):
    list_display = ('student_number', 'user', 'section', 'year_level', 'is_active')
    list_filter = ('is_active', 'section', 'year_level')
    search_fields = ('student_number', 'user__username', 'user__first_name', 'user__last_name')
