from django.conf import settings
from django.db import models


class Module(models.Model):
    title = models.CharField(max_length=180)
    slug = models.SlugField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    content = models.TextField(blank=True)
    subjects = models.ManyToManyField(
        'subjects.Subject',
        blank=True,
        related_name='modules',
    )
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['title']

    def __str__(self):
        return self.title


class ModuleActivity(models.Model):
    module = models.ForeignKey(
        Module,
        on_delete=models.CASCADE,
        related_name='activities',
    )
    title = models.CharField(max_length=180)
    instructions = models.TextField()
    points_possible = models.DecimalField(max_digits=6, decimal_places=2, default=100)
    due_at = models.DateTimeField(null=True, blank=True)
    accepts_text = models.BooleanField(default=True)
    accepts_file = models.BooleanField(default=False)
    accepts_code = models.BooleanField(default=False)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['module', 'title']
        verbose_name_plural = 'module activities'

    def __str__(self):
        return f'{self.module}: {self.title}'


class ModuleActivitySubmission(models.Model):
    activity = models.ForeignKey(
        ModuleActivity,
        on_delete=models.CASCADE,
        related_name='submissions',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='module_activity_submissions',
    )
    text_answer = models.TextField(blank=True)
    file = models.FileField(upload_to='activity_submissions/', blank=True)
    code = models.TextField(blank=True)
    score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    feedback = models.TextField(blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    graded_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['activity', 'student'],
                name='unique_module_activity_submission',
            ),
        ]
        ordering = ['-submitted_at']

    def __str__(self):
        return f'{self.student} - {self.activity}'
