from datetime import time

from django.conf import settings
from django.core.management import BaseCommand, call_command

from accounts.models import StudentProfile, User
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
        for index, name in enumerate(('Alex Rivera', 'Jamie Santos'), start=1):
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
        for student in students:
            ScheduleStudent.objects.create(schedule=class_a, student=student)

        self.stdout.write(self.style.SUCCESS('Seeded isolated Playwright data.'))
