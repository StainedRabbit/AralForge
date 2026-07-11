from decimal import Decimal

from django.utils import timezone

from learning_modules.models import ModuleActivityQuestion


def submit_activity_attempt(attempt):
    questions = list(
        attempt.activity.questions.filter(is_published=True).prefetch_related(
            'choices',
            'matching_pairs',
        ),
    )
    answers_by_question = {
        answer.question_id: answer
        for answer in attempt.answers.select_related(
            'question',
            'selected_choice',
        ).prefetch_related(
            'question__choices',
            'question__matching_pairs',
        )
    }
    total_score = Decimal('0')
    max_score = Decimal('0')

    for question in questions:
        max_score += question.points
        answer = answers_by_question.get(question.id)
        if not answer:
            continue

        is_correct = score_answer(answer, question)
        answer.is_correct = is_correct
        answer.points_earned = question.points if is_correct else Decimal('0')
        answer.feedback = question.explanation if is_correct and question.explanation else answer.feedback
        answer.save(update_fields=['is_correct', 'points_earned', 'feedback'])
        total_score += answer.points_earned

    attempt.score = total_score
    attempt.max_score = max_score
    attempt.submitted_at = attempt.submitted_at or timezone.now()
    attempt.is_submitted = True
    attempt.save(update_fields=['score', 'max_score', 'submitted_at', 'is_submitted'])
    return attempt


def score_answer(answer, question):
    question_type = question.question_type

    if question_type in {
        ModuleActivityQuestion.QuestionType.MULTIPLE_CHOICE,
        ModuleActivityQuestion.QuestionType.TRUE_FALSE,
    }:
        return bool(answer.selected_choice and answer.selected_choice.is_correct)

    if question_type == ModuleActivityQuestion.QuestionType.FILL_BLANK:
        submitted = normalize_text(answer.text_answer, question.case_sensitive)
        accepted = [
            normalize_text(value, question.case_sensitive)
            for value in question.correct_text_answers
        ]
        return submitted in accepted

    if question_type == ModuleActivityQuestion.QuestionType.ORDERING:
        expected = list(question.choices.order_by('order', 'id').values_list('id', flat=True))
        submitted = [int(value) for value in answer.choice_order if str(value).isdigit()]
        return submitted == expected

    if question_type == ModuleActivityQuestion.QuestionType.MATCHING:
        expected = {
            str(pair.id): str(pair.right_text).strip()
            for pair in question.matching_pairs.all()
        }
        submitted = {
            str(key): str(value).strip()
            for key, value in answer.matching_answer.items()
        }
        return submitted == expected

    if question_type == ModuleActivityQuestion.QuestionType.CODE_OUTPUT:
        return normalize_output(answer.text_answer) == normalize_output(question.expected_output)

    return False


def normalize_text(value, case_sensitive=False):
    normalized = ' '.join(str(value or '').split())
    return normalized if case_sensitive else normalized.lower()


def normalize_output(value):
    return '\n'.join(
        line.rstrip()
        for line in str(value or '').strip().replace('\r\n', '\n').replace('\r', '\n').split('\n')
    )
