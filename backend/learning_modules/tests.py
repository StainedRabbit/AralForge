from django.test import TestCase
from rest_framework.test import APITestCase

from accounts.models import User
from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule

from .models import Module, ModuleAccess


class ModuleAccessApiTests(APITestCase):
    def setUp(self):
        self.student = User.objects.create_user(
            username='module-student',
            password='testpass123',
            role=User.Role.STUDENT,
        )
        self.subject = Subject.objects.create(code='CC103', name='Intermediate Programming')
        school_year = SchoolYear.objects.create(start_year=2026, end_year=2027)
        term = SchoolYearSemester.objects.create(
            school_year=school_year,
            semester=Semester.FIRST,
        )
        schedule = SubjectSchedule.objects.create(
            subject=self.subject,
            school_year_semester=term,
            days='TTH',
            start_time='10:00',
            end_time='11:30',
            section='A',
        )
        ScheduleStudent.objects.create(schedule=schedule, student=self.student)
        self.free_module = Module.objects.create(
            title='Free Topic',
            slug='free-topic',
            is_paid=False,
            is_published=True,
        )
        self.free_module.subjects.add(self.subject)
        self.paid_module = Module.objects.create(
            title='Paid Topic',
            slug='paid-topic',
            is_paid=True,
            is_published=True,
        )
        self.paid_module.subjects.add(self.subject)

    def test_student_sees_free_module_but_not_paid_module_without_grant(self):
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/modules/')

        self.assertEqual(response.status_code, 200)
        ids = {module['id'] for module in response.data}
        self.assertEqual(ids, {self.free_module.id})

    def test_student_sees_paid_module_after_active_grant(self):
        ModuleAccess.objects.create(
            module=self.paid_module,
            student=self.student,
            payment_status=ModuleAccess.PaymentStatus.PAID,
            is_active=True,
        )
        self.client.force_authenticate(self.student)

        response = self.client.get('/api/modules/modules/')

        self.assertEqual(response.status_code, 200)
        ids = {module['id'] for module in response.data}
        self.assertEqual(ids, {self.free_module.id, self.paid_module.id})
