from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


class AttendanceSession(models.Model):
    schedule = models.ForeignKey(
        'subjects.SubjectSchedule',
        on_delete=models.SET_NULL,
        related_name='attendance_sessions',
        null=True,
        blank=True,
    )
    subject = models.ForeignKey(
        'subjects.Subject',
        on_delete=models.CASCADE,
        related_name='attendance_sessions',
    )
    school_year_semester = models.ForeignKey(
        'subjects.SchoolYearSemester',
        on_delete=models.CASCADE,
        related_name='attendance_sessions',
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=150, blank=True)
    date = models.DateField()
    points_possible = models.DecimalField(max_digits=5, decimal_places=2, default=1)
    notes = models.TextField(blank=True)
    roster_students = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        related_name='attendance_session_rosters',
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['schedule', 'date', 'title'],
                condition=Q(schedule__isnull=False),
                name='unique_attendance_session_schedule',
            ),
        ]
        ordering = ['-date']
        indexes = [models.Index(fields=['schedule', 'date'], name='attendance_schedule_date_idx')]

    def clean(self):
        super().clean()

        if self.schedule_id:
            if self.subject_id != self.schedule.subject_id:
                raise ValidationError('Attendance subject must match the selected class.')
            if self.school_year_semester_id != self.schedule.school_year_semester_id:
                raise ValidationError('Attendance term must match the selected class.')

    def __str__(self):
        term = f' - {self.school_year_semester}' if self.school_year_semester_id else ''
        return f'{self.subject}{term} - {self.date}'


class AttendanceRecord(models.Model):
    class Status(models.TextChoices):
        PRESENT = 'PRESENT', 'Present'
        LATE = 'LATE', 'Late'
        EXCUSED = 'EXCUSED', 'Excused'
        ABSENT = 'ABSENT', 'Absent'

    session = models.ForeignKey(
        AttendanceSession,
        on_delete=models.CASCADE,
        related_name='records',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='attendance_records',
    )
    status = models.CharField(max_length=20, choices=Status)
    points_earned = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    remarks = models.TextField(blank=True)
    recorded_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['session', 'student'],
                name='unique_attendance_record',
            ),
        ]
        ordering = ['session__date', 'student__username']

    def __str__(self):
        return f'{self.student} - {self.session}: {self.status}'
