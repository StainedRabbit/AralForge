from decimal import Decimal

from django.db.models import Sum

from .models import FinalGrade, PeriodGrade, StudentCategoryGrade, StudentGradeItemScore, transmute_score


def compute_student_category_grade(student, grade_category, raw_score, total_score, is_item_computed=False):
    transmuted_grade = transmute_score(raw_score, total_score)
    weighted_score = None

    if transmuted_grade is not None:
        weighted_score = transmuted_grade * (grade_category.weight / Decimal('100'))

    return StudentCategoryGrade.objects.update_or_create(
        student=student,
        subject=grade_category.subject,
        grade_category=grade_category,
        defaults={
            'raw_score': raw_score,
            'total_score': total_score,
            'transmuted_grade': transmuted_grade,
            'weighted_score': weighted_score,
            'is_item_computed': is_item_computed,
        },
    )[0]


def compute_period_grade(student, subject, grading_period):
    result = StudentCategoryGrade.objects.filter(
        student=student,
        subject=subject,
        grade_category__grading_period=grading_period,
    ).aggregate(total=Sum('weighted_score'))

    return PeriodGrade.objects.update_or_create(
        student=student,
        subject=subject,
        grading_period=grading_period,
        defaults={'raw_score': result['total']},
    )[0]


def compute_final_grade(student, subject):
    period_grades = {
        period_grade.grading_period: period_grade.raw_score
        for period_grade in PeriodGrade.objects.filter(student=student, subject=subject)
    }

    return FinalGrade.objects.update_or_create(
        student=student,
        subject=subject,
        defaults={
            'prelim_grade': period_grades.get('PRELIM'),
            'midterm_grade': period_grades.get('MIDTERM'),
            'prefinal_grade': period_grades.get('PREFINAL'),
            'final_period_grade': period_grades.get('FINAL'),
        },
    )[0]


def recompute_from_item_score(item_score):
    return recompute_student_category_from_items(
        item_score.student,
        item_score.grade_item.grade_category,
    )


def recompute_student_category_from_items(student, grade_category):
    item_scores = StudentGradeItemScore.objects.filter(
        student=student,
        grade_item__grade_category=grade_category,
    ).select_related('grade_item')

    if item_scores.exists():
        raw_score = sum((score.raw_score for score in item_scores), Decimal('0'))
        total_score = sum((score.grade_item.points_possible for score in item_scores), Decimal('0'))
        category_grade = compute_student_category_grade(
            student=student,
            grade_category=grade_category,
            raw_score=raw_score,
            total_score=total_score,
            is_item_computed=True,
        )
    else:
        StudentCategoryGrade.objects.filter(
            student=student,
            grade_category=grade_category,
            is_item_computed=True,
        ).delete()
        category_grade = StudentCategoryGrade.objects.filter(
            student=student,
            grade_category=grade_category,
        ).first()

    period_grade = compute_period_grade(
        student,
        grade_category.subject,
        grade_category.grading_period,
    )
    final_grade = compute_final_grade(student, grade_category.subject)
    return category_grade, period_grade, final_grade
