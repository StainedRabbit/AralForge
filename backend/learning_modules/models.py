from django.conf import settings
from django.db import models


class Module(models.Model):
    title = models.CharField(max_length=180)
    slug = models.SlugField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    content = models.TextField(blank=True)
    pdf_file = models.FileField(upload_to='module_pdfs/', blank=True)
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
    class ActivityType(models.TextChoices):
        TEXT = 'TEXT', 'Text'
        FILE_UPLOAD = 'FILE_UPLOAD', 'File Upload'
        CODE_COMPLETE = 'CODE_COMPLETE', 'Complete Coding'
        CODE_FILL_BLANK = 'CODE_FILL_BLANK', 'Fill in the Blank Coding'

    module = models.ForeignKey(
        Module,
        on_delete=models.CASCADE,
        related_name='activities',
    )
    programming_problem = models.ForeignKey(
        'coding.ProgrammingProblem',
        on_delete=models.SET_NULL,
        related_name='module_activities',
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=180)
    instructions = models.TextField()
    activity_type = models.CharField(
        max_length=30,
        choices=ActivityType,
        default=ActivityType.TEXT,
    )
    order = models.PositiveIntegerField(default=0)
    points_possible = models.DecimalField(max_digits=6, decimal_places=2, default=100)
    due_at = models.DateTimeField(null=True, blank=True)
    accepts_text = models.BooleanField(default=True)
    accepts_file = models.BooleanField(default=False)
    accepts_code = models.BooleanField(default=False)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['module', 'order', 'id']
        verbose_name_plural = 'module activities'

    def __str__(self):
        return f'{self.module}: {self.title}'


class ModuleProgress(models.Model):
    module = models.ForeignKey(
        Module,
        on_delete=models.CASCADE,
        related_name='progress',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='module_progress',
    )
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['module', 'student'],
                name='unique_module_progress',
            ),
        ]
        ordering = ['-started_at']
        verbose_name_plural = 'module progress'

    def __str__(self):
        return f'{self.student} - {self.module}'


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
