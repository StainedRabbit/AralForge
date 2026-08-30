import os
from datetime import date, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from accounts.models import StudentProfile, User
from attendance.models import AttendanceRecord, AttendanceSession
from grades.models import (
    GradeCategory,
    GradeCategoryChoices,
    GradeItem,
    GradingPeriod,
    StudentGradeItemScore,
)
from learning_modules.models import (
    LearningContextType,
    Module,
    ModuleActivity,
    ModuleActivityAttempt,
    ModuleActivitySubmission,
    ModuleLesson,
    ModuleLessonProgress,
    ModuleProgress,
    ModuleTopic,
    ModuleTopicProgress,
)
from subjects.models import (
    ScheduleStudent,
    SchoolYear,
    SchoolYearSemester,
    Semester,
    Subject,
    SubjectSchedule,
)


class Command(BaseCommand):
    help = 'Create a staging-only, production-shaped performance dataset.'

    def add_arguments(self, parser):
        parser.add_argument('--students', type=int, default=10_000)
        parser.add_argument('--schedules', type=int, default=800)
        parser.add_argument('--classes-per-student', type=int, default=8)
        parser.add_argument('--grade-items-per-class', type=int, default=25)
        parser.add_argument('--attendance-sessions-per-class', type=int, default=10)
        parser.add_argument('--lessons-per-module', type=int, default=3)
        parser.add_argument('--confirm', action='store_true')

    def handle(self, *args, **options):
        if not options['confirm']:
            raise CommandError('Pass --confirm to create the performance fixture.')
        if os.getenv('ALLOW_PERFORMANCE_SEED', '').strip().lower() not in {'1', 'true', 'yes'}:
            raise CommandError('Set ALLOW_PERFORMANCE_SEED=true in the isolated staging environment.')
        if User.objects.filter(username__startswith='perf_student_').exists():
            raise CommandError('Performance students already exist; use a fresh staging database.')

        student_count = max(options['students'], 1)
        schedule_count = max(options['schedules'], 1)
        classes_per_student = min(max(options['classes_per_student'], 1), schedule_count)
        items_per_class = max(options['grade_items_per_class'], 0)
        sessions_per_class = max(options['attendance_sessions_per_class'], 0)
        lessons_per_module = max(options['lessons_per_module'], 1)

        with transaction.atomic():
            students = [
                User(
                    username=f'perf_student_{index:05d}',
                    first_name='Performance',
                    last_name=f'Student {index:05d}',
                    email=f'perf_student_{index:05d}@example.test',
                    role=User.Role.STUDENT,
                    password='!',
                )
                for index in range(student_count)
            ]
            User.objects.bulk_create(students, batch_size=1000)
            StudentProfile.objects.bulk_create([
                StudentProfile(user=student, student_number=f'PERF-{index:05d}')
                for index, student in enumerate(students)
            ], batch_size=1000)

            school_year = SchoolYear.objects.create(start_year=2090, end_year=2091)
            term = SchoolYearSemester.objects.create(
                school_year=school_year,
                semester=Semester.FIRST,
            )
            subject_count = max(1, (schedule_count + 9) // 10)
            subjects = [
                Subject(code=f'PERF{index:03d}', name=f'Performance Subject {index:03d}')
                for index in range(subject_count)
            ]
            Subject.objects.bulk_create(subjects, batch_size=500)
            schedules = [
                SubjectSchedule(
                    subject=subjects[index % subject_count],
                    school_year_semester=term,
                    days='MWF',
                    start_time=time(8 + (index % 8), 0),
                    end_time=time(9 + (index % 8), 0),
                    section=f'PERF-{index:04d}',
                )
                for index in range(schedule_count)
            ]
            SubjectSchedule.objects.bulk_create(schedules, batch_size=500)
            schedule_index_by_id = {
                schedule.id: index for index, schedule in enumerate(schedules)
            }

            enrollments = []
            for student_index, student in enumerate(students):
                base = (student_index * classes_per_student) % schedule_count
                for class_index in range(classes_per_student):
                    enrollments.append(ScheduleStudent(
                        schedule=schedules[(base + class_index) % schedule_count],
                        student=student,
                    ))
            ScheduleStudent.objects.bulk_create(enrollments, batch_size=5000)
            enrollments_by_schedule = {}
            for enrollment in enrollments:
                enrollments_by_schedule.setdefault(enrollment.schedule_id, []).append(enrollment)

            modules = [
                Module(
                    title=f'Performance Module {index:04d}',
                    slug=f'performance-module-{index:04d}',
                    description='Compact list content for production-shaped load testing.',
                    content='Deferred authoring content for production-shaped load testing.',
                    is_published=True,
                )
                for index in range(schedule_count)
            ]
            Module.objects.bulk_create(modules, batch_size=500)
            topics = [
                ModuleTopic(
                    module=module,
                    title='Performance topic',
                    overview='Representative topic detail.',
                    is_published=True,
                )
                for module in modules
            ]
            ModuleTopic.objects.bulk_create(topics, batch_size=500)
            lessons = []
            for topic in topics:
                for lesson_index in range(lessons_per_module):
                    lessons.append(ModuleLesson(
                        topic=topic,
                        title=f'Performance lesson {lesson_index + 1}',
                        order=lesson_index,
                        short_discussion='Representative lesson content.',
                        is_published=True,
                    ))
            ModuleLesson.objects.bulk_create(lessons, batch_size=2000)
            first_lesson_by_topic = {}
            lessons_by_topic = {}
            for lesson in lessons:
                lessons_by_topic.setdefault(lesson.topic_id, []).append(lesson)
                first_lesson_by_topic.setdefault(lesson.topic_id, lesson)
            activities = [
                ModuleActivity(
                    module=module,
                    topic=topic,
                    lesson=first_lesson_by_topic[topic.id],
                    title='Performance Main Activity',
                    instructions='Submit a representative response.',
                    activity_type=ModuleActivity.ActivityType.INTERACTIVE,
                    points_possible=Decimal('100.00'),
                    is_published=True,
                )
                for module, topic in zip(modules, topics)
            ]
            ModuleActivity.objects.bulk_create(activities, batch_size=500)

            categories = [
                GradeCategory(
                    subject=subject,
                    grading_period=GradingPeriod.PRELIM,
                    category=GradeCategoryChoices.QUIZ,
                    name='Performance quizzes',
                    weight=Decimal('100.00'),
                )
                for subject in subjects
            ]
            GradeCategory.objects.bulk_create(categories, batch_size=500)
            category_by_subject = {category.subject_id: category for category in categories}
            items = []
            for schedule in schedules:
                for item_index in range(items_per_class):
                    items.append(GradeItem(
                        schedule=schedule,
                        grade_category=category_by_subject[schedule.subject_id],
                        title=f'Performance item {item_index + 1}',
                        points_possible=Decimal('100.00'),
                        order=item_index,
                    ))
            GradeItem.objects.bulk_create(items, batch_size=5000)
            items_by_schedule = {}
            for item in items:
                items_by_schedule.setdefault(item.schedule_id, []).append(item)

            score_batch = []
            score_count = 0
            for enrollment in enrollments:
                for item in items_by_schedule.get(enrollment.schedule_id, ()):
                    score_batch.append(StudentGradeItemScore(
                        grade_item=item,
                        student=enrollment.student,
                        raw_score=Decimal('85.00'),
                    ))
                    if len(score_batch) >= 5000:
                        StudentGradeItemScore.objects.bulk_create(score_batch, batch_size=5000)
                        score_count += len(score_batch)
                        score_batch.clear()
            if score_batch:
                StudentGradeItemScore.objects.bulk_create(score_batch, batch_size=5000)
                score_count += len(score_batch)

            attendance_sessions = []
            first_session_date = date(2090, 8, 1)
            for schedule in schedules:
                for session_index in range(sessions_per_class):
                    attendance_sessions.append(AttendanceSession(
                        schedule=schedule,
                        subject=schedule.subject,
                        school_year_semester=term,
                        title=f'Meeting {session_index + 1}',
                        date=first_session_date + timedelta(days=session_index),
                    ))
            AttendanceSession.objects.bulk_create(attendance_sessions, batch_size=2000)
            sessions_by_schedule = {}
            for session in attendance_sessions:
                sessions_by_schedule.setdefault(session.schedule_id, []).append(session)

            attendance_batch = []
            attendance_count = 0
            for schedule_id, schedule_enrollments in enrollments_by_schedule.items():
                for session in sessions_by_schedule.get(schedule_id, ()):
                    for enrollment in schedule_enrollments:
                        attendance_batch.append(AttendanceRecord(
                            session=session,
                            student=enrollment.student,
                            status=AttendanceRecord.Status.PRESENT,
                            points_earned=Decimal('1.00'),
                        ))
                        if len(attendance_batch) >= 5000:
                            AttendanceRecord.objects.bulk_create(attendance_batch, batch_size=5000)
                            attendance_count += len(attendance_batch)
                            attendance_batch.clear()
            if attendance_batch:
                AttendanceRecord.objects.bulk_create(attendance_batch, batch_size=5000)
                attendance_count += len(attendance_batch)

            progress_batch = []
            topic_progress_batch = []
            lesson_progress_batch = []
            attempt_batch = []
            submission_batch = []
            progress_count = 0
            lesson_progress_count = 0
            attempt_count = 0
            submission_count = 0
            submitted_at = timezone.now()
            for enrollment in enrollments:
                schedule_index = schedule_index_by_id[enrollment.schedule_id]
                module = modules[schedule_index]
                topic = topics[schedule_index]
                activity = activities[schedule_index]
                progress_batch.append(ModuleProgress(
                    module=module,
                    student=enrollment.student,
                    schedule=enrollment.schedule,
                    context_type=LearningContextType.CLASS,
                ))
                topic_progress_batch.append(ModuleTopicProgress(
                    topic=topic,
                    student=enrollment.student,
                    schedule=enrollment.schedule,
                    context_type=LearningContextType.CLASS,
                ))
                for lesson in lessons_by_topic[topic.id]:
                    lesson_progress_batch.append(ModuleLessonProgress(
                        lesson=lesson,
                        student=enrollment.student,
                        schedule=enrollment.schedule,
                        context_type=LearningContextType.CLASS,
                    ))
                attempt_batch.append(ModuleActivityAttempt(
                    activity=activity,
                    student=enrollment.student,
                    schedule=enrollment.schedule,
                    context_type=LearningContextType.CLASS,
                    attempt_number=1,
                    status=ModuleActivityAttempt.Status.SUBMITTED,
                    score=Decimal('85.00'),
                    max_score=Decimal('100.00'),
                    submitted_at=submitted_at,
                    activity_revision=activity.revision,
                    passing_score_snapshot=activity.passing_score,
                ))
                submission_batch.append(ModuleActivitySubmission(
                    activity=activity,
                    student=enrollment.student,
                    text_answer='Representative staging submission.',
                    score=Decimal('85.00'),
                ))
                if len(progress_batch) >= 5000:
                    ModuleProgress.objects.bulk_create(progress_batch, batch_size=5000)
                    ModuleTopicProgress.objects.bulk_create(topic_progress_batch, batch_size=5000)
                    ModuleLessonProgress.objects.bulk_create(lesson_progress_batch, batch_size=5000)
                    ModuleActivityAttempt.objects.bulk_create(attempt_batch, batch_size=5000)
                    ModuleActivitySubmission.objects.bulk_create(submission_batch, batch_size=5000)
                    progress_count += len(progress_batch) + len(topic_progress_batch)
                    lesson_progress_count += len(lesson_progress_batch)
                    attempt_count += len(attempt_batch)
                    submission_count += len(submission_batch)
                    progress_batch.clear()
                    topic_progress_batch.clear()
                    lesson_progress_batch.clear()
                    attempt_batch.clear()
                    submission_batch.clear()
            if progress_batch:
                ModuleProgress.objects.bulk_create(progress_batch, batch_size=5000)
                ModuleTopicProgress.objects.bulk_create(topic_progress_batch, batch_size=5000)
                ModuleLessonProgress.objects.bulk_create(lesson_progress_batch, batch_size=5000)
                ModuleActivityAttempt.objects.bulk_create(attempt_batch, batch_size=5000)
                ModuleActivitySubmission.objects.bulk_create(submission_batch, batch_size=5000)
                progress_count += len(progress_batch) + len(topic_progress_batch)
                lesson_progress_count += len(lesson_progress_batch)
                attempt_count += len(attempt_batch)
                submission_count += len(submission_batch)

        self.stdout.write(self.style.SUCCESS(
            f'Created {student_count} students, {schedule_count} schedules, '
            f'{len(enrollments)} enrollments, {score_count} item scores, '
            f'{attendance_count} attendance records, {progress_count} module/topic progress rows, '
            f'{lesson_progress_count} lesson progress rows, {attempt_count} attempts, and '
            f'{submission_count} submissions.',
        ))
