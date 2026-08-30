from decimal import Decimal

from learning_modules.models import ModuleActivityAttempt


def attempt_is_submitted(attempt):
    return attempt.status == ModuleActivityAttempt.Status.SUBMITTED


def attempt_passed(attempt):
    if not attempt_is_submitted(attempt) or attempt.score is None:
        return False
    threshold = attempt.passing_score_snapshot
    if threshold is not None:
        return Decimal(attempt.score) >= Decimal(threshold)
    return (
        attempt.max_score is not None
        and Decimal(attempt.max_score) > 0
        and Decimal(attempt.score) >= Decimal(attempt.max_score)
    )


def evaluate_main_activity_state(activity, attempts):
    attempts = list(attempts)
    visible_attempts = [
        attempt for attempt in attempts
        if attempt.status != ModuleActivityAttempt.Status.SUPERSEDED
    ]
    submitted = [attempt for attempt in visible_attempts if attempt_is_submitted(attempt)]
    active = next((
        attempt for attempt in visible_attempts
        if attempt.status == ModuleActivityAttempt.Status.IN_PROGRESS
        and attempt.submission_method == ModuleActivityAttempt.SubmissionMethod.ONLINE
    ), None)
    paper_attempt = next((
        attempt for attempt in submitted
        if attempt.submission_method == ModuleActivityAttempt.SubmissionMethod.PAPER
    ), None)
    passed_attempts = [attempt for attempt in submitted if attempt_passed(attempt)]
    scored = [
        attempt for attempt in submitted
        if attempt.score is not None and attempt.max_score is not None
        and Decimal(attempt.max_score) > 0
    ]
    best = max(
        scored,
        key=lambda attempt: (
            Decimal(attempt.score) / Decimal(attempt.max_score),
            Decimal(attempt.score),
            attempt.attempt_number,
        ),
        default=None,
    )
    exhausted = len(submitted) >= activity.max_attempts
    paper_terminal = paper_attempt is not None
    review_unlocked = paper_terminal or bool(passed_attempts) or exhausted
    if paper_terminal:
        requirement_met = True
    elif activity.passing_score is None:
        requirement_met = bool(submitted)
    else:
        requirement_met = bool(passed_attempts) or exhausted
    attempts_remaining = 0 if paper_terminal else max(
        activity.max_attempts - len(visible_attempts),
        0,
    )
    best_percentage = None
    if best:
        best_percentage = (
            Decimal(best.score) / Decimal(best.max_score) * Decimal('100')
        ).quantize(Decimal('0.1'))

    return {
        'activity': activity.id,
        'attempt_limit': activity.max_attempts,
        'attempt_count': len(visible_attempts),
        'submitted_count': len(submitted),
        'attempts_remaining': attempts_remaining,
        'active_attempt_id': active.id if active else None,
        'best_attempt_id': best.id if best else None,
        'best_percentage': str(best_percentage) if best_percentage is not None else None,
        'passed': bool(passed_attempts),
        'review_unlocked': review_unlocked,
        'requirement_met': requirement_met,
        'paper_terminal': paper_terminal,
        'paper_attempt_id': paper_attempt.id if paper_attempt else None,
        'can_start_attempt': not paper_terminal and active is None and attempts_remaining > 0,
    }


def activity_states_for_attempts(activities, attempts):
    attempts_by_activity = {}
    for attempt in attempts:
        attempts_by_activity.setdefault(attempt.activity_id, []).append(attempt)
    return [
        evaluate_main_activity_state(
            activity,
            attempts_by_activity.get(activity.id, []),
        )
        for activity in activities
    ]
