from django.conf import settings
from django.db import models
from django.utils import timezone


class Assessment(models.Model):
    class Kind(models.TextChoices):
        QUIZ = 'QUIZ', 'Quiz'
        EXAM = 'EXAM', 'Exam'
        ACTIVITY = 'ACTIVITY', 'Activity'
        MOCK_QUIZ = 'MOCK_QUIZ', 'Mock Quiz'
        MOCK_EXAM = 'MOCK_EXAM', 'Mock Exam'
        PRACTICE = 'PRACTICE', 'Practice'

    title = models.CharField(max_length=180)
    kind = models.CharField(max_length=20, choices=Kind)
    subject = models.ForeignKey(
        'subjects.Subject',
        on_delete=models.CASCADE,
        related_name='assessments',
        null=True,
        blank=True,
    )
    module = models.ForeignKey(
        'learning_modules.Module',
        on_delete=models.SET_NULL,
        related_name='assessments',
        null=True,
        blank=True,
    )
    instructions = models.TextField(blank=True)
    points_possible = models.DecimalField(max_digits=7, decimal_places=2, default=100)
    mock_question_count = models.PositiveSmallIntegerField(default=25)
    time_limit_minutes = models.PositiveIntegerField(null=True, blank=True)
    max_attempts = models.PositiveSmallIntegerField(default=1)
    randomize_questions = models.BooleanField(default=False)
    show_answers_after_submit = models.BooleanField(default=False)
    counts_toward_grade = models.BooleanField(default=True)
    is_published = models.BooleanField(default=False)
    opens_at = models.DateTimeField(null=True, blank=True)
    closes_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_kind_display()}: {self.title}'


class Question(models.Model):
    class QuestionType(models.TextChoices):
        MULTIPLE_CHOICE = 'MULTIPLE_CHOICE', 'Multiple Choice'
        TRUE_FALSE = 'TRUE_FALSE', 'True/False'
        SHORT_ANSWER = 'SHORT_ANSWER', 'Short Answer'
        ESSAY = 'ESSAY', 'Essay'
        CODING = 'CODING', 'Coding'

    assessment = models.ForeignKey(
        Assessment,
        on_delete=models.CASCADE,
        related_name='questions',
    )
    question_type = models.CharField(max_length=30, choices=QuestionType)
    prompt = models.TextField()
    points = models.DecimalField(max_digits=6, decimal_places=2, default=1)
    order = models.PositiveIntegerField(default=0)
    explanation = models.TextField(blank=True)
    topics = models.ManyToManyField(
        'learning_modules.Module',
        blank=True,
        related_name='assessment_questions',
    )
    module_topics = models.ManyToManyField(
        'learning_modules.ModuleTopic',
        blank=True,
        related_name='assessment_questions',
    )

    class Meta:
        ordering = ['assessment', 'order', 'id']

    def __str__(self):
        return f'{self.assessment}: Question {self.order}'


class Choice(models.Model):
    question = models.ForeignKey(
        Question,
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


class AssessmentAttempt(models.Model):
    assessment = models.ForeignKey(
        Assessment,
        on_delete=models.CASCADE,
        related_name='attempts',
    )
    student = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='assessment_attempts',
    )
    attempt_number = models.PositiveSmallIntegerField(default=1)
    score = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    started_at = models.DateTimeField(auto_now_add=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    is_submitted = models.BooleanField(default=False)
    selected_topics = models.ManyToManyField(
        'learning_modules.Module',
        blank=True,
        related_name='mock_exam_attempts',
    )
    selected_module_topics = models.ManyToManyField(
        'learning_modules.ModuleTopic',
        blank=True,
        related_name='mock_exam_attempts',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['assessment', 'student', 'attempt_number'],
                name='unique_assessment_attempt_number',
            ),
        ]
        ordering = ['-started_at']

    def __str__(self):
        return f'{self.student} - {self.assessment} attempt {self.attempt_number}'

    def score_multiple_choice_answers(self):
        answers = list(self.answers.select_related('question', 'selected_choice').prefetch_related(
            'question__choices',
        ))
        answers_by_question = {answer.question_id: answer for answer in answers}
        question_ids = list(
            self.selected_questions.values_list('question_id', flat=True)
            if self.selected_questions.exists()
            else self.assessment.questions.values_list('id', flat=True)
        )

        for answer in answers:
            if answer.question_id not in question_ids:
                continue
            if answer.question.question_type not in {
                Question.QuestionType.MULTIPLE_CHOICE,
                Question.QuestionType.TRUE_FALSE,
            }:
                continue

            correct_choice = next(
                (choice for choice in answer.question.choices.all() if choice.is_correct),
                None,
            )
            is_correct = bool(
                correct_choice
                and answer.selected_choice_id
                and answer.selected_choice_id == correct_choice.id
            )
            answer.is_correct = is_correct
            answer.points_earned = answer.question.points if is_correct else 0
            answer.save(update_fields=['is_correct', 'points_earned'])

        if not self.submitted_at:
            self.submitted_at = timezone.now()
        self.is_submitted = True
        self.score = self.completed_score(question_ids, answers_by_question)
        self.save(update_fields=['score', 'submitted_at', 'is_submitted'])

    def completed_score(self, question_ids=None, answers_by_question=None):
        question_ids = question_ids or list(
            self.selected_questions.values_list('question_id', flat=True)
            if self.selected_questions.exists()
            else self.assessment.questions.values_list('id', flat=True)
        )
        answers_by_question = answers_by_question or {
            answer.question_id: answer for answer in self.answers.all()
        }
        if any(
            question_id not in answers_by_question
            or answers_by_question[question_id].points_earned is None
            for question_id in question_ids
        ):
            return None
        return sum((answers_by_question[question_id].points_earned for question_id in question_ids), 0)

    def recompute_completed_score(self):
        self.score = self.completed_score()
        self.save(update_fields=['score'])


class AssessmentAttemptQuestion(models.Model):
    attempt = models.ForeignKey(
        AssessmentAttempt,
        on_delete=models.CASCADE,
        related_name='selected_questions',
    )
    question = models.ForeignKey(
        Question,
        on_delete=models.CASCADE,
        related_name='mock_attempts',
    )
    order = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['attempt', 'question'],
                name='unique_question_per_mock_attempt',
            ),
        ]
        ordering = ['attempt', 'order', 'id']

    def __str__(self):
        return f'{self.attempt}: {self.question}'


class Answer(models.Model):
    attempt = models.ForeignKey(
        AssessmentAttempt,
        on_delete=models.CASCADE,
        related_name='answers',
    )
    question = models.ForeignKey(
        Question,
        on_delete=models.CASCADE,
        related_name='answers',
    )
    selected_choice = models.ForeignKey(
        Choice,
        on_delete=models.SET_NULL,
        related_name='answers',
        null=True,
        blank=True,
    )
    text_answer = models.TextField(blank=True)
    code_answer = models.TextField(blank=True)
    is_correct = models.BooleanField(null=True, blank=True)
    points_earned = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    feedback = models.TextField(blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['attempt', 'question'],
                name='unique_answer_per_attempt_question',
            ),
        ]

    def __str__(self):
        return f'{self.attempt} - {self.question}'

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        if self.attempt.is_submitted:
            self.attempt.recompute_completed_score()
