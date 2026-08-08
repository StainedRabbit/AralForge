from datetime import time

from django.conf import settings
from django.core.management import BaseCommand, call_command

from accounts.models import StudentProfile, User
from grades.models import GradeCategory, GradeCategoryChoices, GradingPeriod
from learning_modules.models import Module, ModuleAccess, ModuleLesson, ModuleTopic
from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule


class Command(BaseCommand):
    help = 'Reset and seed the isolated Playwright database.'

    def handle(self, *args, **options):
        if not getattr(settings, 'E2E_TESTING', False):
            self.stderr.write(self.style.ERROR('seed_e2e is restricted to config.settings_e2e.'))
            return

        call_command('flush', interactive=False, verbosity=0)

        teacher = User.objects.create_user(
            username='e2e-teacher',
            password='e2e-password',
            first_name='E2E',
            last_name='Teacher',
            role=User.Role.TEACHER,
        )
        teacher.is_staff = True
        teacher.save(update_fields=['is_staff'])

        students = []
        for index, name in enumerate(('Alex Rivera', 'Jamie Santos', 'Morgan Lee'), start=1):
            first_name, last_name = name.split(' ', 1)
            student = User.objects.create_user(
                username=f'e2e-student-{index}',
                password='e2e-password',
                first_name=first_name,
                last_name=last_name,
                role=User.Role.STUDENT,
            )
            StudentProfile.objects.create(
                user=student,
                student_number=f'E2E-00{index}',
                section='E2E-A',
                year_level=1,
            )
            students.append(student)

        school_year = SchoolYear.objects.create(start_year=2030, end_year=2031)
        first_term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
            is_active=True,
        )
        SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.SECOND,
            is_active=False,
        )
        programming = Subject.objects.create(code='E2E101', name='Programming Fundamentals')
        databases = Subject.objects.create(code='E2E102', name='Database Systems')
        GradeCategory.objects.create(
            subject=programming,
            grading_period=GradingPeriod.PRELIM,
            category=GradeCategoryChoices.QUIZ,
            name='Quizzes',
            weight=100,
        )
        class_a = SubjectSchedule.objects.create(
            subject=programming,
            school_year_semester=first_term,
            days='MO,WE,FR',
            start_time=time(9, 0),
            end_time=time(10, 0),
            section='E2E-A',
            room='Lab 1',
        )
        SubjectSchedule.objects.create(
            subject=databases,
            school_year_semester=first_term,
            days='TU,TH',
            start_time=time(10, 0),
            end_time=time(11, 0),
            section='E2E-B',
            room='Lab 2',
        )
        for student in students[:2]:
            ScheduleStudent.objects.create(schedule=class_a, student=student)

        resume_module = Module.objects.create(
            title='E2E Resume Learning Module',
            slug='e2e-resume-learning-module',
            subject=databases,
            description='Browser fixture for direct lesson resume behavior.',
            is_published=False,
        )
        resume_module.subjects.add(databases)
        resume_topic = ModuleTopic.objects.create(
            module=resume_module,
            title='Resume Topic',
            order=1,
            overview='A short topic used to verify lesson resume targets.',
            is_published=False,
        )
        for order, title in enumerate(
            ('Resume Basics', 'Resume Practice', 'Resume Review'),
            start=1,
        ):
            ModuleLesson.objects.create(
                topic=resume_topic,
                title=title,
                order=order,
                learning_targets=f'Complete {title}.',
                lets_practice=f'Practice {title}.',
                is_published=False,
            )
        ModuleLesson.objects.create(
            topic=resume_topic,
            title='Hidden Resume Lesson',
            order=0,
            is_published=False,
        )
        Module.objects.filter(pk=resume_module.pk).update(is_published=True)
        ModuleTopic.objects.filter(pk=resume_topic.pk).update(is_published=True)
        ModuleLesson.objects.filter(
            topic=resume_topic,
            title__startswith='Resume ',
        ).update(is_published=True)
        ModuleAccess.objects.create(
            access_type=ModuleAccess.AccessType.PAYMENT,
            activated_by=teacher,
            amount_paid=100,
            module=resume_module,
            payment_status=ModuleAccess.PaymentStatus.PAID,
            student=students[0],
        )

        self.stdout.write(self.style.SUCCESS('Seeded isolated Playwright data.'))
