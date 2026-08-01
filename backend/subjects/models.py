from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q
from django.utils import timezone

from .scheduling import normalize_schedule_days


class Semester(models.TextChoices):
    FIRST = 'FIRST', '1st Semester'
    SECOND = 'SECOND', '2nd Semester'
    SUMMER = 'SUMMER', 'Summer'


class SchoolYear(models.Model):
    start_year = models.PositiveSmallIntegerField()
    end_year = models.PositiveSmallIntegerField()
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['start_year', 'end_year'],
                name='unique_school_year_range',
            ),
        ]
        ordering = ['-start_year']

    @property
    def name(self):
        return f'{self.start_year}-{self.end_year}'

    def clean(self):
        super().clean()

        if self.end_year != self.start_year + 1:
            raise ValidationError('School year must end one year after it starts.')

    def __str__(self):
        return self.name


class SchoolYearSemester(models.Model):
    school_year = models.ForeignKey(
        SchoolYear,
        on_delete=models.CASCADE,
        related_name='terms',
    )
    semester = models.CharField(max_length=20, choices=Semester)
    is_active = models.BooleanField(default=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['school_year', 'semester'],
                name='unique_school_year_semester',
            ),
        ]
        ordering = ['-school_year__start_year', 'semester']

    @property
    def name(self):
        return f'{self.get_semester_display()} {self.school_year.name}'

    def __str__(self):
        return self.name


class Subject(models.Model):
    code = models.CharField(max_length=30, unique=True)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['code']

    def __str__(self):
        return f'{self.code} - {self.name}'


class SubjectSchedule(models.Model):
    subject = models.ForeignKey(
        Subject,
        on_delete=models.CASCADE,
        related_name='schedules',
    )
    school_year_semester = models.ForeignKey(
        SchoolYearSemester,
        on_delete=models.CASCADE,
        related_name='subject_schedules',
    )
    days = models.CharField(
        max_length=20,
        help_text='Meeting days, for example MWF or TTH.',
    )
    start_time = models.TimeField()
    end_time = models.TimeField()
    section = models.CharField(max_length=80, blank=True)
    room = models.CharField(max_length=80, blank=True)
    is_active = models.BooleanField(default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='created_subject_schedules',
        null=True,
        blank=True,
    )
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='updated_subject_schedules',
        null=True,
        blank=True,
    )
    archived_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='archived_subject_schedules',
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    archived_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['subject', 'school_year_semester', 'days', 'start_time', 'end_time', 'section'],
                name='unique_subject_schedule_slot',
            ),
            models.CheckConstraint(
                condition=Q(end_time__gt=models.F('start_time')),
                name='subject_schedule_end_after_start',
            ),
        ]
        ordering = ['school_year_semester', 'subject__code', 'days', 'start_time']

    def clean(self):
        super().clean()

        try:
            self.days = normalize_schedule_days(self.days)
        except ValueError as error:
            raise ValidationError({'days': str(error)}) from error

        if self.start_time and self.end_time and self.end_time <= self.start_time:
            raise ValidationError('End time must be after start time.')

    def archive(self, actor=None):
        self.is_active = False
        self.archived_at = timezone.now()
        self.archived_by = actor
        self.updated_by = actor
        self.save(update_fields=(
            'is_active',
            'archived_at',
            'archived_by',
            'updated_by',
            'updated_at',
        ))

    def restore(self, actor=None):
        self.is_active = True
        self.archived_at = None
        self.archived_by = None
        self.updated_by = actor
        self.save(update_fields=(
            'is_active',
            'archived_at',
            'archived_by',
            'updated_by',
            'updated_at',
        ))

    def __str__(self):
        return (
            f'{self.subject.code} {self.days} '
            f'{self.start_time.strftime("%I:%M %p").lstrip("0")}-'
            f'{self.end_time.strftime("%I:%M %p").lstrip("0")} '
            f'{self.school_year_semester}'
        )


class ScheduleStudent(models.Model):
    schedule = models.ForeignKey(
        SubjectSchedule,
        on_delete=models.CASCADE,
        related_name='students',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='scheduled_classes',
    )
    added_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='created_schedule_enrollments',
        null=True,
        blank=True,
    )
    deactivated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='deactivated_schedule_enrollments',
        null=True,
        blank=True,
    )
    deactivated_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['schedule', 'student'],
                name='unique_student_schedule_enrollment',
            ),
        ]
        ordering = ['schedule__school_year_semester', 'schedule__subject__code', 'student__username']

    def clean(self):
        super().clean()

        if self.student_id and getattr(self.student, 'role', None) != self.student.Role.STUDENT:
            raise ValidationError('Only users with the student role can be added to a schedule.')

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def set_active(self, is_active, actor=None):
        self.is_active = is_active
        self.deactivated_at = None if is_active else timezone.now()
        self.deactivated_by = None if is_active else actor
        self.save(update_fields=(
            'is_active',
            'deactivated_at',
            'deactivated_by',
            'updated_at',
        ))

    def __str__(self):
        return f'{self.student} in {self.schedule}'


def active_subject_access_filter(user, subject_prefix='subject__'):
    subject_path = subject_prefix[:-2] if subject_prefix.endswith('__') else subject_prefix

    return Q(**{f'{subject_path}__isnull': True}) | (
        Q(**{f'{subject_prefix}schedules__students__student': user})
        & Q(**{f'{subject_prefix}schedules__students__is_active': True})
        & Q(**{f'{subject_prefix}schedules__is_active': True})
    )


def user_has_active_subject_access(user, subject):
    if not subject:
        return True

    return ScheduleStudent.objects.filter(
        student=user,
        is_active=True,
        schedule__is_active=True,
        schedule__subject=subject,
    ).exists()
