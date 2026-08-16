import calendar

from django.conf import settings
from django.core.validators import FileExtensionValidator
from django.db import models
from django.db.models import Q
from django.utils import timezone

class Module(models.Model):
    title = models.CharField(max_length=180)
    slug = models.SlugField(max_length=200, unique=True)
    subject = models.OneToOneField(
        'subjects.Subject',
        on_delete=models.CASCADE,
        related_name='learning_module',
        null=True,
        blank=True,
    )
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
    pdf_generated_at = models.DateTimeField(null=True, blank=True)
    pdf_is_outdated = models.BooleanField(default=True)
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

    def save(self, *args, **kwargs):
        previous = None
        if self.pk:
            previous = Module.objects.filter(pk=self.pk).values(
                'title',
                'slug',
                'subject_id',
                'description',
                'content',
                'learning_objectives',
                'lesson_overview',
                'detailed_discussion',
                'examples',
                'student_activities',
                'resources',
                'pdf_file',
                'pdf_generated_at',
                'is_published',
            ).first()

        if previous and previous['pdf_generated_at'] and module_pdf_content_changed(
            self,
            previous,
        ):
            self.pdf_is_outdated = True

        super().save(*args, **kwargs)

        if (
            self.is_published
            and not self.pdf_file
            and (not previous or not previous['is_published'])
        ):
            safe_generate_module_pdf(self)


class ModuleTopic(models.Model):
    module = models.ForeignKey(
        Module,
        on_delete=models.CASCADE,
        related_name='topics',
    )
    legacy_module = models.OneToOneField(
        Module,
        on_delete=models.SET_NULL,
        related_name='migrated_topic',
        null=True,
        blank=True,
    )
    title = models.CharField(max_length=180)
    order = models.PositiveIntegerField(default=0)
    competency_code = models.CharField(max_length=80, blank=True)
    competency_text = models.TextField(blank=True)
    unit = models.CharField(max_length=180, blank=True)
    overview = models.TextField(blank=True)
    essential_question = models.TextField(blank=True)
    enduring_understanding = models.TextField(blank=True)
    performance_task = models.TextField(blank=True)
    success_criteria = models.TextField(blank=True)
    values_focus = models.TextField(blank=True)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['module', 'title'],
                name='unique_topic_title_per_module',
            ),
        ]
        ordering = ['module', 'order', 'id']

    def __str__(self):
        return f'{self.module}: {self.title}'

    def save(self, *args, **kwargs):
        previous = None
        if self.pk:
            previous = ModuleTopic.objects.filter(pk=self.pk).values(
                'module_id',
                'is_published',
            ).first()

        super().save(*args, **kwargs)

        if previous and (
            previous['module_id'] != self.module_id
            or previous['is_published'] != self.is_published
        ):
            if previous['module_id'] != self.module_id:
                previous_module = Module.objects.filter(
                    pk=previous['module_id'],
                ).first()
                if previous_module:
                    sync_module_progress_for_students(previous_module)
                    mark_module_pdf_outdated(previous_module)
            sync_module_progress_for_students(self.module)
        if previous:
            mark_module_pdf_outdated(self.module)

    def delete(self, *args, **kwargs):
        module = self.module
        student_ids = progress_student_ids_for_module(module)
        result = super().delete(*args, **kwargs)
        sync_module_progress_for_students(module, student_ids=student_ids)
        mark_module_pdf_outdated(module)
        return result


class ModuleLesson(models.Model):
    topic = models.ForeignKey(
        ModuleTopic,
        on_delete=models.CASCADE,
        related_name='lessons',
    )
    title = models.CharField(max_length=180)
    order = models.PositiveIntegerField(default=0)
    learning_targets = models.TextField(blank=True)
    before_you_start = models.TextField(blank=True)
    short_discussion = models.TextField(blank=True)
    guided_examples = models.TextField(blank=True)
    lets_practice = models.TextField(blank=True)
    challenge_task = models.TextField(blank=True)
    objectives = models.TextField(blank=True)
    overview = models.TextField(blank=True)
    subtopics = models.TextField(blank=True)
    acquisition = models.TextField(blank=True)
    making_meaning = models.TextField(blank=True)
    transfer = models.TextField(blank=True)
    examples = models.TextField(blank=True)
    teacher_notes = models.TextField(blank=True)
    answer_key = models.TextField(blank=True)
    expected_outputs = models.TextField(blank=True)
    common_misconceptions = models.TextField(blank=True)
    teaching_tips = models.TextField(blank=True)
    remediation = models.TextField(blank=True)
    enrichment = models.TextField(blank=True)
    student_activities = models.TextField(blank=True)
    resources = models.TextField(blank=True)
    assessment_url = models.URLField(blank=True)
    pdf_file = models.FileField(upload_to='module_lesson_pdfs/', blank=True)
    pdf_generated_at = models.DateTimeField(null=True, blank=True)
    pdf_is_outdated = models.BooleanField(default=True)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['topic', 'order', 'id']

    def __str__(self):
        return f'{self.topic}: {self.title}'

    def save(self, *args, **kwargs):
        is_new = self.pk is None
        previous_topic = None
        previous_is_published = None
        previous = None
        if self.pk:
            previous = ModuleLesson.objects.filter(pk=self.pk).values(
                'topic_id',
                'is_published',
                'title',
                'order',
                'learning_targets',
                'before_you_start',
                'short_discussion',
                'guided_examples',
                'lets_practice',
                'challenge_task',
                'objectives',
                'overview',
                'student_activities',
                'resources',
                'assessment_url',
                'pdf_file',
                'pdf_generated_at',
            ).first()
            if previous:
                previous_is_published = previous['is_published']
                if previous['topic_id'] != self.topic_id:
                    previous_topic = ModuleTopic.objects.filter(
                        pk=previous['topic_id'],
                    ).first()

        if previous and previous['pdf_generated_at'] and lesson_pdf_content_changed(
            self,
            previous,
        ):
            self.pdf_is_outdated = True

        super().save(*args, **kwargs)

        if previous_topic:
            sync_progress_for_topic_students(previous_topic)
            mark_module_pdf_outdated(previous_topic.module)
        mark_module_pdf_outdated(self.topic.module)
        if (is_new and self.is_published) or previous_topic or (
            previous_is_published is not None
            and previous_is_published != self.is_published
        ):
            sync_progress_for_topic_students(self.topic)

        if (
            self.is_published
            and not self.pdf_file
            and (
                is_new
                or previous_is_published is None
                or previous_is_published != self.is_published
            )
        ):
            safe_generate_lesson_pdf(self)

    def delete(self, *args, **kwargs):
        topic = self.topic
        student_ids = progress_student_ids_for_topic(topic)
        result = super().delete(*args, **kwargs)
        sync_progress_for_topic_students(topic, student_ids=student_ids)
        mark_module_pdf_outdated(topic.module)
        return result


class ModuleAccess(models.Model):
    class AccessType(models.TextChoices):
        PAYMENT = 'PAYMENT', 'Payment'
        ADVANCE_STUDY = 'ADVANCE_STUDY', 'Advance Study'

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
    access_type = models.CharField(
        max_length=20,
        choices=AccessType,
        default=AccessType.PAYMENT,
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
                fields=['module', 'student', 'access_type'],
                name='unique_module_access_type_per_student',
            ),
        ]
        ordering = ['module__title', 'student__username']
        verbose_name_plural = 'module access grants'

    @property
    def is_available(self):
        if not self.is_active:
            return False

        if self.expires_at is not None and self.expires_at <= timezone.now():
            return False

        return (
            self.activated_by_id is not None
            and self.expires_at is not None
            and self.payment_status == self.PaymentStatus.PAID
        )

    def clean(self):
        super().clean()

        if self.student_id and getattr(self.student, 'role', None) != self.student.Role.STUDENT:
            from django.core.exceptions import ValidationError

            raise ValidationError('Only student users can receive module access.')

        if self.is_active and not self.activated_by_id:
            from django.core.exceptions import ValidationError

            raise ValidationError('Paid module access must identify the teacher who activated it.')

        if self.is_active and self.payment_status != self.PaymentStatus.PAID:
            from django.core.exceptions import ValidationError

            raise ValidationError('Active module access requires a paid cash payment.')

        if self.is_active and not self.expires_at:
            self.expires_at = add_calendar_months(timezone.now(), 5)

    def save(self, *args, **kwargs):
        self.clean()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.student} access to {self.module}'


def active_module_access_filter(user, prefix=''):
    access_prefix = f'{prefix}access_grants__'
    return (
        Q(**{f'{access_prefix}student': user})
        & Q(**{f'{access_prefix}is_active': True})
        & Q(**{f'{access_prefix}activated_by__isnull': False})
        & Q(**{f'{access_prefix}payment_status': ModuleAccess.PaymentStatus.PAID})
        & Q(**{f'{access_prefix}expires_at__gt': timezone.now()})
    )


def module_enrollment_filter(user, prefix=''):
    primary_subject_path = f'{prefix}subject'
    legacy_subject_path = f'{prefix}subjects'
    return (
        (
            Q(**{f'{primary_subject_path}__schedules__students__student': user})
            & Q(**{f'{primary_subject_path}__schedules__students__is_active': True})
            & Q(**{f'{primary_subject_path}__schedules__is_active': True})
        )
        | (
            Q(**{f'{legacy_subject_path}__schedules__students__student': user})
            & Q(**{f'{legacy_subject_path}__schedules__students__is_active': True})
            & Q(**{f'{legacy_subject_path}__schedules__is_active': True})
        )
    )

def user_has_module_access(user, module):
    return ModuleAccess.objects.filter(
        module=module,
        student=user,
        is_active=True,
        activated_by__isnull=False,
        payment_status=ModuleAccess.PaymentStatus.PAID,
        expires_at__gt=timezone.now(),
    ).exists()


def user_has_module_class_access(user, module):
    subjects = list(module.subjects.all())
    if module.subject and all(
        subject.id != module.subject_id
        for subject in subjects
    ):
        subjects.append(module.subject)

    if not subjects:
        return False

    return any(
        subject.schedules.filter(
            is_active=True,
            students__student=user,
            students__is_active=True,
        ).exists()
        for subject in subjects
    )


def add_calendar_months(value, months):
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


MODULE_PDF_CONTENT_FIELDS = (
    'title',
    'slug',
    'subject_id',
    'description',
    'content',
    'learning_objectives',
    'lesson_overview',
    'detailed_discussion',
    'examples',
    'student_activities',
    'resources',
)

LESSON_PDF_CONTENT_FIELDS = (
    'topic_id',
    'title',
    'order',
    'learning_targets',
    'before_you_start',
    'short_discussion',
    'guided_examples',
    'lets_practice',
    'challenge_task',
    'objectives',
    'overview',
    'student_activities',
    'resources',
    'assessment_url',
)


def module_pdf_content_changed(module, previous):
    return any(getattr(module, field) != previous[field] for field in MODULE_PDF_CONTENT_FIELDS)


def lesson_pdf_content_changed(lesson, previous):
    return any(getattr(lesson, field) != previous[field] for field in LESSON_PDF_CONTENT_FIELDS)


def mark_module_pdf_outdated(module):
    if module and module.pdf_generated_at and not module.pdf_is_outdated:
        Module.objects.filter(pk=module.pk).update(pdf_is_outdated=True)


def mark_lesson_pdf_outdated(lesson):
    if lesson and lesson.pdf_generated_at and not lesson.pdf_is_outdated:
        ModuleLesson.objects.filter(pk=lesson.pk).update(pdf_is_outdated=True)


def safe_generate_module_pdf(module):
    try:
        from .services.pdf_generation import generate_module_pdf

        generate_module_pdf(module)
    except Exception:
        # Publishing should not fail just because the optional PDF renderer is
        # unavailable. Manual regeneration reports generation errors directly.
        return


def safe_generate_lesson_pdf(lesson):
    try:
        from .services.pdf_generation import generate_lesson_pdf

        generate_lesson_pdf(lesson)
    except Exception:
        # Publishing should not fail just because the optional PDF renderer is
        # unavailable. Manual regeneration reports generation errors directly.
        return


class ModuleLessonExample(models.Model):
    lesson = models.ForeignKey(
        ModuleLesson,
        on_delete=models.CASCADE,
        related_name='lesson_examples',
    )
    order = models.PositiveIntegerField(default=0)
    title = models.CharField(max_length=180)
    image = models.FileField(
        upload_to='module_lesson_examples/',
        blank=True,
        validators=[
            FileExtensionValidator(
                allowed_extensions=['png', 'jpg', 'jpeg', 'webp', 'svg'],
            ),
        ],
    )
    alt_text = models.CharField(max_length=240, blank=True)
    body = models.TextField(blank=True)
    common_mistake = models.TextField(blank=True)
    is_published = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['lesson', 'order', 'id']

    def __str__(self):
        return f'{self.lesson}: {self.title}'

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        mark_lesson_pdf_outdated(self.lesson)
        mark_module_pdf_outdated(self.lesson.topic.module)

    def delete(self, *args, **kwargs):
        lesson = self.lesson
        module = lesson.topic.module
        result = super().delete(*args, **kwargs)
        mark_lesson_pdf_outdated(lesson)
        mark_module_pdf_outdated(module)
        return result


class ModuleLessonAsset(models.Model):
    lesson = models.ForeignKey(
        ModuleLesson,
        on_delete=models.CASCADE,
        related_name='lesson_assets',
    )
    file = models.FileField(
        upload_to='module_lesson_assets/',
        validators=[
            FileExtensionValidator(
                allowed_extensions=['png', 'jpg', 'jpeg', 'webp', 'svg'],
            ),
        ],
    )
    original_name = models.CharField(max_length=255)
    alt_text = models.CharField(max_length=240, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['lesson', '-created_at', 'id']

    def __str__(self):
        return f'{self.lesson}: {self.original_name}'

    def save(self, *args, **kwargs):
        if self.file and not self.original_name:
            self.original_name = self.file.name.rsplit('/', 1)[-1]
        super().save(*args, **kwargs)
        mark_lesson_pdf_outdated(self.lesson)
        mark_module_pdf_outdated(self.lesson.topic.module)

    def delete(self, *args, **kwargs):
        lesson = self.lesson
        module = lesson.topic.module
        result = super().delete(*args, **kwargs)
        mark_lesson_pdf_outdated(lesson)
        mark_module_pdf_outdated(module)
        return result


class ModuleActivity(models.Model):
    class ActivityType(models.TextChoices):
        TEXT = 'TEXT', 'Text'
        FILE_UPLOAD = 'FILE_UPLOAD', 'File Upload'
        CODE_COMPLETE = 'CODE_COMPLETE', 'Complete Coding'
        CODE_FILL_BLANK = 'CODE_FILL_BLANK', 'Fill in the Blank Coding'
        INTERACTIVE = 'INTERACTIVE', 'Interactive'

    module = models.ForeignKey(
        Module,
        on_delete=models.CASCADE,
        related_name='activities',
    )
    topic = models.ForeignKey(
        ModuleTopic,
        on_delete=models.SET_NULL,
        related_name='activities',
        null=True,
        blank=True,
    )
    lesson = models.OneToOneField(
        ModuleLesson,
        on_delete=models.CASCADE,
        related_name='main_activity',
        null=True,
        blank=True,
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
    max_attempts = models.PositiveSmallIntegerField(default=3)
    passing_score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['module', 'order', 'id']
        verbose_name_plural = 'module activities'
        indexes = [models.Index(fields=['module', 'is_published', 'due_at'], name='activity_module_due_idx')]

    def __str__(self):
        return f'{self.module}: {self.title}'

    def save(self, *args, **kwargs):
        if self.lesson_id:
            self.topic = self.lesson.topic
            self.module = self.lesson.topic.module
            self.activity_type = self.ActivityType.INTERACTIVE
            self.accepts_text = False
            self.accepts_file = False
            self.accepts_code = False
        super().save(*args, **kwargs)
        mark_module_pdf_outdated(self.module)

    def delete(self, *args, **kwargs):
        module = self.module
        result = super().delete(*args, **kwargs)
        mark_module_pdf_outdated(module)
        return result


class ModuleActivityQuestion(models.Model):
    class QuestionType(models.TextChoices):
        MULTIPLE_CHOICE = 'multiple_choice', 'Multiple Choice'
        TRUE_FALSE = 'true_false', 'True/False'
        FILL_BLANK = 'fill_blank', 'Fill Blank'
        ORDERING = 'ordering', 'Ordering'
        MATCHING = 'matching', 'Matching'
        CODE_OUTPUT = 'code_output', 'Code Output'

    activity = models.ForeignKey(
        ModuleActivity,
        on_delete=models.CASCADE,
        related_name='questions',
    )
    question_type = models.CharField(max_length=30, choices=QuestionType)
    prompt = models.TextField()
    points = models.DecimalField(max_digits=6, decimal_places=2, default=1)
    order = models.PositiveIntegerField(default=0)
    explanation = models.TextField(blank=True)
    correct_text_answers = models.JSONField(default=list, blank=True)
    case_sensitive = models.BooleanField(default=False)
    code_snippet = models.TextField(blank=True)
    expected_output = models.TextField(blank=True)
    is_published = models.BooleanField(default=True)

    class Meta:
        ordering = ['activity', 'order', 'id']

    def __str__(self):
        return f'{self.activity}: Question {self.order}'


class ModuleActivityQuestionChoice(models.Model):
    question = models.ForeignKey(
        ModuleActivityQuestion,
        on_delete=models.CASCADE,
        related_name='choices',
    )
    text = models.CharField(max_length=500)
    is_correct = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['question', 'order', 'id']

    def __str__(self):
        return self.text


class ModuleActivityMatchingPair(models.Model):
    question = models.ForeignKey(
        ModuleActivityQuestion,
        on_delete=models.CASCADE,
        related_name='matching_pairs',
    )
    left_text = models.CharField(max_length=500)
    right_text = models.CharField(max_length=500)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['question', 'order', 'id']

    def __str__(self):
        return f'{self.left_text} -> {self.right_text}'


class ModuleActivityAttempt(models.Model):
    class SubmissionMethod(models.TextChoices):
        ONLINE = 'ONLINE', 'Online'
        PAPER = 'PAPER', 'Paper'

    activity = models.ForeignKey(
        ModuleActivity,
        on_delete=models.CASCADE,
        related_name='attempts',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='module_activity_attempts',
    )
    submission_method = models.CharField(
        max_length=20,
        choices=SubmissionMethod,
        default=SubmissionMethod.ONLINE,
    )
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='recorded_module_activity_attempts',
        null=True,
        blank=True,
    )
    paper_grade_item = models.ForeignKey(
        'grades.GradeItem',
        on_delete=models.SET_NULL,
        related_name='paper_activity_attempts',
        null=True,
        blank=True,
    )
    attempt_number = models.PositiveSmallIntegerField(default=1)
    score = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    max_score = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    is_submitted = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['activity', 'student', 'attempt_number'],
                name='unique_module_activity_attempt_number',
            ),
            models.UniqueConstraint(
                fields=['paper_grade_item', 'student'],
                condition=Q(paper_grade_item__isnull=False),
                name='unique_paper_activity_attempt_per_grade_item_student',
            ),
        ]
        ordering = ['-started_at']

    def __str__(self):
        return f'{self.student} - {self.activity} attempt {self.attempt_number}'


class ModuleActivityAnswer(models.Model):
    attempt = models.ForeignKey(
        ModuleActivityAttempt,
        on_delete=models.CASCADE,
        related_name='answers',
    )
    question = models.ForeignKey(
        ModuleActivityQuestion,
        on_delete=models.CASCADE,
        related_name='answers',
    )
    selected_choice = models.ForeignKey(
        ModuleActivityQuestionChoice,
        on_delete=models.SET_NULL,
        related_name='answers',
        null=True,
        blank=True,
    )
    text_answer = models.TextField(blank=True)
    choice_order = models.JSONField(default=list, blank=True)
    matching_answer = models.JSONField(default=dict, blank=True)
    is_correct = models.BooleanField(null=True, blank=True)
    points_earned = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    feedback = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['attempt', 'question'],
                name='unique_module_activity_answer_per_question',
            ),
        ]
        ordering = ['question__order', 'question__id']

    def __str__(self):
        return f'{self.attempt} - {self.question}'


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


class ModuleTopicProgress(models.Model):
    topic = models.ForeignKey(
        ModuleTopic,
        on_delete=models.CASCADE,
        related_name='progress',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='module_topic_progress',
    )
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['topic', 'student'],
                name='unique_module_topic_progress',
            ),
        ]
        ordering = ['-started_at']
        verbose_name_plural = 'module topic progress'

    def __str__(self):
        return f'{self.student} - {self.topic}'


class ModuleLessonProgress(models.Model):
    lesson = models.ForeignKey(
        ModuleLesson,
        on_delete=models.CASCADE,
        related_name='progress',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='module_lesson_progress',
    )
    started_at = models.DateTimeField(auto_now_add=True)
    last_viewed_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['lesson', 'student'],
                name='unique_module_lesson_progress',
            ),
        ]
        ordering = ['-last_viewed_at']
        verbose_name_plural = 'module lesson progress'

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        sync_learning_progress(self.student, self.lesson.topic)

    def delete(self, *args, **kwargs):
        student = self.student
        topic = self.lesson.topic
        result = super().delete(*args, **kwargs)
        sync_learning_progress(student, topic)
        return result

    def __str__(self):
        return f'{self.student} - {self.lesson}'


def sync_learning_progress(student, topic):
    published_lessons = topic.lessons.filter(is_published=True)
    completed_lesson_ids = ModuleLessonProgress.objects.filter(
        student=student,
        lesson__topic=topic,
        lesson__is_published=True,
        completed_at__isnull=False,
    ).values_list('lesson_id', flat=True)
    topic_is_complete = (
        published_lessons.exists()
        and not published_lessons.exclude(id__in=completed_lesson_ids).exists()
    )
    topic_progress, _ = ModuleTopicProgress.objects.get_or_create(
        student=student,
        topic=topic,
    )
    topic_completed_at = (
        topic_progress.completed_at or timezone.now()
        if topic_is_complete
        else None
    )
    if topic_progress.completed_at != topic_completed_at:
        topic_progress.completed_at = topic_completed_at
        topic_progress.save(update_fields=['completed_at'])

    sync_module_progress(student, topic.module)


def sync_module_progress(student, module):
    published_module_lessons = ModuleLesson.objects.filter(
        topic__module=module,
        topic__is_published=True,
        is_published=True,
    )
    completed_module_lesson_ids = ModuleLessonProgress.objects.filter(
        student=student,
        lesson__topic__module=module,
        lesson__topic__is_published=True,
        lesson__is_published=True,
        completed_at__isnull=False,
    ).values_list('lesson_id', flat=True)
    module_is_complete = (
        published_module_lessons.exists()
        and not published_module_lessons.exclude(
            id__in=completed_module_lesson_ids,
        ).exists()
    )
    module_progress, _ = ModuleProgress.objects.get_or_create(
        student=student,
        module=module,
    )
    module_completed_at = (
        module_progress.completed_at or timezone.now()
        if module_is_complete
        else None
    )
    if module_progress.completed_at != module_completed_at:
        module_progress.completed_at = module_completed_at
        module_progress.save(update_fields=['completed_at'])


def progress_student_ids_for_topic(topic):
    return set(
        ModuleLessonProgress.objects.filter(
            lesson__topic=topic,
        ).values_list('student_id', flat=True)
    ) | set(
        ModuleTopicProgress.objects.filter(
            topic=topic,
        ).values_list('student_id', flat=True)
    ) | set(
        ModuleProgress.objects.filter(
            module=topic.module,
        ).values_list('student_id', flat=True)
    )


def progress_student_ids_for_module(module):
    return set(
        ModuleLessonProgress.objects.filter(
            lesson__topic__module=module,
        ).values_list('student_id', flat=True)
    ) | set(
        ModuleTopicProgress.objects.filter(
            topic__module=module,
        ).values_list('student_id', flat=True)
    ) | set(
        ModuleProgress.objects.filter(
            module=module,
        ).values_list('student_id', flat=True)
    )


def sync_progress_for_topic_students(topic, student_ids=None):
    student_ids = (
        progress_student_ids_for_topic(topic)
        if student_ids is None
        else set(student_ids)
    )
    student_model = ModuleLessonProgress._meta.get_field(
        'student',
    ).remote_field.model
    for student in student_model.objects.filter(id__in=student_ids):
        sync_learning_progress(student, topic)


def sync_module_progress_for_students(module, student_ids=None):
    student_ids = (
        progress_student_ids_for_module(module)
        if student_ids is None
        else set(student_ids)
    )
    student_model = ModuleLessonProgress._meta.get_field(
        'student',
    ).remote_field.model
    for student in student_model.objects.filter(id__in=student_ids):
        sync_module_progress(student, module)


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
        indexes = [models.Index(fields=['student', 'score'], name='submission_student_score_idx')]

    def __str__(self):
        return f'{self.student} - {self.activity}'
