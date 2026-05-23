from django.conf import settings
from django.db import models


class AttendanceSession(models.Model):
    subject = models.ForeignKey(
        'subjects.Subject',
        on_delete=models.CASCADE,
        related_name='attendance_sessions',
    )
    title = models.CharField(max_length=150, blank=True)
    date = models.DateField()
    points_possible = models.DecimalField(max_digits=5, decimal_places=2, default=1)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['subject', 'date', 'title'],
                name='unique_attendance_session',
            ),
        ]
        ordering = ['-date']

    def __str__(self):
        return f'{self.subject} - {self.date}'


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
