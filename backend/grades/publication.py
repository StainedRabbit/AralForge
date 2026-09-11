import hashlib
import json
from decimal import Decimal

from rest_framework.exceptions import ValidationError

from subjects.models import ScheduleStudent

from .models import (
    FinalGrade,
    GradeCategory,
    GradeItem,
    GradePublication,
    PeriodGrade,
    StudentCategoryGrade,
    StudentGradeItemScore,
)


def build_publication_snapshots(schedule, period):
    enrollments = list(ScheduleStudent.objects.filter(
        schedule=schedule,
        is_active=True,
        student__is_active=True,
    ).select_related('student').order_by('student_id'))
    if not enrollments:
        raise ValidationError({'schedule': 'This class has no active students to publish.'})

    student_ids = [item.student_id for item in enrollments]
    if period == GradePublication.Period.OVERALL:
        grades = {grade.student_id: grade for grade in FinalGrade.objects.filter(
            schedule=schedule, student_id__in=student_ids,
        )}
        missing = [item.student_id for item in enrollments if not _ready(grades.get(item.student_id))]
        if missing:
            raise ValidationError({'period': f'Final grades are incomplete for student IDs: {missing}.'})
        return [snapshot_record(schedule, item.student, period, final=grades[item.student_id]) for item in enrollments]

    grades = {grade.student_id: grade for grade in PeriodGrade.objects.filter(
        schedule=schedule, student_id__in=student_ids, grading_period=period,
    )}
    missing = [item.student_id for item in enrollments if not _ready(grades.get(item.student_id))]
    if missing:
        raise ValidationError({'period': f'{period.title()} grades are incomplete for student IDs: {missing}.'})

    categories = list(GradeCategory.objects.filter(
        subject=schedule.subject, grading_period=period,
    ).order_by('category', 'name', 'id'))
    category_grades = {
        (grade.student_id, grade.grade_category_id): grade
        for grade in StudentCategoryGrade.objects.filter(
            schedule=schedule, student_id__in=student_ids,
            grade_category__grading_period=period,
        )
    }
    items = list(GradeItem.objects.filter(
        schedule=schedule, grade_category__grading_period=period,
    ).select_related('grade_category').order_by('order', 'date', 'id'))
    scores = {
        (score.student_id, score.grade_item_id): score
        for score in StudentGradeItemScore.objects.filter(
            grade_item__schedule=schedule,
            grade_item__grade_category__grading_period=period,
            student_id__in=student_ids,
        )
    }
    return [
        snapshot_record(
            schedule,
            enrollment.student,
            period,
            period_grade=grades[enrollment.student_id],
            categories=categories,
            category_grades=category_grades,
            items=items,
            scores=scores,
        )
        for enrollment in enrollments
    ]


def snapshot_digest(snapshot):
    canonical = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(canonical.encode('utf-8')).hexdigest()


def snapshot_record(schedule, student, period, *, period_grade=None, final=None, categories=(), category_grades=None, items=(), scores=None):
    category_grades = category_grades or {}
    scores = scores or {}
    payload = {
        'schedule': {
            'id': schedule.id,
            'subject_code': schedule.subject.code,
            'subject_name': schedule.subject.name,
            'section': schedule.section,
            'term_name': schedule.school_year_semester.name,
        },
        'student_id': student.id,
        'period': period,
        'summary': (
            {
                'raw_score': decimal_string(period_grade.raw_score),
                'remarks': period_grade.remarks,
                'completion_status': period_grade.completion_status,
            }
            if period_grade else {
                'prelim_grade': decimal_string(final.prelim_grade),
                'midterm_grade': decimal_string(final.midterm_grade),
                'prefinal_grade': decimal_string(final.prefinal_grade),
                'final_period_grade': decimal_string(final.final_period_grade),
                'final_grade': decimal_string(final.final_grade),
                'remarks': final.remarks,
                'completion_status': final.completion_status,
            }
        ),
        'categories': [],
        'items': [],
    }
    for category in categories:
        grade = category_grades.get((student.id, category.id))
        payload['categories'].append({
            'id': category.id,
            'name': category.name,
            'category': category.category,
            'weight': decimal_string(category.weight),
            'raw_score': decimal_string(grade.raw_score) if grade else None,
            'total_score': decimal_string(grade.total_score) if grade else None,
            'weighted_score': decimal_string(grade.weighted_score) if grade else None,
            'completion_status': grade.completion_status if grade else 'PENDING',
        })
    for item in items:
        score = scores.get((student.id, item.id))
        payload['items'].append({
            'id': item.id,
            'title': item.title,
            'date': item.date.isoformat() if item.date else None,
            'points_possible': decimal_string(item.points_possible),
            'category_id': item.grade_category_id,
            'raw_score': decimal_string(score.raw_score) if score else None,
            'status': score.status if score else 'PENDING',
            'remarks': score.remarks if score else '',
        })
    return payload


def decimal_string(value):
    if value is None:
        return None
    if isinstance(value, Decimal):
        return format(value, 'f')
    return str(value)


def _ready(grade):
    return grade and grade.completion_status in {'COMPLETE', 'NOT_APPLICABLE'}
