from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models


def transmute_score(raw_score, total_score):
    if raw_score is None or total_score in (None, 0):
        return None

    return (raw_score / total_score) * 40 + 60


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
    CODING = 'CODING', 'Coding'
    OTHER = 'OTHER', 'Other'


class GradingTemplate(models.Model):
    name = models.CharField(max_length=120, unique=True)
    description = models.TextField(blank=True)
    is_default = models.BooleanField(default=False)
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

        return created_categories


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

        if total_weight > 100:
            raise ValidationError('Subject category weights for one grading period cannot exceed 100%.')


class StudentCategoryGrade(models.Model):
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
    raw_score = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    total_score = models.DecimalField(max_digits=7, decimal_places=2, default=0)
    transmuted_grade = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    weighted_score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    computed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['student', 'grade_category'],
                name='unique_student_category_grade',
            ),
        ]
        ordering = ['subject__code', 'grade_category__grading_period', 'student__username']

    def calculate_transmuted_grade(self):
        return transmute_score(self.raw_score, self.total_score)

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


class PeriodGrade(models.Model):
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
    remarks = models.CharField(max_length=120, blank=True)
    computed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['subject', 'student', 'grading_period'],
                name='unique_period_grade_per_subject_student',
            ),
        ]
        ordering = ['subject__code', 'grading_period', 'student__username']

    def calculate_raw_score(self):
        result = self.student.category_grades.filter(
            subject=self.subject,
            grade_category__grading_period=self.grading_period,
        ).aggregate(total=models.Sum('weighted_score'))

        return result['total']

    def save(self, *args, **kwargs):
        self.raw_score = self.calculate_raw_score()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.student} - {self.subject} - {self.get_grading_period_display()}: {self.raw_score}'


class FinalGrade(models.Model):
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
    remarks = models.CharField(max_length=120, blank=True)
    computed_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['subject', 'student'],
                name='unique_final_grade_per_subject_student',
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
        available_grades = [grade for grade in grades if grade is not None]

        if not available_grades:
            return None

        return sum(available_grades) / len(available_grades)

    def save(self, *args, **kwargs):
        self.final_grade = self.calculate_final_grade()
        super().save(*args, **kwargs)

    def __str__(self):
        return f'{self.student} - {self.subject}: {self.final_grade}'
