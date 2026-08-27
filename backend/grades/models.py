from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import Q


def transmute_score(raw_score, total_score, base=60, scale=40):
    if raw_score is None or total_score in (None, 0):
        return None

    return (raw_score / total_score) * scale + base


class GradeCompletionStatus(models.TextChoices):
    PENDING = 'PENDING', 'Pending'
    COMPLETE = 'COMPLETE', 'Complete'
    NOT_APPLICABLE = 'NOT_APPLICABLE', 'Not applicable'


class GradingPeriod(models.TextChoices):
    PRELIM = 'PRELIM', 'Prelim'
    MIDTERM = 'MIDTERM', 'Midterm'
    PREFINAL = 'PREFINAL', 'Prefinal'
    FINAL = 'FINAL', 'Final'


class GradeCategoryChoices(models.TextChoices):
    QUIZ = 'QUIZ', 'Quiz'
    EXAM = 'EXAM', 'Exam'
    ACTIVITY = 'ACTIVITY', 'Activity'
    ATTENDANCE = 'ATTENDANCE', 'Attendance'
    OTHER = 'OTHER', 'Other'


class GradeItemSourceType(models.TextChoices):
    MANUAL = 'MANUAL', 'Manual'
    MODULE_ACTIVITY = 'MODULE_ACTIVITY', 'Module activity'
    ATTENDANCE = 'ATTENDANCE', 'Attendance'


class GradingTemplate(models.Model):
    name = models.CharField(max_length=120, unique=True)
    description = models.TextField(blank=True)
    is_default = models.BooleanField(default=False)
    transmutation_base = models.DecimalField(max_digits=6, decimal_places=2, default=60)
    transmutation_scale = models.DecimalField(max_digits=6, decimal_places=2, default=40)
    prelim_weight = models.DecimalField(max_digits=5, decimal_places=2, default=25)
    midterm_weight = models.DecimalField(max_digits=5, decimal_places=2, default=25)
    prefinal_weight = models.DecimalField(max_digits=5, decimal_places=2, default=25)
    final_weight = models.DecimalField(max_digits=5, decimal_places=2, default=25)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name

    def apply_to_subject(self, subject):
        created_categories = []

        for item in self.items.all():
            category, _ = GradeCategory.objects.update_or_create(
                subject=subject,
                grading_period=item.grading_period,
                category=item.category,
                name=item.name,
                defaults={
                    'weight': item.weight,
                    'template_item': item,
                },
            )
            created_categories.append(category)

        SubjectGradingPolicy.objects.update_or_create(
            subject=subject,
            defaults={
                'source_template': self,
                'transmutation_base': self.transmutation_base,
                'transmutation_scale': self.transmutation_scale,
                'prelim_weight': self.prelim_weight,
                'midterm_weight': self.midterm_weight,
                'prefinal_weight': self.prefinal_weight,
                'final_weight': self.final_weight,
            },
        )

        return created_categories

    def clean(self):
        super().clean()
        validate_policy_values(self)


def validate_policy_values(policy):
    weights = [policy.prelim_weight, policy.midterm_weight, policy.prefinal_weight, policy.final_weight]
    if any(weight < 0 for weight in weights) or sum(weights) != 100:
        raise ValidationError('Grading-period weights must be non-negative and total exactly 100%.')
    if (
        policy.transmutation_base < 0
        or policy.transmutation_scale <= 0
        or policy.transmutation_base + policy.transmutation_scale != 100
    ):
        raise ValidationError('Transmutation base and scale must be valid, non-negative, and total exactly 100.')


class SubjectGradingPolicy(models.Model):
    subject = models.OneToOneField(
        'subjects.Subject', on_delete=models.CASCADE, related_name='grading_policy'
    )
    source_template = models.ForeignKey(
        GradingTemplate, on_delete=models.SET_NULL, related_name='subject_policies', null=True, blank=True
    )
    transmutation_base = models.DecimalField(max_digits=6, decimal_places=2, default=60)
    transmutation_scale = models.DecimalField(max_digits=6, decimal_places=2, default=40)
    prelim_weight = models.DecimalField(max_digits=5, decimal_places=2, default=25)
    midterm_weight = models.DecimalField(max_digits=5, decimal_places=2, default=25)
    prefinal_weight = models.DecimalField(max_digits=5, decimal_places=2, default=25)
    final_weight = models.DecimalField(max_digits=5, decimal_places=2, default=25)
    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        super().clean()
        validate_policy_values(self)

    def period_weight(self, period):
        return {
            GradingPeriod.PRELIM: self.prelim_weight,
            GradingPeriod.MIDTERM: self.midterm_weight,
            GradingPeriod.PREFINAL: self.prefinal_weight,
            GradingPeriod.FINAL: self.final_weight,
        }[period]

    def __str__(self):
        return f'{self.subject} grading policy'


class GradingTemplateItem(models.Model):
    template = models.ForeignKey(
        GradingTemplate,
        on_delete=models.CASCADE,
        related_name='items',
    )
    grading_period = models.CharField(max_length=20, choices=GradingPeriod)
    category = models.CharField(max_length=20, choices=GradeCategoryChoices)
    name = models.CharField(max_length=80)
    weight = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        help_text='Percentage weight inside this grading period.',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['template', 'grading_period', 'category', 'name'],
                name='unique_template_period_category',
            ),
        ]
        ordering = ['template', 'grading_period', 'category']

    def __str__(self):
        return f'{self.template} - {self.get_grading_period_display()} - {self.name}'

    def clean(self):
        super().clean()
        items = GradingTemplateItem.objects.filter(
            template=self.template,
            grading_period=self.grading_period,
        ).exclude(pk=self.pk)
        total_weight = sum(item.weight for item in items) + self.weight

        if self.weight < 0:
            raise ValidationError('Template category weight cannot be negative.')
        if total_weight > 100:
            raise ValidationError('Template category weights for one grading period cannot exceed 100%.')


class GradeCategory(models.Model):
    subject = models.ForeignKey(
        'subjects.Subject',
        on_delete=models.CASCADE,
        related_name='grade_categories',
    )
    template_item = models.ForeignKey(
        GradingTemplateItem,
        on_delete=models.SET_NULL,
        related_name='subject_categories',
        null=True,
        blank=True,
    )
    grading_period = models.CharField(
        max_length=20,
        choices=GradingPeriod,
        default=GradingPeriod.PRELIM,
    )
    category = models.CharField(max_length=20, choices=GradeCategoryChoices)
    name = models.CharField(max_length=80)
    weight = models.DecimalField(
        max_digits=5,
        decimal_places=2,
        help_text='Percentage weight inside this grading period.',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['subject', 'grading_period', 'category', 'name'],
                name='unique_subject_period_grade_category',
            ),
        ]
        ordering = ['subject__code', 'grading_period', 'category']
        verbose_name_plural = 'grade categories'

    def __str__(self):
        return f'{self.subject} - {self.get_grading_period_display()} - {self.name} ({self.weight}%)'

    def clean(self):
        super().clean()
        categories = GradeCategory.objects.filter(
            subject=self.subject,
            grading_period=self.grading_period,
        ).exclude(pk=self.pk)
        total_weight = sum(category.weight for category in categories) + self.weight

        if self.weight < 0:
            raise ValidationError('Subject category weight cannot be negative.')
        if total_weight > 100:
            raise ValidationError('Subject category weights for one grading period cannot exceed 100%.')


class StudentCategoryGrade(models.Model):
    schedule = models.ForeignKey(
        'subjects.SubjectSchedule',
        on_delete=models.SET_NULL,
        related_name='student_category_grades',
        null=True,
        blank=True,
    )
    subject = models.ForeignKey(
        'subjects.Subject',
        on_delete=models.CASCADE,
        related_name='student_category_grades',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='category_grades',
    )
    grade_category = models.ForeignKey(
        GradeCategory,
        on_delete=models.CASCADE,
        related_name='student_grades',
    )
    raw_score = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    total_score = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    transmuted_grade = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    weighted_score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    is_item_computed = models.BooleanField(default=False)
    completion_status = models.CharField(max_length=20, choices=GradeCompletionStatus, default=GradeCompletionStatus.COMPLETE)
    required_item_count = models.PositiveIntegerField(default=0)
    resolved_item_count = models.PositiveIntegerField(default=0)
    pending_item_count = models.PositiveIntegerField(default=0)
    withheld_reason = models.CharField(max_length=200, blank=True)
    computed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['schedule', 'student', 'grade_category'],
                condition=Q(schedule__isnull=False),
                name='unique_schedule_student_category_grade',
            ),
        ]
        ordering = ['subject__code', 'grade_category__grading_period', 'student__username']

    def calculate_transmuted_grade(self):
        if self.completion_status != GradeCompletionStatus.COMPLETE:
            return None
        policy = getattr(self.subject, 'grading_policy', None)
        return transmute_score(
            self.raw_score,
            self.total_score,
            getattr(policy, 'transmutation_base', 60),
            getattr(policy, 'transmutation_scale', 40),
        )

    def calculate_weighted_score(self):
        transmuted = self.calculate_transmuted_grade()
        if transmuted is None:
            return None

        return transmuted * (self.grade_category.weight / 100)

    def save(self, *args, **kwargs):
        self.transmuted_grade = self.calculate_transmuted_grade()
        self.weighted_score = self.calculate_weighted_score()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.student} - {self.grade_category}: {self.transmuted_grade}'


class GradeItem(models.Model):
    schedule = models.ForeignKey(
        'subjects.SubjectSchedule',
        on_delete=models.SET_NULL,
        related_name='grade_items',
        null=True,
        blank=True,
    )
    grade_category = models.ForeignKey(
        GradeCategory,
        on_delete=models.CASCADE,
        related_name='items',
    )
    title = models.CharField(max_length=180)
    date = models.DateField(null=True, blank=True)
    points_possible = models.DecimalField(max_digits=7, decimal_places=2, default=100)
    order = models.PositiveIntegerField(default=0)
    is_required = models.BooleanField(default=True)
    source_type = models.CharField(
        max_length=30,
        choices=GradeItemSourceType,
        default=GradeItemSourceType.MANUAL,
    )
    module_activity = models.ForeignKey(
        'learning_modules.ModuleActivity',
        on_delete=models.SET_NULL,
        related_name='grade_items',
        null=True,
        blank=True,
    )
    attendance_session = models.ForeignKey(
        'attendance.AttendanceSession',
        on_delete=models.SET_NULL,
        related_name='grade_items',
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['grade_category__subject__code', 'grade_category__grading_period', 'order', 'id']
        indexes = [models.Index(fields=['schedule', 'date'], name='gradeitem_schedule_date_idx')]

    @property
    def subject(self):
        return self.grade_category.subject

    @property
    def source_title(self):
        if self.source_type == GradeItemSourceType.MODULE_ACTIVITY and self.module_activity_id:
            return self.module_activity.title
        if self.source_type == GradeItemSourceType.ATTENDANCE and self.attendance_session_id:
            return self.attendance_session.title or str(self.attendance_session.date)
        return self.title

    @property
    def source_points_possible(self):
        if self.source_type == GradeItemSourceType.MODULE_ACTIVITY and self.module_activity_id:
            return self.module_activity.points_possible
        if self.source_type == GradeItemSourceType.ATTENDANCE and self.attendance_session_id:
            return self.attendance_session.points_possible
        return self.points_possible

    def save(self, *args, **kwargs):
        if not self.title:
            self.title = self.source_title
        if self.source_type != GradeItemSourceType.MANUAL:
            self.points_possible = self.source_points_possible
        if self.points_possible is None or self.points_possible <= 0:
            raise ValidationError('Points possible must be greater than zero.')
        super().save(*args, **kwargs)
        from .services import recompute_student_category_from_items
        from .source_sync import sync_grade_item

        if self.source_type != GradeItemSourceType.MANUAL and self.schedule_id:
            sync_grade_item(self)

        students = {score.student for score in self.student_scores.select_related('student')}
        if self.schedule_id:
            students.update(
                enrollment.student
                for enrollment in self.schedule.students.filter(is_active=True).select_related('student')
            )
        for student in students:
            recompute_student_category_from_items(student, self.grade_category, self.schedule)

    def delete(self, *args, **kwargs):
        students = {score.student for score in self.student_scores.select_related('student')}
        if self.schedule_id:
            students.update(
                enrollment.student
                for enrollment in self.schedule.students.filter(is_active=True).select_related('student')
            )
        affected = [(student, self.grade_category, self.schedule) for student in students]
        result = super().delete(*args, **kwargs)
        from .services import recompute_student_category_from_items

        for student, grade_category, schedule in affected:
            recompute_student_category_from_items(student, grade_category, schedule)
        return result

    def __str__(self):
        return f'{self.grade_category} - {self.title}'


class StudentGradeItemScore(models.Model):
    class Status(models.TextChoices):
        GRADED = 'GRADED', 'Graded'
        EXCUSED = 'EXCUSED', 'Excused'

    class Origin(models.TextChoices):
        MANUAL = 'MANUAL', 'Manual'
        AUTOMATIC = 'AUTOMATIC', 'Automatic'
        OVERRIDE = 'OVERRIDE', 'Override'

    grade_item = models.ForeignKey(
        GradeItem,
        on_delete=models.CASCADE,
        related_name='student_scores',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='grade_item_scores',
    )
    raw_score = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=Status, default=Status.GRADED)
    origin = models.CharField(max_length=20, choices=Origin, default=Origin.MANUAL)
    override_reason = models.CharField(max_length=240, blank=True)
    remarks = models.CharField(max_length=160, blank=True)
    computed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['grade_item', 'student'],
                name='unique_student_grade_item_score',
            ),
        ]
        ordering = ['grade_item__grade_category__grading_period', 'grade_item__order', 'student__username']

    @property
    def total_score(self):
        return self.grade_item.points_possible

    @property
    def transmuted_grade(self):
        if self.status != self.Status.GRADED:
            return None
        return transmute_score(self.raw_score, self.total_score)

    def save(self, *args, **kwargs):
        if self.status == self.Status.EXCUSED:
            self.raw_score = None
        elif self.raw_score is None:
            raise ValidationError('A graded score requires a raw score.')
        elif self.raw_score < 0 or self.raw_score > self.grade_item.points_possible:
            raise ValidationError('Raw score must be between zero and points possible.')
        if self.origin == self.Origin.OVERRIDE and not self.override_reason.strip():
            raise ValidationError('An override reason is required.')
        super().save(*args, **kwargs)
        from .services import recompute_from_item_score

        recompute_from_item_score(self)

    def delete(self, *args, **kwargs):
        student = self.student
        grade_category = self.grade_item.grade_category
        schedule = self.grade_item.schedule
        result = super().delete(*args, **kwargs)
        from .services import recompute_student_category_from_items

        recompute_student_category_from_items(student, grade_category, schedule)
        return result

    def __str__(self):
        return f'{self.student} - {self.grade_item}: {self.raw_score}'


class PeriodGrade(models.Model):
    schedule = models.ForeignKey(
        'subjects.SubjectSchedule',
        on_delete=models.SET_NULL,
        related_name='period_grades',
        null=True,
        blank=True,
    )
    subject = models.ForeignKey(
        'subjects.Subject',
        on_delete=models.CASCADE,
        related_name='period_grades',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='period_grades',
    )
    grading_period = models.CharField(max_length=20, choices=GradingPeriod)
    raw_score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    completion_status = models.CharField(max_length=20, choices=GradeCompletionStatus, default=GradeCompletionStatus.PENDING)
    required_item_count = models.PositiveIntegerField(default=0)
    resolved_item_count = models.PositiveIntegerField(default=0)
    pending_item_count = models.PositiveIntegerField(default=0)
    withheld_reason = models.CharField(max_length=200, blank=True)
    remarks = models.CharField(max_length=120, blank=True)
    computed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['schedule', 'student', 'grading_period'],
                condition=Q(schedule__isnull=False),
                name='unique_period_grade_per_schedule_student',
            ),
        ]
        ordering = ['subject__code', 'grading_period', 'student__username']

    def calculate_raw_score(self):
        result = self.student.category_grades.filter(
            subject=self.subject,
            schedule=self.schedule,
            grade_category__grading_period=self.grading_period,
        ).aggregate(total=models.Sum('weighted_score'))

        return result['total']

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.student} - {self.subject} - {self.get_grading_period_display()}: {self.raw_score}'


class FinalGrade(models.Model):
    schedule = models.ForeignKey(
        'subjects.SubjectSchedule',
        on_delete=models.SET_NULL,
        related_name='final_grades',
        null=True,
        blank=True,
    )
    subject = models.ForeignKey(
        'subjects.Subject',
        on_delete=models.CASCADE,
        related_name='final_grades',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='final_grades',
    )
    prelim_grade = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    midterm_grade = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    prefinal_grade = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    final_period_grade = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    final_grade = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    completion_status = models.CharField(max_length=20, choices=GradeCompletionStatus, default=GradeCompletionStatus.PENDING)
    completed_period_count = models.PositiveIntegerField(default=0)
    required_period_count = models.PositiveIntegerField(default=4)
    withheld_reason = models.CharField(max_length=200, blank=True)
    remarks = models.CharField(max_length=120, blank=True)
    computed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['schedule', 'student'],
                condition=Q(schedule__isnull=False),
                name='unique_final_grade_per_schedule_student',
            ),
        ]
        ordering = ['subject__code', 'student__username']

    def calculate_final_grade(self):
        grades = [
            self.prelim_grade,
            self.midterm_grade,
            self.prefinal_grade,
            self.final_period_grade,
        ]
        if self.completion_status != GradeCompletionStatus.COMPLETE or any(grade is None for grade in grades):
            return None
        policy = getattr(self.subject, 'grading_policy', None)
        weights = [
            getattr(policy, 'prelim_weight', 25), getattr(policy, 'midterm_weight', 25),
            getattr(policy, 'prefinal_weight', 25), getattr(policy, 'final_weight', 25),
        ]
        return sum(grade * weight / 100 for grade, weight in zip(grades, weights))

    def save(self, *args, **kwargs):
        self.final_grade = self.calculate_final_grade()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.student} - {self.subject}: {self.final_grade}'
