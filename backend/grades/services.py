from decimal import Decimal

from django.db.models import Sum

from .models import FinalGrade, PeriodGrade, StudentCategoryGrade, transmute_score


def compute_student_category_grade(student, grade_category, raw_score, total_score):
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
