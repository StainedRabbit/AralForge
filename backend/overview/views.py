from django.db.models import Q, Sum
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import StudentProfile, User
from attendance.models import AttendanceSession
from attendance.serializers import AttendanceSessionSerializer
from coding.models import CodeBlank, CodeSubmission, ProgrammingProblem
from gamification.models import PointLedger, StudentBadge
from learning_modules.models import (
    Module,
    ModuleAccess,
    ModuleActivity,
    ModuleActivityAttempt,
    ModuleActivityQuestion,
    ModuleActivitySubmission,
    ModuleProgress,
    active_module_access_filter,
    module_enrollment_filter,
)
from learning_modules.serializers import (
    ModuleAccessSerializer,
    ModuleActivitySerializer,
    ModuleActivityAttemptSummarySerializer,
    ModuleActivitySubmissionSerializer,
    ModuleSerializer,
)
from subjects.models import SubjectSchedule


class NavigationView(APIView):
    def get(self, request):
        if request.user.is_admin_teacher:
            pending = (
                ModuleActivitySubmission.objects.filter(score__isnull=True).count()
                + CodeSubmission.objects.filter(score__isnull=True).count()
            )
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
    problems = ProgrammingProblem.objects.filter(
        is_published=True,
    ).filter(
        Q(module__in=modules) | Q(module__isnull=True),
    ).distinct()
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
            'problem_count': problems.count(),
            'blank_count': CodeBlank.objects.filter(problem__in=problems).count(),
            'total_points': points,
            'earned_badges': StudentBadge.objects.filter(student=user).count(),
        },
        'recent_modules': ModuleSerializer(recent_modules, many=True, context={'request': request}).data,
        'upcoming_activities': ModuleActivitySerializer(upcoming, many=True, context={'request': request}).data,
    }


def teacher_dashboard(request):
    ungraded_submissions = ModuleActivitySubmission.objects.filter(
        score__isnull=True,
    ).select_related('activity', 'student').order_by('-submitted_at')
    recent_activity_attempts = ModuleActivityAttempt.objects.select_related(
        'activity', 'student',
    ).order_by('-started_at')[:8]
    recent_access = ModuleAccess.objects.select_related(
        'module', 'student', 'activated_by',
    ).order_by('-updated_at')[:8]
    recent_attendance = AttendanceSession.objects.select_related(
        'subject', 'schedule', 'school_year_semester',
    ).order_by('-date', '-id')[:8]
    today = timezone.localdate()

    return {
        'role': 'teacher',
        'metrics': {
            'student_count': User.objects.filter(role=User.Role.STUDENT).count(),
            'profile_count': StudentProfile.objects.count(),
            'module_count': Module.objects.count(),
            'published_modules': Module.objects.filter(is_published=True).count(),
            'main_activity_count': ModuleActivity.objects.count(),
            'activity_question_count': ModuleActivityQuestion.objects.count(),
            'grade_queue': ungraded_submissions.count(),
            'module_grants': ModuleAccess.objects.count(),
            'active_module_grants': ModuleAccess.objects.filter(
                is_active=True,
                activated_by__isnull=False,
                expires_at__gt=timezone.now(),
            ).count(),
            'schedule_count': SubjectSchedule.objects.count(),
            'problem_count': ProgrammingProblem.objects.count(),
            'attendance_today': AttendanceSession.objects.filter(date=today).count(),
        },
        'ungraded_submissions': ModuleActivitySubmissionSerializer(
            ungraded_submissions[:8], many=True, context={'request': request},
        ).data,
        'recent_activity_attempts': ModuleActivityAttemptSummarySerializer(
            recent_activity_attempts, many=True, context={'request': request},
        ).data,
        'recent_module_access': ModuleAccessSerializer(
            recent_access, many=True, context={'request': request},
        ).data,
        'recent_attendance': AttendanceSessionSerializer(
            recent_attendance, many=True, context={'request': request},
        ).data,
    }
