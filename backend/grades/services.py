from decimal import Decimal
from collections import defaultdict

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone

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


def recompute_grade_target_for_students(student_ids, grade_category, schedule=None):
    """Recompute one category target without per-student schedule queries."""
    student_ids = {int(student_id) for student_id in student_ids}
    if not student_ids:
        return {'categories': 0, 'periods': 0, 'finals': 0}

    if schedule is not None:
        return recompute_student_categories_bulk({
            (student_id, grade_category.id, schedule.id)
            for student_id in student_ids
        })

    # Legacy aggregate grades are not schedule-scoped and are intentionally
    # handled by the original single-student calculation path.
    student_model = StudentGradeItemScore._meta.get_field('student').remote_field.model
    for student in student_model.objects.filter(id__in=student_ids):
        recompute_student_category_from_items(student, grade_category, schedule=None)
    return {
        'categories': len(student_ids),
        'periods': len(student_ids),
        'finals': len(student_ids),
    }


def _bulk_save(model, rows, existing, key, fields):
    creates = []
    updates = []
    field_attributes = tuple(
        (field_name, model._meta.get_field(field_name).attname)
        for field_name in fields
    )
    for row in rows:
        current = existing.get(key(row))
        if current is None:
            creates.append(row)
            continue
        for _field_name, attribute_name in field_attributes:
            setattr(current, attribute_name, getattr(row, attribute_name))
        updates.append(current)
    if creates:
        model.objects.bulk_create(creates, batch_size=500)
    if updates:
        model.objects.bulk_update(updates, fields, batch_size=500)


@transaction.atomic
def recompute_student_categories_bulk(affected):
    """Recompute schedule grades with bounded queries and bulk writes.

    ``affected`` contains ``(student_id, category_id, schedule_id)`` tuples.
    It is intentionally schedule-scoped; legacy rows without a schedule retain
    the existing single-record calculation path.
    """
    affected = {(int(student), int(category), int(schedule)) for student, category, schedule in affected}
    if not affected:
        return {'categories': 0, 'periods': 0, 'finals': 0}

    student_ids = {student for student, _, _ in affected}
    category_ids = {category for _, category, _ in affected}
    schedule_ids = {schedule for _, _, schedule in affected}
    categories = {
        category.id: category
        for category in GradeCategory.objects.filter(id__in=category_ids).select_related(
            'subject', 'subject__grading_policy',
        )
    }
    items = list(GradeItem.objects.filter(
        grade_category_id__in=category_ids,
        schedule_id__in=schedule_ids,
        is_required=True,
    ).only('id', 'grade_category_id', 'schedule_id', 'points_possible'))
    items_by_target = defaultdict(list)
    for item in items:
        items_by_target[(item.schedule_id, item.grade_category_id)].append(item)
    scores = {
        (score.student_id, score.grade_item_id): score
        for score in StudentGradeItemScore.objects.filter(
            student_id__in=student_ids,
            grade_item_id__in=[item.id for item in items],
        ).only('student_id', 'grade_item_id', 'raw_score', 'status')
    }
    existing_categories = {
        (row.schedule_id, row.student_id, row.grade_category_id): row
        for row in StudentCategoryGrade.objects.select_for_update().filter(
            schedule_id__in=schedule_ids,
            student_id__in=student_ids,
            grade_category_id__in=category_ids,
        )
    }
    now = timezone.now()
    category_rows = []
    empty_targets = []
    period_targets = set()
    for student_id, category_id, schedule_id in affected:
        category = categories[category_id]
        target_items = items_by_target[(schedule_id, category_id)]
        period_targets.add((student_id, category.subject_id, category.grading_period, schedule_id))
        if not target_items:
            empty_targets.append((schedule_id, student_id, category_id))
            continue
        resolved_scores = [
            scores[(student_id, item.id)]
            for item in target_items
            if (student_id, item.id) in scores
        ]
        required = len(target_items)
        resolved = len(resolved_scores)
        pending = required - resolved
        graded = [score for score in resolved_scores if score.status == StudentGradeItemScore.Status.GRADED]
        raw_score = total_score = transmuted_grade = weighted_score = None
        if pending:
            completion = GradeCompletionStatus.PENDING
            reason = f'{pending} required item(s) are unresolved.'
        elif not graded:
            completion = GradeCompletionStatus.NOT_APPLICABLE
            reason = 'Every required item is excused.'
        else:
            completion = GradeCompletionStatus.COMPLETE
            reason = ''
            raw_score = sum((score.raw_score for score in graded), Decimal('0'))
            graded_item_ids = {score.grade_item_id for score in graded}
            total_score = sum(
                (item.points_possible for item in target_items if item.id in graded_item_ids),
                Decimal('0'),
            )
            policy = getattr(category.subject, 'grading_policy', None)
            transmuted_grade = transmute_score(
                raw_score,
                total_score,
                getattr(policy, 'transmutation_base', Decimal('60')),
                getattr(policy, 'transmutation_scale', Decimal('40')),
            )
            weighted_score = transmuted_grade * category.weight / Decimal('100')
        category_rows.append(StudentCategoryGrade(
            schedule_id=schedule_id,
            subject_id=category.subject_id,
            student_id=student_id,
            grade_category_id=category_id,
            raw_score=raw_score,
            total_score=total_score,
            transmuted_grade=transmuted_grade,
            weighted_score=weighted_score,
            is_item_computed=True,
            completion_status=completion,
            required_item_count=required,
            resolved_item_count=resolved,
            pending_item_count=pending,
            withheld_reason=reason,
            computed_at=now,
        ))
    if empty_targets:
        empty_grade_ids = [
            existing_categories[target].id
            for target in empty_targets
            if target in existing_categories
        ]
        if empty_grade_ids:
            StudentCategoryGrade.objects.filter(id__in=empty_grade_ids).delete()
    category_fields = (
        'subject', 'raw_score', 'total_score', 'transmuted_grade', 'weighted_score',
        'is_item_computed', 'completion_status', 'required_item_count',
        'resolved_item_count', 'pending_item_count', 'withheld_reason', 'computed_at',
    )
    _bulk_save(
        StudentCategoryGrade,
        category_rows,
        existing_categories,
        lambda row: (row.schedule_id, row.student_id, row.grade_category_id),
        category_fields,
    )

    period_subject_ids = {subject for _, subject, _, _ in period_targets}
    period_names = {period for _, _, period, _ in period_targets}
    period_categories = list(GradeCategory.objects.filter(
        subject_id__in=period_subject_ids,
        grading_period__in=period_names,
    ))
    categories_by_period = defaultdict(list)
    for category in period_categories:
        categories_by_period[(category.subject_id, category.grading_period)].append(category)
    category_grades = defaultdict(dict)
    for grade in StudentCategoryGrade.objects.filter(
        schedule_id__in=schedule_ids,
        student_id__in=student_ids,
        grade_category_id__in=[category.id for category in period_categories],
    ).select_related('grade_category'):
        category_grades[(grade.schedule_id, grade.student_id, grade.grade_category.grading_period)][grade.grade_category_id] = grade
    existing_periods = {
        (row.schedule_id, row.student_id, row.grading_period): row
        for row in PeriodGrade.objects.select_for_update().filter(
            schedule_id__in=schedule_ids,
            student_id__in=student_ids,
            grading_period__in=period_names,
        )
    }
    period_rows = []
    final_targets = set()
    for student_id, subject_id, period, schedule_id in period_targets:
        configured = categories_by_period[(subject_id, period)]
        grades = category_grades[(schedule_id, student_id, period)]
        required = sum(grade.required_item_count for grade in grades.values())
        resolved = sum(grade.resolved_item_count for grade in grades.values())
        pending = sum(grade.pending_item_count for grade in grades.values())
        weights_valid = bool(configured) and sum(category.weight for category in configured) == Decimal('100')
        every_resolved = bool(configured) and all(
            category.id in grades
            and grades[category.id].completion_status in {
                GradeCompletionStatus.COMPLETE, GradeCompletionStatus.NOT_APPLICABLE,
            }
            and grades[category.id].required_item_count > 0
            for category in configured
        )
        raw_score = None
        completion = GradeCompletionStatus.PENDING
        reason = 'Required grade items are still pending.'
        if not weights_valid:
            reason = 'Category weights must total exactly 100%.'
        elif every_resolved:
            applicable = [grade for grade in grades.values() if grade.completion_status == GradeCompletionStatus.COMPLETE]
            if applicable:
                applicable_weight = sum(grade.grade_category.weight for grade in applicable)
                raw_score = sum(grade.weighted_score for grade in applicable) * Decimal('100') / applicable_weight
                completion = GradeCompletionStatus.COMPLETE
                reason = ''
            else:
                completion = GradeCompletionStatus.NOT_APPLICABLE
                reason = 'Every required item in this period is excused.'
        period_rows.append(PeriodGrade(
            schedule_id=schedule_id,
            subject_id=subject_id,
            student_id=student_id,
            grading_period=period,
            raw_score=raw_score,
            completion_status=completion,
            required_item_count=required,
            resolved_item_count=resolved,
            pending_item_count=max(required - resolved, pending),
            withheld_reason=reason,
            computed_at=now,
        ))
        final_targets.add((student_id, subject_id, schedule_id))
    period_fields = (
        'subject', 'raw_score', 'completion_status', 'required_item_count',
        'resolved_item_count', 'pending_item_count', 'withheld_reason', 'computed_at',
    )
    _bulk_save(
        PeriodGrade,
        period_rows,
        existing_periods,
        lambda row: (row.schedule_id, row.student_id, row.grading_period),
        period_fields,
    )

    subjects = {
        category.subject_id: category.subject
        for category in categories.values()
    }
    periods_by_student = defaultdict(dict)
    for grade in PeriodGrade.objects.filter(
        schedule_id__in=schedule_ids,
        student_id__in=student_ids,
    ):
        periods_by_student[(grade.schedule_id, grade.student_id)][grade.grading_period] = grade
    existing_finals = {
        (row.schedule_id, row.student_id): row
        for row in FinalGrade.objects.select_for_update().filter(
            schedule_id__in=schedule_ids,
            student_id__in=student_ids,
        )
    }
    final_rows = []
    for student_id, subject_id, schedule_id in final_targets:
        grades = periods_by_student[(schedule_id, student_id)]
        complete = all(
            period in grades and grades[period].completion_status == GradeCompletionStatus.COMPLETE
            for period in GradingPeriod.values
        )
        completed_count = sum(
            grade.completion_status == GradeCompletionStatus.COMPLETE
            for grade in grades.values()
        )
        values = {
            period: grades[period].raw_score
            if period in grades and grades[period].completion_status == GradeCompletionStatus.COMPLETE
            else None
            for period in GradingPeriod.values
        }
        subject = subjects[subject_id]
        policy = getattr(subject, 'grading_policy', None)
        weights = {
            GradingPeriod.PRELIM: getattr(policy, 'prelim_weight', Decimal('25')),
            GradingPeriod.MIDTERM: getattr(policy, 'midterm_weight', Decimal('25')),
            GradingPeriod.PREFINAL: getattr(policy, 'prefinal_weight', Decimal('25')),
            GradingPeriod.FINAL: getattr(policy, 'final_weight', Decimal('25')),
        }
        final_score = None
        if complete:
            final_score = sum(values[period] * weights[period] / Decimal('100') for period in GradingPeriod.values)
        final_rows.append(FinalGrade(
            schedule_id=schedule_id,
            subject_id=subject_id,
            student_id=student_id,
            prelim_grade=values[GradingPeriod.PRELIM],
            midterm_grade=values[GradingPeriod.MIDTERM],
            prefinal_grade=values[GradingPeriod.PREFINAL],
            final_period_grade=values[GradingPeriod.FINAL],
            final_grade=final_score,
            completion_status=GradeCompletionStatus.COMPLETE if complete else GradeCompletionStatus.PENDING,
            completed_period_count=completed_count,
            required_period_count=4,
            withheld_reason='' if complete else f'{4 - completed_count} grading period(s) are unresolved.',
            computed_at=now,
        ))
    final_fields = (
        'subject', 'prelim_grade', 'midterm_grade', 'prefinal_grade',
        'final_period_grade', 'final_grade', 'completion_status',
        'completed_period_count', 'required_period_count', 'withheld_reason', 'computed_at',
    )
    _bulk_save(
        FinalGrade,
        final_rows,
        existing_finals,
        lambda row: (row.schedule_id, row.student_id),
        final_fields,
    )
    return {
        'categories': len(category_rows),
        'periods': len(period_rows),
        'finals': len(final_rows),
    }
