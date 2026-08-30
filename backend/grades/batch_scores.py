from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied

from accounts.models import User
from subjects.models import ScheduleStudent

from .models import GradeItem, StudentGradeItemScore
from .services import recompute_student_categories_bulk


@transaction.atomic
def apply_score_batch(user, changes):
    if not user.is_admin_teacher:
        raise PermissionDenied('Only teachers can record gradebook scores.')
    if not isinstance(changes, list) or not changes:
        raise serializers.ValidationError({'changes': 'Provide at least one score change.'})
    if len(changes) > 500:
        raise serializers.ValidationError({'changes': 'A batch is limited to 500 score changes.'})

    normalized = []
    errors = {}
    seen = set()
    item_ids = set()
    student_ids = set()
    for index, change in enumerate(changes):
        if not isinstance(change, dict):
            errors[str(index)] = {'detail': 'Each change must be an object.'}
            continue
        try:
            item_id = int(change.get('grade_item'))
            student_id = int(change.get('student'))
        except (TypeError, ValueError):
            errors[str(index)] = {'detail': 'grade_item and student must be integers.'}
            continue
        operation = str(change.get('operation') or 'upsert').strip().lower()
        if operation not in {'upsert', 'delete'}:
            errors[str(index)] = {'operation': 'Use upsert or delete.'}
            continue
        key = (item_id, student_id)
        if key in seen:
            errors[str(index)] = {'detail': 'This score appears more than once in the batch.'}
            continue
        seen.add(key)
        item_ids.add(item_id)
        student_ids.add(student_id)
        normalized.append((index, operation, item_id, student_id, change))

    items = {
        item.id: item
        for item in GradeItem.objects.filter(id__in=item_ids).select_related(
            'schedule', 'grade_category', 'grade_category__subject',
        )
    }
    students = {student.id: student for student in User.objects.filter(id__in=student_ids)}
    enrolled = set(ScheduleStudent.objects.filter(
        schedule_id__in={item.schedule_id for item in items.values() if item.schedule_id},
        student_id__in=student_ids,
    ).values_list('schedule_id', 'student_id'))
    existing = {
        (score.grade_item_id, score.student_id): score
        for score in StudentGradeItemScore.objects.select_for_update().filter(
            grade_item_id__in=item_ids,
            student_id__in=student_ids,
        )
    }

    prepared = []
    for index, operation, item_id, student_id, change in normalized:
        item = items.get(item_id)
        student = students.get(student_id)
        row_errors = {}
        if not item:
            row_errors['grade_item'] = 'Unknown grade item.'
        elif not item.schedule_id:
            row_errors['grade_item'] = 'Assign this grade item to a class before recording scores.'
        elif (item.schedule_id, student_id) not in enrolled:
            row_errors['student'] = 'This student is not enrolled in the selected class.'
        if not student:
            row_errors['student'] = 'Unknown student.'

        score = existing.get((item_id, student_id))
        if score and score.origin == StudentGradeItemScore.Origin.AUTOMATIC:
            row_errors['detail'] = 'Use the override action to change an automatically synchronized score.'

        status_value = str(change.get('status') or StudentGradeItemScore.Status.GRADED).upper()
        raw_score = None
        remarks = str(change.get('remarks') or '')
        if operation == 'upsert':
            if status_value not in StudentGradeItemScore.Status.values:
                row_errors['status'] = 'Use GRADED or EXCUSED.'
            if len(remarks) > 160:
                row_errors['remarks'] = 'Ensure this field has no more than 160 characters.'
            if status_value != StudentGradeItemScore.Status.EXCUSED:
                try:
                    raw_score = Decimal(str(change.get('raw_score')))
                except (InvalidOperation, TypeError, ValueError):
                    row_errors['raw_score'] = 'A graded score requires a valid number.'
                if item and raw_score is not None and (raw_score < 0 or raw_score > item.points_possible):
                    row_errors['raw_score'] = 'Score must be between zero and points possible.'

        if row_errors:
            errors[str(index)] = row_errors
        else:
            prepared.append((operation, item, student, score, raw_score, status_value, remarks))

    if errors:
        raise serializers.ValidationError({'changes': errors})

    now = timezone.now()
    creates = []
    updates = []
    delete_ids = []
    deleted_keys = []
    affected = set()
    changed_keys = []
    for operation, item, student, score, raw_score, status_value, remarks in prepared:
        affected.add((student.id, item.grade_category_id, item.schedule_id))
        if operation == 'delete':
            if score:
                delete_ids.append(score.id)
                deleted_keys.append({'grade_item': item.id, 'student': student.id})
            continue
        changed_keys.append((item.id, student.id))
        if score:
            score.raw_score = raw_score
            score.status = status_value
            score.remarks = remarks
            score.computed_at = now
            updates.append(score)
        else:
            creates.append(StudentGradeItemScore(
                grade_item=item,
                student=student,
                raw_score=raw_score,
                status=status_value,
                remarks=remarks,
                origin=StudentGradeItemScore.Origin.MANUAL,
            ))

    if delete_ids:
        StudentGradeItemScore.objects.filter(id__in=delete_ids).delete()
    if creates:
        StudentGradeItemScore.objects.bulk_create(creates, batch_size=500)
    if updates:
        StudentGradeItemScore.objects.bulk_update(
            updates, ('raw_score', 'status', 'remarks', 'computed_at'), batch_size=500,
        )

    recompute_student_categories_bulk(affected)
    changed_key_set = set(changed_keys)
    updated = [
        score
        for score in StudentGradeItemScore.objects.filter(
            grade_item_id__in={key[0] for key in changed_keys},
            student_id__in={key[1] for key in changed_keys},
        ).select_related(
            'grade_item', 'grade_item__grade_category', 'grade_item__grade_category__subject',
            'grade_item__schedule', 'student',
        )
        if (score.grade_item_id, score.student_id) in changed_key_set
    ] if changed_keys else []
    return {'updated': updated, 'deleted': deleted_keys}
