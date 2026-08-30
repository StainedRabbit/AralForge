from decimal import Decimal
import random

from django.utils import timezone
from django.db.models import Prefetch
from rest_framework import serializers

from learning_modules.models import (
    ModuleActivityAttempt,
    ModuleActivityMatchingPair,
    ModuleActivityQuestion,
    ModuleActivityQuestionChoice,
)


MAX_DRAFT_TEXT_LENGTH = 20_000
MAX_DRAFT_PAYLOAD_QUESTIONS = 200


def build_activity_snapshot(activity, attempt_id=None):
    questions = activity.questions.filter(is_published=True).prefetch_related(
        Prefetch(
            'choices',
            queryset=ModuleActivityQuestionChoice.objects.order_by('order', 'id'),
        ),
        Prefetch(
            'matching_pairs',
            queryset=ModuleActivityMatchingPair.objects.order_by('order', 'id'),
        ),
    ).order_by('order', 'id')
    snapshot = []
    for question in questions:
        choices = list(question.choices.all())
        pairs = list(question.matching_pairs.all())
        choice_ids = [choice.id for choice in choices]
        matching_options = [pair.right_text for pair in pairs]
        seed = f'{attempt_id or "preview"}:{activity.revision}:{question.id}'
        generator = random.Random(seed)
        if question.question_type != ModuleActivityQuestion.QuestionType.TRUE_FALSE:
            generator.shuffle(choice_ids)
        generator.shuffle(matching_options)
        presentation_order = {
            choice_id: index for index, choice_id in enumerate(choice_ids)
        }
        snapshot.append({
            'id': question.id,
            'question_type': question.question_type,
            'prompt': question.prompt,
            'points': str(question.points),
            'order': question.order,
            'explanation': question.explanation,
            'correct_text_answers': question.correct_text_answers,
            'case_sensitive': question.case_sensitive,
            'code_snippet': question.code_snippet,
            'expected_output': question.expected_output,
            'is_published': True,
            'choices': [
                {
                    'id': choice.id,
                    'text': choice.text,
                    'is_correct': choice.is_correct,
                    'order': choice.order,
                    'presentation_order': presentation_order.get(choice.id, choice.order),
                }
                for choice in choices
            ],
            'matching_pairs': [
                {
                    'id': pair.id,
                    'left_text': pair.left_text,
                    'right_text': pair.right_text,
                    'order': pair.order,
                }
                for pair in pairs
            ],
            'matching_options': matching_options,
        })
    return snapshot


def ensure_attempt_snapshot(attempt):
    if not attempt.question_snapshot:
        attempt.question_snapshot = build_activity_snapshot(attempt.activity, attempt.id)
        attempt.activity_revision = attempt.activity.revision
        attempt.passing_score_snapshot = attempt.activity.passing_score
        attempt.save(update_fields=[
            'question_snapshot',
            'activity_revision',
            'passing_score_snapshot',
        ])
    return attempt


def effective_activity_due_at(activity, student):
    prefetched = getattr(activity, '_prefetched_objects_cache', {}).get('extensions')
    extension = (
        next((item for item in prefetched if item.student_id == student.id), None)
        if prefetched is not None
        else activity.extensions.filter(student=student).only('due_at').first()
    )
    return extension.due_at if extension else activity.due_at


def validate_activity_window(activity, student):
    if activity.lesson_id:
        return
    now = timezone.now()
    if activity.opens_at and now < activity.opens_at:
        raise serializers.ValidationError({
            'activity': f'This activity opens on {activity.opens_at.isoformat()}.',
        })
    due_at = effective_activity_due_at(activity, student)
    if due_at and now > due_at and not activity.allow_late_submissions:
        raise serializers.ValidationError({
            'activity': 'The due date for this activity has passed.',
        })


def normalize_draft_answers(snapshot, payload, existing=None):
    if len(payload or {}) > MAX_DRAFT_PAYLOAD_QUESTIONS:
        raise serializers.ValidationError({
            'answers': f'At most {MAX_DRAFT_PAYLOAD_QUESTIONS} answers may be saved at once.',
        })
    questions = {str(question['id']): question for question in snapshot}
    normalized = dict(existing or {})
    errors = {}
    for raw_question_id, raw_answer in (payload or {}).items():
        question_id = str(raw_question_id)
        question = questions.get(question_id)
        if not question:
            errors[question_id] = 'This question is not part of the frozen attempt.'
            continue
        if not isinstance(raw_answer, dict):
            errors[question_id] = 'Answer data must be an object.'
            continue

        selected_choice = raw_answer.get('selected_choice')
        text_answer = str(raw_answer.get('text_answer') or '')
        choice_order = raw_answer.get('choice_order') or []
        matching_answer = raw_answer.get('matching_answer') or {}
        choice_ids = {int(choice['id']) for choice in question.get('choices', [])}
        pair_ids = {str(pair['id']) for pair in question.get('matching_pairs', [])}
        matching_options = {str(value) for value in question.get('matching_options', [])}
        question_errors = []

        if len(text_answer) > MAX_DRAFT_TEXT_LENGTH:
            question_errors.append(
                f'Text answers are limited to {MAX_DRAFT_TEXT_LENGTH} characters.'
            )
        if selected_choice is not None:
            try:
                selected_choice = int(selected_choice)
            except (TypeError, ValueError):
                question_errors.append('Selected choice must be a valid identifier.')
            else:
                if selected_choice not in choice_ids:
                    question_errors.append('Selected choice does not belong to this question.')
        if not isinstance(choice_order, list):
            question_errors.append('Choice order must be a list.')
            choice_order = []
        else:
            try:
                choice_order = [int(value) for value in choice_order]
            except (TypeError, ValueError):
                question_errors.append('Choice order contains an invalid identifier.')
                choice_order = []
        if question['question_type'] == ModuleActivityQuestion.QuestionType.ORDERING:
            if len(choice_order) != len(set(choice_order)) or set(choice_order) != choice_ids:
                question_errors.append('Ordering answers must contain every item exactly once.')
        elif any(value not in choice_ids for value in choice_order):
            question_errors.append('Choice order contains an item from another question.')

        if not isinstance(matching_answer, dict):
            question_errors.append('Matching answers must be an object.')
            matching_answer = {}
        else:
            matching_answer = {
                str(key): str(value) for key, value in matching_answer.items()
            }
            if any(key not in pair_ids for key in matching_answer):
                question_errors.append('Matching answers contain a row from another question.')
            nonempty_values = [value for value in matching_answer.values() if value]
            if any(value not in matching_options for value in nonempty_values):
                question_errors.append('Matching answers contain an unavailable option.')
            if len(nonempty_values) != len(set(nonempty_values)):
                question_errors.append('Each matching option may be used only once.')

        if question_errors:
            errors[question_id] = question_errors
            continue
        normalized[question_id] = {
            'selected_choice': selected_choice,
            'text_answer': text_answer,
            'choice_order': choice_order,
            'matching_answer': matching_answer,
        }
    if errors:
        raise serializers.ValidationError({'answers': errors})
    return normalized


def score_snapshot_answer(answer, question):
    question_type = question['question_type']
    if question_type in {
        ModuleActivityQuestion.QuestionType.MULTIPLE_CHOICE,
        ModuleActivityQuestion.QuestionType.TRUE_FALSE,
    }:
        correct_ids = {
            int(choice['id']) for choice in question.get('choices', []) if choice.get('is_correct')
        }
        try:
            return int(answer.get('selected_choice')) in correct_ids
        except (TypeError, ValueError):
            return False
    if question_type == ModuleActivityQuestion.QuestionType.FILL_BLANK:
        submitted = normalize_text(answer.get('text_answer'), question.get('case_sensitive', False))
        accepted = [
            normalize_text(value, question.get('case_sensitive', False))
            for value in question.get('correct_text_answers', [])
        ]
        return submitted in accepted
    if question_type == ModuleActivityQuestion.QuestionType.ORDERING:
        expected = [
            int(choice['id'])
            for choice in sorted(
                question.get('choices', []),
                key=lambda choice: (choice.get('order', 0), choice.get('id', 0)),
            )
        ]
        submitted = [
            int(value) for value in answer.get('choice_order', []) if str(value).isdigit()
        ]
        return submitted == expected
    if question_type == ModuleActivityQuestion.QuestionType.MATCHING:
        expected = {
            str(pair['id']): str(pair.get('right_text') or '').strip()
            for pair in question.get('matching_pairs', [])
        }
        submitted = {
            str(key): str(value).strip()
            for key, value in answer.get('matching_answer', {}).items()
        }
        return submitted == expected
    if question_type == ModuleActivityQuestion.QuestionType.CODE_OUTPUT:
        return normalize_output(answer.get('text_answer')) == normalize_output(
            question.get('expected_output'),
        )
    return False


def grade_snapshot_attempt(attempt):
    ensure_attempt_snapshot(attempt)
    total_score = Decimal('0')
    max_score = Decimal('0')
    graded = dict(attempt.draft_answers)
    for question in attempt.question_snapshot:
        points = Decimal(str(question.get('points') or 0))
        max_score += points
        key = str(question['id'])
        answer = dict(graded.get(key) or {})
        is_correct = score_snapshot_answer(answer, question) if answer else False
        earned = points if is_correct else Decimal('0')
        answer.update({
            'is_correct': is_correct,
            'points_earned': str(earned),
            'feedback': question.get('explanation') or '',
        })
        graded[key] = answer
        total_score += earned

    attempt.draft_answers = graded
    attempt.score = total_score
    attempt.max_score = max_score
    attempt.submitted_at = attempt.submitted_at or timezone.now()
    attempt.status = attempt.Status.SUBMITTED
    attempt.save(update_fields=[
        'draft_answers', 'score', 'max_score', 'submitted_at', 'status',
    ])
    return attempt


def normalize_text(value, case_sensitive=False):
    normalized = ' '.join(str(value or '').split())
    return normalized if case_sensitive else normalized.lower()


def normalize_output(value):
    return '\n'.join(
        line.rstrip()
        for line in str(value or '').strip().replace('\r\n', '\n').replace('\r', '\n').split('\n')
    )
