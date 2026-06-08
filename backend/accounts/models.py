from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    class Role(models.TextChoices):
        ADMIN = 'ADMIN', 'Admin'
        TEACHER = 'TEACHER', 'Teacher'
        STUDENT = 'STUDENT', 'Student'

    role = models.CharField(max_length=20, choices=Role, default=Role.STUDENT)

    @property
    def is_admin_teacher(self):
        return self.role in {self.Role.ADMIN, self.Role.TEACHER} or self.is_superuser

    def __str__(self):
        return self.get_full_name() or self.username


class StudentProfile(models.Model):
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='student_profile',
    )
    student_number = models.CharField(max_length=30, unique=True)
    section = models.CharField(max_length=80, blank=True)
    year_level = models.PositiveSmallIntegerField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    joined_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['student_number']

    def __str__(self):
        return f'{self.student_number} - {self.user}'
