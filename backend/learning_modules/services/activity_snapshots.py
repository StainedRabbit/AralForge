from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from learning_modules.models import ModuleActivityAttempt, ModuleActivityQuestion


def build_activity_snapshot(activity):
    questions = activity.questions.filter(is_published=True).prefetch_related(
        'choices', 'matching_pairs',
    ).order_by('order', 'id')
    return [
        {
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
                }
                for choice in question.choices.all().order_by('order', 'id')
            ],
            'matching_pairs': [
                {
                    'id': pair.id,
                    'left_text': pair.left_text,
                    'right_text': pair.right_text,
                    'order': pair.order,
                }
                for pair in question.matching_pairs.all().order_by('order', 'id')
            ],
        }
        for question in questions
    ]


def ensure_attempt_snapshot(attempt):
    if not attempt.question_snapshot:
        attempt.question_snapshot = build_activity_snapshot(attempt.activity)
        attempt.save(update_fields=['question_snapshot'])
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


def normalize_draft_answers(snapshot, payload):
    valid_ids = {str(question['id']) for question in snapshot}
    normalized = {}
    for raw_question_id, raw_answer in (payload or {}).items():
        question_id = str(raw_question_id)
        if question_id not in valid_ids or not isinstance(raw_answer, dict):
            continue
        normalized[question_id] = {
            'selected_choice': raw_answer.get('selected_choice'),
            'text_answer': str(raw_answer.get('text_answer') or ''),
            'choice_order': raw_answer.get('choice_order') or [],
            'matching_answer': raw_answer.get('matching_answer') or {},
        }
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
        expected = [int(choice['id']) for choice in question.get('choices', [])]
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
    attempt.is_submitted = True
    attempt.save(update_fields=[
        'draft_answers', 'score', 'max_score', 'submitted_at', 'is_submitted',
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
