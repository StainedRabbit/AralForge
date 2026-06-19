from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from subjects.models import active_subject_access_filter


class Module(models.Model):
    title = models.CharField(max_length=180)
    slug = models.SlugField(max_length=200, unique=True)
    description = models.TextField(blank=True)
    content = models.TextField(blank=True)
    learning_objectives = models.TextField(blank=True)
    lesson_overview = models.TextField(blank=True)
    detailed_discussion = models.TextField(blank=True)
    examples = models.TextField(blank=True)
    teacher_notes = models.TextField(blank=True)
    student_activities = models.TextField(blank=True)
    resources = models.TextField(blank=True)
    pdf_file = models.FileField(upload_to='module_pdfs/', blank=True)
    is_paid = models.BooleanField(default=True)
    price = models.DecimalField(max_digits=8, decimal_places=2, default=0)
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


class ModuleAccess(models.Model):
    class PaymentStatus(models.TextChoices):
        UNPAID = 'UNPAID', 'Unpaid'
        PAID = 'PAID', 'Paid'
        WAIVED = 'WAIVED', 'Waived'

    module = models.ForeignKey(
        Module,
        on_delete=models.CASCADE,
        related_name='access_grants',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='module_access_grants',
    )
    activated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='activated_module_access_grants',
        null=True,
        blank=True,
    )
    payment_status = models.CharField(
        max_length=20,
        choices=PaymentStatus,
        default=PaymentStatus.PAID,
    )
    amount_paid = models.DecimalField(max_digits=8, decimal_places=2, default=0)
    payment_reference = models.CharField(max_length=120, blank=True)
    is_active = models.BooleanField(default=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True)
    activated_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['module', 'student'],
                name='unique_module_access_per_student',
            ),
        ]
        ordering = ['module__title', 'student__username']
        verbose_name_plural = 'module access grants'

    @property
    def is_available(self):
        if not self.is_active:
            return False

        return self.expires_at is None or self.expires_at > timezone.now()

    def clean(self):
        super().clean()

        if self.student_id and getattr(self.student, 'role', None) != self.student.Role.STUDENT:
            from django.core.exceptions import ValidationError

            raise ValidationError('Only student users can receive module access.')

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.student} access to {self.module}'


def active_module_access_filter(user, prefix=''):
    access_prefix = f'{prefix}access_grants__'

    paid_access_filter = Q(**{f'{prefix}is_paid': False}) | (
        Q(**{f'{access_prefix}student': user})
        & Q(**{f'{access_prefix}is_active': True})
        & (
            Q(**{f'{access_prefix}expires_at__isnull': True})
            | Q(**{f'{access_prefix}expires_at__gt': timezone.now()})
        )
    )

    return paid_access_filter & active_subject_access_filter(
        user,
        subject_prefix=f'{prefix}subjects__',
    )


def user_has_module_access(user, module):
    if not user_has_module_class_access(user, module):
        return False

    if not module.is_paid:
        return True

    return ModuleAccess.objects.filter(
        module=module,
        student=user,
        is_active=True,
    ).filter(
        Q(expires_at__isnull=True) | Q(expires_at__gt=timezone.now())
    ).exists()


def user_has_module_class_access(user, module):
    subjects = module.subjects.all()

    if not subjects:
        return True

    return any(
        subject.schedules.filter(
            is_active=True,
            students__student=user,
            students__is_active=True,
        ).exists()
        for subject in subjects
    )


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
