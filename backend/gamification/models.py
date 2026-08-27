from django.conf import settings
from django.db import models


class PointLedger(models.Model):
    class Source(models.TextChoices):
        ATTENDANCE = 'ATTENDANCE', 'Attendance'
        MODULE_ACTIVITY = 'MODULE_ACTIVITY', 'Module Activity'
        MANUAL = 'MANUAL', 'Manual'

    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='point_ledger_entries',
    )
    source = models.CharField(max_length=30, choices=Source)
    points = models.IntegerField()
    description = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.student}: {self.points} points'


class Badge(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=80, blank=True)
    points_required = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['points_required', 'name']

    def __str__(self):
        return self.name


class StudentBadge(models.Model):
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='badges',
    )
    badge = models.ForeignKey(
        Badge,
        on_delete=models.CASCADE,
        related_name='student_badges',
    )
    awarded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['student', 'badge'],
                name='unique_student_badge',
            ),
        ]
        ordering = ['-awarded_at']

    def __str__(self):
        return f'{self.student} - {self.badge}'


class LevelRule(models.Model):
    level = models.PositiveIntegerField(unique=True)
    name = models.CharField(max_length=100)
    points_required = models.PositiveIntegerField(unique=True)

    class Meta:
        ordering = ['level']

    def __str__(self):
        return f'Level {self.level}: {self.name}'
