import calendar

from django.conf import settings
from django.core.validators import FileExtensionValidator, MinValueValidator
from django.db import models, transaction
from django.db.models import Q
from django.db.models.signals import m2m_changed
from django.dispatch import receiver
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
            ).first()

        super().save(*args, **kwargs)

        if previous and any(
            getattr(self, field) != previous[field]
            for field in ('title', 'slug', 'subject_id')
        ):
            mark_module_topic_pdfs_outdated(self)

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
    pdf_file = models.FileField(upload_to='module_topic_pdfs/', blank=True)
    pdf_generated_at = models.DateTimeField(null=True, blank=True)
    pdf_is_outdated = models.BooleanField(default=True)
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
        is_new = self.pk is None
        previous = None
        if self.pk:
            previous = ModuleTopic.objects.filter(pk=self.pk).values(
                'module_id',
                'title',
                'order',
                'competency_code',
                'competency_text',
                'unit',
                'overview',
                'essential_question',
                'enduring_understanding',
                'performance_task',
                'success_criteria',
                'values_focus',
                'pdf_file',
                'pdf_generated_at',
                'is_published',
            ).first()

        if previous and previous['pdf_generated_at'] and topic_pdf_content_changed(
            self,
            previous,
        ):
            self.pdf_is_outdated = True

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
            sync_module_progress_for_students(self.module)

        if (
            self.is_published
            and not self.pdf_file
            and (is_new or not previous or not previous['is_published'])
        ):
            transaction.on_commit(
                lambda: safe_generate_topic_pdf(self),
                using=self._state.db,
            )

    def delete(self, *args, **kwargs):
        module = self.module
        student_ids = progress_student_ids_for_module(module)
        result = super().delete(*args, **kwargs)
        sync_module_progress_for_students(module, student_ids=student_ids)
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
            ).first()
            if previous:
                previous_is_published = previous['is_published']
                if previous['topic_id'] != self.topic_id:
                    previous_topic = ModuleTopic.objects.filter(
                        pk=previous['topic_id'],
                    ).first()

        super().save(*args, **kwargs)

        if previous_topic:
            sync_progress_for_topic_students(previous_topic)
            mark_topic_pdf_outdated(previous_topic)
        mark_topic_pdf_outdated(self.topic)
        if (is_new and self.is_published) or previous_topic or (
            previous_is_published is not None
            and previous_is_published != self.is_published
        ):
            sync_progress_for_topic_students(self.topic)

    def delete(self, *args, **kwargs):
        topic = self.topic
        student_ids = progress_student_ids_for_topic(topic)
        result = super().delete(*args, **kwargs)
        sync_progress_for_topic_students(topic, student_ids=student_ids)
        mark_topic_pdf_outdated(topic)
        return result


class ModuleAccess(models.Model):
    class AccessType(models.TextChoices):
        ENROLLED = 'ENROLLED', 'Enrolled Module'
        ADVANCE_STUDY = 'ADVANCE_STUDY', 'Advance Study'

    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        EXPIRED = 'EXPIRED', 'Expired'
        REVOKED = 'REVOKED', 'Revoked'

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
        default=AccessType.ENROLLED,
    )
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
        indexes = [
            models.Index(
                fields=['student', 'module', 'expires_at'],
                condition=Q(is_active=True, activated_by__isnull=False),
                name='modaccess_active_student_idx',
            ),
        ]

    @property
    def status(self):
        if not self.is_active or not self.activated_by_id:
            return self.Status.REVOKED
        if not self.expires_at or self.expires_at <= timezone.now():
            return self.Status.EXPIRED
        return self.Status.ACTIVE

    @property
    def is_available(self):
        return self.status == self.Status.ACTIVE

    def clean(self):
        super().clean()

        if self.student_id and getattr(self.student, 'role', None) != self.student.Role.STUDENT:
            from django.core.exceptions import ValidationError

            raise ValidationError('Only student users can receive module access.')

        if self.is_active and not self.activated_by_id:
            from django.core.exceptions import ValidationError

            raise ValidationError('Active module access must identify the teacher who activated it.')

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


TOPIC_PDF_CONTENT_FIELDS = (
    'module_id',
    'title',
    'order',
    'competency_code',
    'competency_text',
    'unit',
    'overview',
    'essential_question',
    'enduring_understanding',
    'performance_task',
    'success_criteria',
    'values_focus',
)


def topic_pdf_content_changed(topic, previous):
    return any(getattr(topic, field) != previous[field] for field in TOPIC_PDF_CONTENT_FIELDS)


def mark_topic_pdf_outdated(topic):
    if topic:
        ModuleTopic.objects.filter(
            pk=topic.pk,
            pdf_generated_at__isnull=False,
            pdf_is_outdated=False,
        ).update(pdf_is_outdated=True)


def mark_module_topic_pdfs_outdated(module):
    ModuleTopic.objects.filter(
        module=module,
        pdf_generated_at__isnull=False,
        pdf_is_outdated=False,
    ).update(pdf_is_outdated=True)


@receiver(m2m_changed, sender=Module.subjects.through)
def mark_module_topics_outdated_after_subject_change(
    sender,
    instance,
    action,
    **kwargs,
):
    if action in {'post_add', 'post_remove', 'post_clear'}:
        mark_module_topic_pdfs_outdated(instance)


def mark_lesson_topic_pdf_outdated(lesson):
    mark_topic_pdf_outdated(lesson.topic)


def mark_activity_printables_outdated(activity):
    if activity.lesson_id:
        mark_lesson_topic_pdf_outdated(activity.lesson)
    elif activity.topic_id:
        mark_topic_pdf_outdated(activity.topic)


def safe_generate_topic_pdf(topic):
    try:
        from .services.pdf_generation import generate_topic_pdf

        generate_topic_pdf(topic)
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
        mark_lesson_topic_pdf_outdated(self.lesson)

    def delete(self, *args, **kwargs):
        lesson = self.lesson
        result = super().delete(*args, **kwargs)
        mark_lesson_topic_pdf_outdated(lesson)
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
        mark_lesson_topic_pdf_outdated(self.lesson)

    def delete(self, *args, **kwargs):
        lesson = self.lesson
        result = super().delete(*args, **kwargs)
        mark_lesson_topic_pdf_outdated(lesson)
        return result


class ModuleActivity(models.Model):
    class GradingPeriod(models.TextChoices):
        PRELIM = 'PRELIM', 'Prelim'
        MIDTERM = 'MIDTERM', 'Midterm'
        PREFINAL = 'PREFINAL', 'Prefinal'
        FINAL = 'FINAL', 'Final'

    class ActivityType(models.TextChoices):
        TEXT = 'TEXT', 'Text'
        FILE_UPLOAD = 'FILE_UPLOAD', 'File Upload'
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
    title = models.CharField(max_length=180)
    instructions = models.TextField()
    activity_type = models.CharField(
        max_length=30,
        choices=ActivityType,
        default=ActivityType.TEXT,
    )
    order = models.PositiveIntegerField(default=0)
    points_possible = models.DecimalField(max_digits=6, decimal_places=2, default=100)
    opens_at = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    allow_late_submissions = models.BooleanField(default=False)
    accepts_text = models.BooleanField(default=True)
    accepts_file = models.BooleanField(default=False)
    max_attempts = models.PositiveSmallIntegerField(
        default=3,
        validators=[MinValueValidator(1)],
    )
    passing_score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    grading_period = models.CharField(
        max_length=20,
        choices=GradingPeriod,
        null=True,
        blank=True,
    )
    is_published = models.BooleanField(default=False)
    revision = models.PositiveIntegerField(default=1)
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
            # Lesson Main Activities are governed by class/module access. The
            # legacy global window cannot represent different linked classes.
            self.opens_at = None
            self.due_at = None
            self.allow_late_submissions = False
        super().save(*args, **kwargs)
        if self.lesson_id:
            mark_lesson_topic_pdf_outdated(self.lesson)
        elif self.topic_id:
            mark_topic_pdf_outdated(self.topic)

    def delete(self, *args, **kwargs):
        lesson = self.lesson
        topic = self.topic
        result = super().delete(*args, **kwargs)
        if lesson:
            mark_lesson_topic_pdf_outdated(lesson)
        elif topic:
            mark_topic_pdf_outdated(topic)
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

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        mark_activity_printables_outdated(self.activity)

    def delete(self, *args, **kwargs):
        activity = self.activity
        result = super().delete(*args, **kwargs)
        mark_activity_printables_outdated(activity)
        return result


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

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        mark_activity_printables_outdated(self.question.activity)

    def delete(self, *args, **kwargs):
        activity = self.question.activity
        result = super().delete(*args, **kwargs)
        mark_activity_printables_outdated(activity)
        return result


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

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        mark_activity_printables_outdated(self.question.activity)

    def delete(self, *args, **kwargs):
        activity = self.question.activity
        result = super().delete(*args, **kwargs)
        mark_activity_printables_outdated(activity)
        return result


class LearningContextType(models.TextChoices):
    CLASS = 'CLASS', 'Class'
    PERSONAL = 'PERSONAL', 'Personal study'
    LEGACY = 'LEGACY', 'Legacy history'


class ModuleActivityAttempt(models.Model):
    class SubmissionMethod(models.TextChoices):
        ONLINE = 'ONLINE', 'Online'
        PAPER = 'PAPER', 'Paper'

    class Status(models.TextChoices):
        IN_PROGRESS = 'IN_PROGRESS', 'In progress'
        SUBMITTED = 'SUBMITTED', 'Submitted'
        SUPERSEDED = 'SUPERSEDED', 'Superseded'

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
    schedule = models.ForeignKey(
        'subjects.SubjectSchedule',
        on_delete=models.PROTECT,
        related_name='module_activity_attempts',
        null=True,
        blank=True,
    )
    context_type = models.CharField(
        max_length=20,
        choices=LearningContextType,
        default=LearningContextType.LEGACY,
    )
    attempt_number = models.PositiveSmallIntegerField(default=1)
    status = models.CharField(
        max_length=20,
        choices=Status,
        default=Status.IN_PROGRESS,
    )
    score = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    max_score = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    activity_revision = models.PositiveIntegerField(default=1)
    passing_score_snapshot = models.DecimalField(
        max_digits=7,
        decimal_places=2,
        null=True,
        blank=True,
    )
    question_snapshot = models.JSONField(default=list, blank=True)
    draft_answers = models.JSONField(default=dict, blank=True)
    draft_revision = models.PositiveIntegerField(default=0)
    draft_saved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['activity', 'student', 'schedule', 'attempt_number'],
                condition=Q(context_type=LearningContextType.CLASS),
                name='unique_class_activity_attempt_number',
            ),
            models.UniqueConstraint(
                fields=['activity', 'student', 'attempt_number'],
                condition=Q(context_type=LearningContextType.PERSONAL),
                name='unique_personal_activity_attempt_number',
            ),
            models.UniqueConstraint(
                fields=['activity', 'student', 'attempt_number'],
                condition=Q(context_type=LearningContextType.LEGACY),
                name='unique_legacy_activity_attempt_number',
            ),
            models.UniqueConstraint(
                fields=['paper_grade_item', 'student'],
                condition=Q(paper_grade_item__isnull=False),
                name='unique_paper_activity_attempt_per_grade_item_student',
            ),
            models.UniqueConstraint(
                fields=['activity', 'student', 'schedule'],
                condition=Q(
                    context_type=LearningContextType.CLASS,
                    submission_method='ONLINE',
                    status='IN_PROGRESS',
                ),
                name='unique_open_class_activity_attempt',
            ),
            models.UniqueConstraint(
                fields=['activity', 'student'],
                condition=Q(
                    context_type=LearningContextType.PERSONAL,
                    submission_method='ONLINE',
                    status='IN_PROGRESS',
                ),
                name='unique_open_personal_activity_attempt',
            ),
            models.CheckConstraint(
                condition=(
                    Q(context_type=LearningContextType.CLASS, schedule__isnull=False)
                    | Q(
                        context_type__in=(
                            LearningContextType.PERSONAL,
                            LearningContextType.LEGACY,
                        ),
                        schedule__isnull=True,
                    )
                ),
                name='activity_attempt_valid_learning_context',
            ),
        ]
        ordering = ['-started_at']
        indexes = [
            models.Index(
                fields=['activity', 'schedule', 'student'],
                condition=Q(
                    context_type='CLASS',
                    submission_method='ONLINE',
                    status='SUBMITTED',
                ),
                name='attempt_submitted_class_idx',
            ),
        ]

    def __str__(self):
        return f'{self.student} - {self.activity} attempt {self.attempt_number}'

    @property
    def is_submitted(self):
        """Compatibility accessor; status is the only persisted lifecycle field."""
        return self.status == self.Status.SUBMITTED

    def save(self, *args, **kwargs):
        if not self.activity_revision and self.activity_id:
            self.activity_revision = self.activity.revision
        if self._state.adding and self.activity_id:
            self.activity_revision = self.activity.revision
            self.passing_score_snapshot = self.activity.passing_score
        super().save(*args, **kwargs)


class ModuleActivityExtension(models.Model):
    activity = models.ForeignKey(
        ModuleActivity,
        on_delete=models.CASCADE,
        related_name='extensions',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='module_activity_extensions',
    )
    due_at = models.DateTimeField()
    granted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='granted_module_activity_extensions',
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['activity', 'student'],
                name='unique_module_activity_extension_student',
            ),
        ]
        ordering = ['due_at', 'student_id']

    def __str__(self):
        return f'{self.activity} extension for {self.student}'


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
    schedule = models.ForeignKey(
        'subjects.SubjectSchedule',
        on_delete=models.PROTECT,
        related_name='module_progress',
        null=True,
        blank=True,
    )
    context_type = models.CharField(
        max_length=20,
        choices=LearningContextType,
        default=LearningContextType.LEGACY,
    )
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['module', 'student', 'schedule'],
                condition=Q(context_type=LearningContextType.CLASS),
                name='unique_class_module_progress',
            ),
            models.UniqueConstraint(
                fields=['module', 'student'],
                condition=Q(context_type=LearningContextType.PERSONAL),
                name='unique_personal_module_progress',
            ),
            models.UniqueConstraint(
                fields=['module', 'student'],
                condition=Q(context_type=LearningContextType.LEGACY),
                name='unique_legacy_module_progress',
            ),
            models.CheckConstraint(
                condition=(
                    Q(context_type=LearningContextType.CLASS, schedule__isnull=False)
                    | Q(
                        context_type__in=(
                            LearningContextType.PERSONAL,
                            LearningContextType.LEGACY,
                        ),
                        schedule__isnull=True,
                    )
                ),
                name='module_progress_valid_learning_context',
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
    schedule = models.ForeignKey(
        'subjects.SubjectSchedule',
        on_delete=models.PROTECT,
        related_name='module_topic_progress',
        null=True,
        blank=True,
    )
    context_type = models.CharField(
        max_length=20,
        choices=LearningContextType,
        default=LearningContextType.LEGACY,
    )
    started_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['topic', 'student', 'schedule'],
                condition=Q(context_type=LearningContextType.CLASS),
                name='unique_class_topic_progress',
            ),
            models.UniqueConstraint(
                fields=['topic', 'student'],
                condition=Q(context_type=LearningContextType.PERSONAL),
                name='unique_personal_topic_progress',
            ),
            models.UniqueConstraint(
                fields=['topic', 'student'],
                condition=Q(context_type=LearningContextType.LEGACY),
                name='unique_legacy_topic_progress',
            ),
            models.CheckConstraint(
                condition=(
                    Q(context_type=LearningContextType.CLASS, schedule__isnull=False)
                    | Q(
                        context_type__in=(
                            LearningContextType.PERSONAL,
                            LearningContextType.LEGACY,
                        ),
                        schedule__isnull=True,
                    )
                ),
                name='topic_progress_valid_learning_context',
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
    schedule = models.ForeignKey(
        'subjects.SubjectSchedule',
        on_delete=models.PROTECT,
        related_name='module_lesson_progress',
        null=True,
        blank=True,
    )
    context_type = models.CharField(
        max_length=20,
        choices=LearningContextType,
        default=LearningContextType.LEGACY,
    )
    started_at = models.DateTimeField(auto_now_add=True)
    last_viewed_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['lesson', 'student', 'schedule'],
                condition=Q(context_type=LearningContextType.CLASS),
                name='unique_class_lesson_progress',
            ),
            models.UniqueConstraint(
                fields=['lesson', 'student'],
                condition=Q(context_type=LearningContextType.PERSONAL),
                name='unique_personal_lesson_progress',
            ),
            models.UniqueConstraint(
                fields=['lesson', 'student'],
                condition=Q(context_type=LearningContextType.LEGACY),
                name='unique_legacy_lesson_progress',
            ),
            models.CheckConstraint(
                condition=(
                    Q(context_type=LearningContextType.CLASS, schedule__isnull=False)
                    | Q(
                        context_type__in=(
                            LearningContextType.PERSONAL,
                            LearningContextType.LEGACY,
                        ),
                        schedule__isnull=True,
                    )
                ),
                name='lesson_progress_valid_learning_context',
            ),
        ]
        ordering = ['-last_viewed_at']
        verbose_name_plural = 'module lesson progress'

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        sync_learning_progress(
            self.student,
            self.lesson.topic,
            self.context_type,
            self.schedule,
        )

    def delete(self, *args, **kwargs):
        student = self.student
        topic = self.lesson.topic
        context_type = self.context_type
        schedule = self.schedule
        result = super().delete(*args, **kwargs)
        sync_learning_progress(student, topic, context_type, schedule)
        return result

    def __str__(self):
        return f'{self.student} - {self.lesson}'


def learning_context_filter(context_type, schedule):
    schedule_id = getattr(schedule, 'pk', schedule)
    return {
        'context_type': context_type,
        'schedule_id': schedule_id if context_type == LearningContextType.CLASS else None,
    }


def sync_learning_progress(student, topic, context_type, schedule=None):
    context = learning_context_filter(context_type, schedule)
    published_lessons = topic.lessons.filter(is_published=True)
    completed_lesson_ids = ModuleLessonProgress.objects.filter(
        student=student,
        lesson__topic=topic,
        lesson__is_published=True,
        completed_at__isnull=False,
        **context,
    ).values_list('lesson_id', flat=True)
    topic_is_complete = (
        published_lessons.exists()
        and not published_lessons.exclude(id__in=completed_lesson_ids).exists()
    )
    topic_progress, _ = ModuleTopicProgress.objects.get_or_create(
        student=student,
        topic=topic,
        **context,
    )
    topic_completed_at = (
        topic_progress.completed_at or timezone.now()
        if topic_is_complete
        else None
    )
    if topic_progress.completed_at != topic_completed_at:
        topic_progress.completed_at = topic_completed_at
        topic_progress.save(update_fields=['completed_at'])

    sync_module_progress(student, topic.module, context_type, schedule)


def sync_module_progress(student, module, context_type, schedule=None):
    context = learning_context_filter(context_type, schedule)
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
        **context,
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
        **context,
    )
    module_completed_at = (
        module_progress.completed_at or timezone.now()
        if module_is_complete
        else None
    )
    if module_progress.completed_at != module_completed_at:
        module_progress.completed_at = module_completed_at
        module_progress.save(update_fields=['completed_at'])


def progress_contexts_for_topic(topic):
    return set(
        ModuleLessonProgress.objects.filter(
            lesson__topic=topic,
        ).values_list('student_id', 'context_type', 'schedule_id')
    ) | set(
        ModuleTopicProgress.objects.filter(
            topic=topic,
        ).values_list('student_id', 'context_type', 'schedule_id')
    ) | set(
        ModuleProgress.objects.filter(
            module=topic.module,
        ).values_list('student_id', 'context_type', 'schedule_id')
    )


def progress_contexts_for_module(module):
    return set(
        ModuleLessonProgress.objects.filter(
            lesson__topic__module=module,
        ).values_list('student_id', 'context_type', 'schedule_id')
    ) | set(
        ModuleTopicProgress.objects.filter(
            topic__module=module,
        ).values_list('student_id', 'context_type', 'schedule_id')
    ) | set(
        ModuleProgress.objects.filter(
            module=module,
        ).values_list('student_id', 'context_type', 'schedule_id')
    )


def sync_progress_for_topic_students(topic, student_ids=None):
    contexts = progress_contexts_for_topic(topic)
    if student_ids is not None:
        student_ids = set(student_ids)
        contexts = {context for context in contexts if context[0] in student_ids}
    student_model = ModuleLessonProgress._meta.get_field(
        'student',
    ).remote_field.model
    students = student_model.objects.in_bulk(context[0] for context in contexts)
    for student_id, context_type, schedule_id in contexts:
        student = students.get(student_id)
        if student:
            sync_learning_progress(student, topic, context_type, schedule_id)


def sync_module_progress_for_students(module, student_ids=None):
    contexts = progress_contexts_for_module(module)
    if student_ids is not None:
        student_ids = set(student_ids)
        contexts = {context for context in contexts if context[0] in student_ids}
    student_model = ModuleLessonProgress._meta.get_field(
        'student',
    ).remote_field.model
    students = student_model.objects.in_bulk(context[0] for context in contexts)
    for student_id, context_type, schedule_id in contexts:
        student = students.get(student_id)
        if student:
            sync_module_progress(student, module, context_type, schedule_id)


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
