from django.db.models import Count, Q, Sum
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from attendance.models import AttendanceSession
from gamification.models import PointLedger, StudentBadge
from learning_modules.models import (
    Module,
    ModuleActivity,
    ModuleActivityAttempt,
    ModuleActivitySubmission,
    ModuleProgress,
    active_module_access_filter,
    module_enrollment_filter,
)
from learning_modules.serializers import ModuleActivitySerializer, ModuleSerializer
from subjects.models import ScheduleStudent, SubjectSchedule
from subjects.scheduling import WEEKDAY_CODES


class NavigationView(APIView):
    def get(self, request):
        if request.user.is_admin_teacher:
            pending = ungraded_submissions().count()
            return Response({'role': 'teacher', 'pending_count': pending})

        visible_activities = visible_student_activities(request.user)
        submitted_ids = ModuleActivitySubmission.objects.filter(
            student=request.user,
            activity__in=visible_activities,
        ).values_list('activity_id', flat=True)
        return Response({
            'role': 'student',
            'pending_count': visible_activities.exclude(id__in=submitted_ids).count(),
        })


class DashboardView(APIView):
    def get(self, request):
        if request.user.is_admin_teacher:
            return Response(teacher_dashboard(request))
        return Response(student_dashboard(request))


def visible_student_modules(user):
    return Module.objects.select_related('subject').prefetch_related('subjects').filter(
        is_published=True,
    ).filter(
        module_enrollment_filter(user) | active_module_access_filter(user),
    ).distinct()


def visible_student_activities(user):
    return ModuleActivity.objects.filter(
        is_published=True,
        module__in=visible_student_modules(user),
    )


def student_dashboard(request):
    user = request.user
    modules = visible_student_modules(user)
    activities = visible_student_activities(user)
    submissions = ModuleActivitySubmission.objects.filter(student=user)
    submitted_activity_ids = submissions.values_list('activity_id', flat=True)
    upcoming = activities.exclude(id__in=submitted_activity_ids).order_by(
        'due_at', 'order', 'id',
    )[:5]
    recent_modules = modules.order_by('-updated_at')[:4]
    points = PointLedger.objects.filter(student=user).aggregate(total=Sum('points'))['total'] or 0

    return {
        'role': 'student',
        'metrics': {
            'module_count': modules.count(),
            'completed_modules': ModuleProgress.objects.filter(
                student=user,
                module__in=modules,
                completed_at__isnull=False,
            ).count(),
            'pending_activities': activities.exclude(id__in=submitted_activity_ids).count(),
            'submitted_activities': submissions.filter(activity__in=activities).count(),
            'total_points': points,
            'earned_badges': StudentBadge.objects.filter(student=user).count(),
        },
        'recent_modules': ModuleSerializer(recent_modules, many=True, context={'request': request}).data,
        'upcoming_activities': ModuleActivitySerializer(upcoming, many=True, context={'request': request}).data,
    }


def teacher_dashboard(request):
    today = timezone.localdate()
    weekday_code = WEEKDAY_CODES[today.weekday()]
    active_schedules = SubjectSchedule.objects.filter(
        is_active=True,
        school_year_semester__is_active=True,
    )
    today_schedules = list(
        active_schedules.filter(days__contains=weekday_code)
        .select_related('subject', 'school_year_semester')
        .annotate(
            active_student_count=Count(
                'students',
                filter=Q(students__is_active=True),
                distinct=True,
            ),
        )
        .order_by('start_time', 'subject__code', 'section', 'id')
    )
    schedule_ids = [schedule.id for schedule in today_schedules]
    sessions = AttendanceSession.objects.filter(
        date=today,
        schedule_id__in=schedule_ids,
    ).annotate(
        record_count=Count('records', distinct=True),
        roster_count=Count('roster_students', distinct=True),
    ).order_by('schedule_id', '-created_at', '-id')
    sessions_by_schedule = {}
    for session in sessions:
        sessions_by_schedule.setdefault(session.schedule_id, session)

    today_class_data = []
    for schedule in today_schedules:
        session = sessions_by_schedule.get(schedule.id)
        roster_count = session.roster_count if session else schedule.active_student_count
        record_count = session.record_count if session else 0
        if session and roster_count > 0 and record_count >= roster_count:
            attendance_status = 'COMPLETE'
        elif session and record_count > 0:
            attendance_status = 'IN_PROGRESS'
        else:
            attendance_status = 'NOT_STARTED'
        today_class_data.append({
            'schedule_id': schedule.id,
            'subject_code': schedule.subject.code,
            'subject_name': schedule.subject.name,
            'section': schedule.section,
            'room': schedule.room,
            'days': schedule.days,
            'start_time': schedule.start_time,
            'end_time': schedule.end_time,
            'active_student_count': schedule.active_student_count,
            'attendance_session_id': session.id if session else None,
            'attendance_record_count': record_count,
            'attendance_status': attendance_status,
        })

    attention_queryset = ungraded_submissions().select_related(
        'activity__module',
        'student',
    ).order_by('submitted_at', 'id')
    attention_items = [
        {
            'id': submission.id,
            'student_id': submission.student_id,
            'student_name': submission.student.get_full_name().strip() or submission.student.username,
            'activity_id': submission.activity_id,
            'activity_title': submission.activity.title,
            'module_id': submission.activity.module_id,
            'module_title': submission.activity.module.title,
            'submitted_at': submission.submitted_at,
            'has_file': bool(submission.file),
        }
        for submission in attention_queryset[:8]
    ]

    recent_activity = teacher_recent_activity(today)
    active_student_count = ScheduleStudent.objects.filter(
        is_active=True,
        schedule__in=active_schedules,
    ).values('student_id').distinct().count()

    return {
        'role': 'teacher',
        'metrics': {
            'attention_count': attention_queryset.count(),
            'today_class_count': len(today_class_data),
            'attendance_complete_count': sum(
                item['attendance_status'] == 'COMPLETE'
                for item in today_class_data
            ),
            'active_class_count': active_schedules.count(),
            'active_student_count': active_student_count,
        },
        'attention_items': attention_items,
        'today_classes': today_class_data,
        'recent_activity': recent_activity,
    }


def ungraded_submissions():
    return ModuleActivitySubmission.objects.filter(
        graded_at__isnull=True,
        activity__activity_type__in=(
            ModuleActivity.ActivityType.TEXT,
            ModuleActivity.ActivityType.FILE_UPLOAD,
        ),
    )


def teacher_recent_activity(today):
    events = []
    attempts = ModuleActivityAttempt.objects.filter(
        status=ModuleActivityAttempt.Status.SUBMITTED,
    ).select_related(
        'activity__module',
        'student',
    ).order_by('-submitted_at', '-id')[:6]
    for attempt in attempts:
        student_name = attempt.student.get_full_name().strip() or attempt.student.username
        events.append({
            'kind': 'ACTIVITY_ATTEMPT',
            'id': attempt.id,
            'title': f'{student_name} completed {attempt.activity.title}',
            'detail': attempt.activity.module.title,
            'occurred_at': attempt.submitted_at or attempt.started_at,
            'module_id': attempt.activity.module_id,
            'submission_id': None,
            'schedule_id': None,
            'attendance_session_id': None,
        })

    reviewed = ModuleActivitySubmission.objects.filter(
        graded_at__isnull=False,
    ).select_related(
        'activity__module',
        'student',
    ).order_by('-graded_at', '-id')[:6]
    for submission in reviewed:
        student_name = submission.student.get_full_name().strip() or submission.student.username
        events.append({
            'kind': 'SUBMISSION_REVIEW',
            'id': submission.id,
            'title': f'{student_name} received feedback for {submission.activity.title}',
            'detail': submission.activity.module.title,
            'occurred_at': submission.graded_at,
            'module_id': submission.activity.module_id,
            'submission_id': submission.id,
            'schedule_id': None,
            'attendance_session_id': None,
        })

    attendance = AttendanceSession.objects.filter(
        date__lte=today,
        schedule__isnull=False,
    ).select_related(
        'schedule__subject',
    ).order_by('-created_at', '-id')[:6]
    for session in attendance:
        class_name = session.schedule.subject.code
        if session.schedule.section:
            class_name = f'{class_name} {session.schedule.section}'
        events.append({
            'kind': 'ATTENDANCE',
            'id': session.id,
            'title': f'Attendance recorded for {class_name}',
            'detail': session.title or 'Class attendance',
            'occurred_at': session.created_at,
            'module_id': None,
            'submission_id': None,
            'schedule_id': session.schedule_id,
            'attendance_session_id': session.id,
        })

    return sorted(
        events,
        key=lambda item: item['occurred_at'],
        reverse=True,
    )[:6]
