from django.conf import settings
from django.db import models


class ProgrammingProblem(models.Model):
    class Difficulty(models.TextChoices):
        EASY = 'EASY', 'Easy'
        MEDIUM = 'MEDIUM', 'Medium'
        HARD = 'HARD', 'Hard'

    title = models.CharField(max_length=180)
    slug = models.SlugField(max_length=200, unique=True)
    description = models.TextField()
    starter_code = models.TextField(blank=True)
    expected_language = models.CharField(max_length=50, blank=True)
    difficulty = models.CharField(max_length=20, choices=Difficulty, default=Difficulty.EASY)
    subject = models.ForeignKey(
        'subjects.Subject',
        on_delete=models.SET_NULL,
        related_name='programming_problems',
        null=True,
        blank=True,
    )
    module = models.ForeignKey(
        'learning_modules.Module',
        on_delete=models.SET_NULL,
        related_name='programming_problems',
        null=True,
        blank=True,
    )
    assessment_question = models.OneToOneField(
        'assessments.Question',
        on_delete=models.SET_NULL,
        related_name='programming_problem',
        null=True,
        blank=True,
    )
    points_possible = models.DecimalField(max_digits=6, decimal_places=2, default=100)
    is_published = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['title']

    def __str__(self):
        return self.title


class TestCase(models.Model):
    problem = models.ForeignKey(
        ProgrammingProblem,
        on_delete=models.CASCADE,
        related_name='test_cases',
    )
    input_data = models.TextField(blank=True)
    expected_output = models.TextField()
    is_hidden = models.BooleanField(default=False)
    order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ['problem', 'order', 'id']

    def __str__(self):
        visibility = 'hidden' if self.is_hidden else 'visible'
        return f'{self.problem} test {self.order} ({visibility})'


class CodeSubmission(models.Model):
    class Status(models.TextChoices):
        PENDING = 'PENDING', 'Pending'
        RUNNING = 'RUNNING', 'Running'
        ACCEPTED = 'ACCEPTED', 'Accepted'
        WRONG_ANSWER = 'WRONG_ANSWER', 'Wrong Answer'
        RUNTIME_ERROR = 'RUNTIME_ERROR', 'Runtime Error'
        TIME_LIMIT = 'TIME_LIMIT', 'Time Limit'

    problem = models.ForeignKey(
        ProgrammingProblem,
        on_delete=models.CASCADE,
        related_name='submissions',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='code_submissions',
    )
    assessment_attempt = models.ForeignKey(
        'assessments.AssessmentAttempt',
        on_delete=models.SET_NULL,
        related_name='code_submissions',
        null=True,
        blank=True,
    )
    language = models.CharField(max_length=50)
    source_code = models.TextField()
    status = models.CharField(max_length=30, choices=Status, default=Status.PENDING)
    score = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    output = models.TextField(blank=True)
    error = models.TextField(blank=True)
    submitted_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-submitted_at']

    def __str__(self):
        return f'{self.student} - {self.problem}: {self.status}'
