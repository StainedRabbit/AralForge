from decimal import Decimal

from django.db import transaction
from django.db.models import Sum

from .models import (
    FinalGrade,
    GradeCategory,
    GradeCompletionStatus,
    GradeItem,
    GradingPeriod,
    PeriodGrade,
    StudentCategoryGrade,
    StudentGradeItemScore,
    SubjectGradingPolicy,
    transmute_score,
)


def policy_for_subject(subject):
    policy, _ = SubjectGradingPolicy.objects.get_or_create(subject=subject)
    return policy


def compute_student_category_grade(
    student, grade_category, raw_score, total_score, is_item_computed=False, schedule=None,
    completion_status=GradeCompletionStatus.COMPLETE, required_item_count=0,
    resolved_item_count=0, pending_item_count=0, withheld_reason='',
):
    policy = policy_for_subject(grade_category.subject)
    transmuted_grade = None
    weighted_score = None
    if completion_status == GradeCompletionStatus.COMPLETE:
        transmuted_grade = transmute_score(
            raw_score, total_score, policy.transmutation_base, policy.transmutation_scale
        )
        if transmuted_grade is not None:
            weighted_score = transmuted_grade * (grade_category.weight / Decimal('100'))

    return StudentCategoryGrade.objects.update_or_create(
        student=student, subject=grade_category.subject, grade_category=grade_category, schedule=schedule,
        defaults={
            'raw_score': raw_score, 'total_score': total_score,
            'transmuted_grade': transmuted_grade, 'weighted_score': weighted_score,
            'is_item_computed': is_item_computed, 'completion_status': completion_status,
            'required_item_count': required_item_count, 'resolved_item_count': resolved_item_count,
            'pending_item_count': pending_item_count, 'withheld_reason': withheld_reason,
        },
    )[0]


def compute_period_grade(student, subject, grading_period, schedule=None):
    # Legacy aggregate rows have no grade items and retain their historical behavior.
    if schedule is None:
        result = StudentCategoryGrade.objects.filter(
            student=student, subject=subject, schedule=None,
            grade_category__grading_period=grading_period,
        ).aggregate(total=Sum('weighted_score'))
        status = GradeCompletionStatus.COMPLETE if result['total'] is not None else GradeCompletionStatus.PENDING
        return PeriodGrade.objects.update_or_create(
            student=student, subject=subject, grading_period=grading_period, schedule=None,
            defaults={'raw_score': result['total'], 'completion_status': status},
        )[0]

    categories = list(GradeCategory.objects.filter(subject=subject, grading_period=grading_period))
    category_grades = {
        grade.grade_category_id: grade
        for grade in StudentCategoryGrade.objects.filter(
            student=student, subject=subject, schedule=schedule,
            grade_category__grading_period=grading_period,
        )
    }
    required = sum(grade.required_item_count for grade in category_grades.values())
    resolved = sum(grade.resolved_item_count for grade in category_grades.values())
    pending = sum(grade.pending_item_count for grade in category_grades.values())
    weights_valid = bool(categories) and sum(category.weight for category in categories) == Decimal('100')
    every_category_resolved = bool(categories) and all(
        category.id in category_grades
        and category_grades[category.id].completion_status in {
            GradeCompletionStatus.COMPLETE, GradeCompletionStatus.NOT_APPLICABLE
        }
        and category_grades[category.id].required_item_count > 0
        for category in categories
    )

    raw_score = None
    status = GradeCompletionStatus.PENDING
    reason = 'Required grade items are still pending.'
    if not weights_valid:
        reason = 'Category weights must total exactly 100%.'
    elif every_category_resolved:
        applicable = [
            grade for grade in category_grades.values()
            if grade.completion_status == GradeCompletionStatus.COMPLETE
        ]
        if applicable:
            applicable_weight = sum(grade.grade_category.weight for grade in applicable)
            raw_score = sum(grade.weighted_score for grade in applicable) * Decimal('100') / applicable_weight
            status = GradeCompletionStatus.COMPLETE
            reason = ''
        else:
            status = GradeCompletionStatus.NOT_APPLICABLE
            reason = 'Every required item in this period is excused.'

    return PeriodGrade.objects.update_or_create(
        student=student, subject=subject, grading_period=grading_period, schedule=schedule,
        defaults={
            'raw_score': raw_score, 'completion_status': status,
            'required_item_count': required, 'resolved_item_count': resolved,
            'pending_item_count': max(required - resolved, pending), 'withheld_reason': reason,
        },
    )[0]


def compute_final_grade(student, subject, schedule=None):
    period_grades = {
        grade.grading_period: grade
        for grade in PeriodGrade.objects.filter(student=student, subject=subject, schedule=schedule)
    }
    if schedule is None:
        available = [grade for grade in period_grades.values() if grade.raw_score is not None]
        status = GradeCompletionStatus.COMPLETE if available else GradeCompletionStatus.PENDING
        values = {period: period_grades.get(period).raw_score if period in period_grades else None for period in GradingPeriod.values}
        final = FinalGrade.objects.update_or_create(
            student=student, subject=subject, schedule=None,
            defaults={
                'prelim_grade': values[GradingPeriod.PRELIM], 'midterm_grade': values[GradingPeriod.MIDTERM],
                'prefinal_grade': values[GradingPeriod.PREFINAL], 'final_period_grade': values[GradingPeriod.FINAL],
                'completion_status': status, 'completed_period_count': len(available),
                'required_period_count': len(available),
            },
        )[0]
        if available:
            final.final_grade = sum(grade.raw_score for grade in available) / len(available)
            FinalGrade.objects.filter(pk=final.pk).update(final_grade=final.final_grade)
        return final

    complete = all(
        period in period_grades and period_grades[period].completion_status == GradeCompletionStatus.COMPLETE
        for period in GradingPeriod.values
    )
    completed_count = sum(
        grade.completion_status == GradeCompletionStatus.COMPLETE for grade in period_grades.values()
    )
    values = {
        period: period_grades[period].raw_score
        if period in period_grades and period_grades[period].completion_status == GradeCompletionStatus.COMPLETE
        else None
        for period in GradingPeriod.values
    }
    return FinalGrade.objects.update_or_create(
        student=student, subject=subject, schedule=schedule,
        defaults={
            'prelim_grade': values[GradingPeriod.PRELIM], 'midterm_grade': values[GradingPeriod.MIDTERM],
            'prefinal_grade': values[GradingPeriod.PREFINAL], 'final_period_grade': values[GradingPeriod.FINAL],
            'completion_status': GradeCompletionStatus.COMPLETE if complete else GradeCompletionStatus.PENDING,
            'completed_period_count': completed_count, 'required_period_count': 4,
            'withheld_reason': '' if complete else f'{4 - completed_count} grading period(s) are unresolved.',
        },
    )[0]


def recompute_from_item_score(item_score):
    return recompute_student_category_from_items(
        item_score.student, item_score.grade_item.grade_category, item_score.grade_item.schedule
    )


@transaction.atomic
def recompute_student_category_from_items(student, grade_category, schedule=None):
    items = list(GradeItem.objects.filter(
        grade_category=grade_category, schedule=schedule, is_required=True
    ).order_by('id'))
    scores = {
        score.grade_item_id: score
        for score in StudentGradeItemScore.objects.filter(
            student=student, grade_item__in=items
        ).select_related('grade_item')
    }

    if schedule is not None and not items:
        StudentCategoryGrade.objects.filter(
            student=student, grade_category=grade_category, schedule=schedule
        ).delete()
        category_grade = None
    elif schedule is None and not items:
        category_grade = StudentCategoryGrade.objects.filter(
            student=student, grade_category=grade_category, schedule=None
        ).first()
    else:
        resolved_scores = [scores[item.id] for item in items if item.id in scores]
        pending = len(items) - len(resolved_scores)
        graded = [score for score in resolved_scores if score.status == StudentGradeItemScore.Status.GRADED]
        if pending:
            category_grade = compute_student_category_grade(
                student, grade_category, None, None, True, schedule,
                GradeCompletionStatus.PENDING, len(items), len(resolved_scores), pending,
                f'{pending} required item(s) are unresolved.',
            )
        elif not graded:
            category_grade = compute_student_category_grade(
                student, grade_category, None, None, True, schedule,
                GradeCompletionStatus.NOT_APPLICABLE, len(items), len(resolved_scores), 0,
                'Every required item is excused.',
            )
        else:
            category_grade = compute_student_category_grade(
                student, grade_category,
                sum((score.raw_score for score in graded), Decimal('0')),
                sum((score.grade_item.points_possible for score in graded), Decimal('0')),
                True, schedule, GradeCompletionStatus.COMPLETE,
                len(items), len(resolved_scores), 0, '',
            )

    period_grade = compute_period_grade(student, grade_category.subject, grade_category.grading_period, schedule)
    final_grade = compute_final_grade(student, grade_category.subject, schedule)
    return category_grade, period_grade, final_grade


def recompute_all_for_student(student, schedule):
    subject = schedule.subject
    for category in GradeCategory.objects.filter(subject=subject):
        recompute_student_category_from_items(student, category, schedule)
