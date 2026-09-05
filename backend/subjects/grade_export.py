import csv
from itertools import islice

from django.http import HttpResponse
from django.utils.text import slugify

from grades.models import (
    FinalGrade, GradeCategory, GradeItem, GradingPeriod, PeriodGrade,
    StudentCategoryGrade, StudentGradeItemScore,
)


def safe_cell(value):
    if value is None:
        return ''
    if not isinstance(value, str):
        return value
    if value.lstrip().startswith(('=', '+', '-', '@')) or value.startswith(('\t', '\r', '\n')):
        return "'" + value
    return value


def detailed_grades_csv(schedule, enrollments):
    """Read stored grades in student batches; never trigger grade recalculation."""
    categories = list(GradeCategory.objects.filter(subject_id=schedule.subject_id).order_by('category', 'id'))
    items = list(GradeItem.objects.filter(schedule=schedule).order_by('order', 'id'))
    groups = [(period, label, [category for category in categories if category.grading_period == period])
              for period, label in GradingPeriod.choices]
    items_by_category = {category.id: [item for item in items if item.grade_category_id == category.id]
                         for category in categories}
    headers = ['Student', 'Student number', 'Email', 'Status', 'Subject', 'Section', 'Term']
    category_fields = ('raw_score', 'total_score', 'transmuted_grade', 'weighted_score', 'completion_status')
    for period, label, period_categories in groups:
        for category in period_categories:
            prefix = f'{label} / {category.name} [{category.id}]'
            for item in items_by_category[category.id]:
                item_prefix = f'{prefix} / {item.title} [item {item.id}, max {item.points_possible}]'
                headers.extend(f'{item_prefix} / {suffix}' for suffix in ('Score', 'Status'))
            headers.extend(f'{prefix} / {suffix}' for suffix in (
                'Earned total', 'Possible total', 'Transmuted grade',
                f'Weighted grade ({category.weight}%)', 'Completion status',
            ))
        headers.extend((f'{label} period grade', f'{label} completion status'))
    headers.extend(('Overall course grade', 'Overall completion status', 'Remarks'))
    response = HttpResponse(content_type='text/csv; charset=utf-8')
    filename = f'{slugify(schedule.subject.code) or "subject"}-{slugify(schedule.section) or "class"}-detailed-grades.csv'
    response['Content-Disposition'] = f'attachment; filename="{filename}"'
    response['Cache-Control'] = 'no-store'
    response.write('\ufeff')
    writer = csv.writer(response)
    writer.writerow([safe_cell(value) for value in headers])
    iterator = enrollments.iterator(chunk_size=500)
    while batch := list(islice(iterator, 500)):
        student_ids = [enrollment.student_id for enrollment in batch]
        scores = {(score.student_id, score.grade_item_id): score for score in
                  StudentGradeItemScore.objects.filter(grade_item__schedule=schedule, student_id__in=student_ids)}
        category_grades = {(grade.student_id, grade.grade_category_id): grade for grade in
                           StudentCategoryGrade.objects.filter(schedule=schedule, student_id__in=student_ids)}
        periods = {(grade.student_id, grade.grading_period): grade for grade in
                   PeriodGrade.objects.filter(schedule=schedule, student_id__in=student_ids)}
        finals = {grade.student_id: grade for grade in
                  FinalGrade.objects.filter(schedule=schedule, student_id__in=student_ids)}
        for enrollment in batch:
            student = enrollment.student
            row = [student.get_full_name() or student.username,
                   getattr(getattr(student, 'student_profile', None), 'student_number', student.username),
                   student.email, 'Active' if enrollment.is_active else 'Inactive',
                   f'{schedule.subject.code} {schedule.subject.name}', schedule.section,
                   str(schedule.school_year_semester)]
            for period, label, period_categories in groups:
                for category in period_categories:
                    for item in items_by_category[category.id]:
                        score = scores.get((student.id, item.id))
                        row.extend((score.raw_score if score else None,
                                    score.status if score and (score.raw_score is not None or score.status == 'EXCUSED') else 'PENDING'))
                    grade = category_grades.get((student.id, category.id))
                    row.extend(getattr(grade, field, 'PENDING' if field == 'completion_status' else None)
                               for field in category_fields)
                grade = periods.get((student.id, period))
                row.extend((grade.raw_score if grade else None, grade.completion_status if grade else 'PENDING'))
            final = finals.get(student.id)
            row.extend((final.final_grade if final else None,
                        final.completion_status if final else 'PENDING', final.remarks if final else ''))
            writer.writerow([safe_cell(value) for value in row])
    return response
