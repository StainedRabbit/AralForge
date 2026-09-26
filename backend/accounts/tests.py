from datetime import time, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.conf import settings
from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APIClient, APITestCase
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken

from subjects.models import ScheduleStudent, SchoolYear, SchoolYearSemester, Semester, Subject, SubjectSchedule

from .auth import PasswordSetupToken
from .models import StudentProfile


class StudentAccountCreationTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.teacher = user_model.objects.create_user(
            username='teacher-password-test',
            password='testpass123',
            role=user_model.Role.TEACHER,
        )
        self.client.force_authenticate(self.teacher)

    def test_generic_user_endpoint_rejects_student_creation(self):
        response = self.client.post(
            reverse('accounts:user-list'),
            {
                'username': '20270001',
                'password': 'SecurePass!482',
                'role': 'STUDENT',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('role', response.data)

        omitted_role = self.client.post(
            reverse('accounts:user-list'),
            {'username': 'implicit-student', 'password': 'SecurePass!482'},
            format='json',
        )
        self.assertEqual(omitted_role.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('role', omitted_role.data)

    def test_student_endpoint_creates_atomic_account_with_temporary_number_credentials(self):
        response = self.client.post(
            reverse('accounts:student-list'),
            {
                'student_number': '141443',
                'first_name': 'New',
                'last_name': 'Student',
                'email': 'student@example.test',
                'is_active': True,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        profile = StudentProfile.objects.select_related('user').get(student_number='141443')
        self.assertEqual(profile.user.username, '141443')
        self.assertEqual(profile.user.role, get_user_model().Role.STUDENT)
        self.assertTrue(profile.user.check_password('141443'))
        self.assertTrue(profile.user.must_change_password)
        self.assertNotIn('section', response.data)
        self.assertNotIn('year_level', response.data)

        login = self.client.post(
            reverse('token_obtain_pair'),
            {'username': '141443', 'password': '141443'},
            format='json',
        )
        self.assertEqual(login.status_code, status.HTTP_200_OK)
        self.assertTrue(login.data['must_change_password'])
        self.assertNotIn('access', login.data)

    def test_student_names_accept_unicode_and_reject_replacement_characters(self):
        accepted = self.client.post(
            reverse('accounts:student-list'),
            {
                'student_number': 'UNICODE-NAME-1',
                'first_name': 'Espa\u00f1ol',
                'last_name': 'Ni\u00f1o',
            },
            format='json',
        )
        self.assertEqual(accepted.status_code, status.HTTP_201_CREATED)
        accepted_user = StudentProfile.objects.select_related('user').get(
            student_number='UNICODE-NAME-1',
        ).user
        self.assertEqual(accepted_user.first_name, 'Espa\u00f1ol')
        self.assertEqual(accepted_user.last_name, 'Ni\u00f1o')

        rejected = self.client.post(
            reverse('accounts:student-list'),
            {
                'student_number': 'DAMAGED-NAME-1',
                'first_name': 'Espa\ufffdol',
                'last_name': 'Student',
            },
            format='json',
        )
        self.assertEqual(rejected.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('first_name', rejected.data)
        self.assertFalse(StudentProfile.objects.filter(student_number='DAMAGED-NAME-1').exists())

    def test_legacy_damaged_user_name_can_be_manually_corrected(self):
        user = get_user_model().objects.create_user(
            username='LEGACY-DAMAGED-1',
            first_name='Espa\ufffdol',
            last_name='Student',
            role=get_user_model().Role.STUDENT,
        )
        StudentProfile.objects.create(user=user, student_number='LEGACY-DAMAGED-1')

        rejected = self.client.patch(
            reverse('accounts:user-detail', args=[user.id]),
            {'first_name': 'Still\ufffdDamaged'},
            format='json',
        )
        self.assertEqual(rejected.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('first_name', rejected.data)

        corrected = self.client.patch(
            reverse('accounts:user-detail', args=[user.id]),
            {'first_name': 'Espa\u00f1ol'},
            format='json',
        )
        self.assertEqual(corrected.status_code, status.HTTP_200_OK)
        user.refresh_from_db()
        self.assertEqual(user.first_name, 'Espa\u00f1ol')

    def test_student_username_cannot_diverge_but_admin_can_set_a_secure_password(self):
        profile = StudentProfile.objects.create(
            user=get_user_model().objects.create_user(
                username='ST-LOCKED',
                password='ST-LOCKED',
                role=get_user_model().Role.STUDENT,
                must_change_password=True,
            ),
            student_number='ST-LOCKED',
        )

        rejected = self.client.patch(
            reverse('accounts:user-detail', args=[profile.user_id]),
            {'username': 'different-name'},
            format='json',
        )
        self.assertEqual(rejected.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('username', rejected.data)

        updated = self.client.patch(
            reverse('accounts:user-detail', args=[profile.user_id]),
            {'password': 'AdminChosenSecurePass!482'},
            format='json',
        )
        self.assertEqual(updated.status_code, status.HTTP_200_OK)
        profile.user.refresh_from_db()
        self.assertTrue(profile.user.check_password('AdminChosenSecurePass!482'))
        self.assertFalse(profile.user.must_change_password)

    def test_student_number_rejects_case_insensitive_username_conflict(self):
        get_user_model().objects.create_user(
            username='Existing-Number',
            password='SecurePass!482',
            role=get_user_model().Role.TEACHER,
        )

        response = self.client.post(
            reverse('accounts:student-list'),
            {'student_number': 'existing-number'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('student_number', response.data)

    def test_number_change_resets_only_an_unclaimed_temporary_password(self):
        profile = StudentProfile.objects.create(
            user=get_user_model().objects.create_user(
                username='OLD-1',
                password='OLD-1',
                role=get_user_model().Role.STUDENT,
                must_change_password=True,
            ),
            student_number='OLD-1',
        )

        response = self.client.patch(
            reverse('accounts:student-detail', args=[profile.id]),
            {'student_number': 'NEW-1'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        profile.user.refresh_from_db()
        self.assertEqual(profile.user.username, 'NEW-1')
        self.assertTrue(profile.user.check_password('NEW-1'))

        profile.user.set_password('ChosenSecurePass!482')
        profile.user.must_change_password = False
        profile.user.save(update_fields=('password', 'must_change_password'))
        response = self.client.patch(
            reverse('accounts:student-detail', args=[profile.id]),
            {'student_number': 'FINAL-1'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        profile.user.refresh_from_db()
        self.assertEqual(profile.user.username, 'FINAL-1')
        self.assertTrue(profile.user.check_password('ChosenSecurePass!482'))


class AvailableStudentPickerTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.teacher = user_model.objects.create_user(
            username='picker-teacher',
            password='testpass123',
            role=user_model.Role.TEACHER,
        )
        self.available = self.create_student('available', 'Avery', 'Cruz', 'ST-100')
        self.inactive = self.create_student('inactive', 'Bailey', 'Santos', 'ST-200')
        self.active = self.create_student('active', 'Casey', 'Reyes', 'ST-300')
        school_year = SchoolYear.objects.create(start_year=2032, end_year=2033)
        term = SchoolYearSemester.objects.create(school_year=school_year, semester=Semester.FIRST)
        subject = Subject.objects.create(code='PICK101', name='Student Picker')
        self.schedule = SubjectSchedule.objects.create(
            subject=subject,
            school_year_semester=term,
            days='MO',
            start_time=time(8),
            end_time=time(9),
        )
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.active)
        ScheduleStudent.objects.create(schedule=self.schedule, student=self.inactive, is_active=False)
        self.client.force_authenticate(self.teacher)

    def create_student(self, username, first_name, last_name, student_number):
        user_model = get_user_model()
        student = user_model.objects.create_user(
            username=username,
            password='testpass123',
            first_name=first_name,
            last_name=last_name,
            role=user_model.Role.STUDENT,
        )
        StudentProfile.objects.create(
            user=student,
            student_number=student_number,
        )
        return student

    def test_returns_compact_picker_metadata_and_excludes_active_enrollments(self):
        response = self.client.get(
            reverse('accounts:user-available-students'),
            {'schedule': self.schedule.id, 'limit': 8},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = {item['id']: item for item in response.data['results']}
        self.assertNotIn(self.active.id, results)
        self.assertEqual(results[self.available.id], {
            'id': self.available.id,
            'display_name': 'Avery Cruz',
            'student_number': 'ST-100',
            'enrollment_status': 'not_enrolled',
        })
        self.assertEqual(results[self.inactive.id]['enrollment_status'], 'inactive')

    def test_searches_by_student_number(self):
        response = self.client.get(
            reverse('accounts:user-available-students'),
            {'schedule': self.schedule.id, 'search': 'ST-200', 'limit': 8},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item['id'] for item in response.data['results']], [self.inactive.id])


@override_settings(CACHES={
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'temporary-password-setup-tests',
    },
})
class TemporaryPasswordSetupTests(APITestCase):
    def setUp(self):
        # Database rollback does not reset DRF's IP-based throttle history.
        cache.clear()
        self.addCleanup(cache.clear)
        user_model = get_user_model()
        self.student = user_model.objects.create_user(
            username='internal-student-login',
            password='TemporaryPass!482',
            first_name='New',
            last_name='Student',
            role=user_model.Role.STUDENT,
            must_change_password=True,
        )
        StudentProfile.objects.create(user=self.student, student_number='ST-LOGIN-1')

    def test_student_number_login_requires_password_setup_and_setup_token_is_restricted(self):
        login = self.client.post(
            reverse('token_obtain_pair'),
            {'username': 'ST-LOGIN-1', 'password': 'TemporaryPass!482'},
            format='json',
        )

        self.assertEqual(login.status_code, status.HTTP_200_OK)
        self.assertTrue(login.data['must_change_password'])
        self.assertNotIn('access', login.data)
        setup_token = login.data['password_setup_token']

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {setup_token}')
        restricted = self.client.get(reverse('accounts:user-list'))
        self.assertEqual(restricted.status_code, status.HTTP_401_UNAUTHORIZED)
        self.client.credentials()

        completed = self.client.post(
            reverse('complete_password_setup'),
            {
                'password_setup_token': setup_token,
                'new_password': 'NewSecurePass!482',
                'confirm_password': 'NewSecurePass!482',
            },
            format='json',
        )
        self.assertEqual(completed.status_code, status.HTTP_200_OK)
        self.assertIn('access', completed.data)
        self.student.refresh_from_db()
        self.assertFalse(self.student.must_change_password)
        self.assertTrue(self.student.check_password('NewSecurePass!482'))

        reused = self.client.post(
            reverse('complete_password_setup'),
            {
                'password_setup_token': setup_token,
                'new_password': 'AnotherSecurePass!482',
                'confirm_password': 'AnotherSecurePass!482',
            },
            format='json',
        )
        self.assertEqual(reused.status_code, status.HTTP_400_BAD_REQUEST)

    def test_normal_username_login_remains_compatible(self):
        self.student.must_change_password = False
        self.student.save(update_fields=['must_change_password'])
        response = self.client.post(
            reverse('token_obtain_pair'),
            {'username': self.student.username, 'password': 'TemporaryPass!482'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)

    def test_login_rate_limit_remains_enforced(self):
        with patch.object(ScopedRateThrottle, 'THROTTLE_RATES', {'login': '2/minute'}):
            responses = [self.client.post(
                reverse('token_obtain_pair'),
                {'username': self.student.username, 'password': 'TemporaryPass!482'},
                format='json',
            ) for _ in range(3)]
        self.assertEqual([response.status_code for response in responses], [200, 200, 429])

    def test_number_only_student_accepts_number_and_legacy_prefixed_login(self):
        self.student.username = '130183'
        self.student.must_change_password = False
        self.student.save(update_fields=['username', 'must_change_password'])
        self.student.student_profile.student_number = '130183'
        self.student.student_profile.save(update_fields=['student_number'])

        for identifier in ('130183', 'student-130183'):
            with self.subTest(identifier=identifier):
                response = self.client.post(
                    reverse('token_obtain_pair'),
                    {'username': identifier, 'password': 'TemporaryPass!482'},
                    format='json',
                )

                self.assertEqual(response.status_code, status.HTTP_200_OK)
                self.assertIn('access', response.data)

    def test_expired_password_setup_token_is_rejected(self):
        token = PasswordSetupToken.for_user(self.student)
        token.set_exp(lifetime=timedelta(seconds=-1))
        response = self.client.post(
            reverse('complete_password_setup'),
            {
                'password_setup_token': str(token),
                'new_password': 'NewSecurePass!482',
                'confirm_password': 'NewSecurePass!482',
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class ChangePasswordTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.student = user_model.objects.create_user(
            username='password-change-student',
            password='CurrentSecurePass!482',
            role=user_model.Role.STUDENT,
        )
        StudentProfile.objects.create(user=self.student, student_number='ST-PASSWORD-1')
        self.url = reverse('accounts:user-change-password')

    def test_student_can_change_own_password(self):
        self.client.force_authenticate(self.student)

        response = self.client.post(
            self.url,
            {
                'current_password': 'CurrentSecurePass!482',
                'new_password': 'NewSecurePass!739',
                'confirm_password': 'NewSecurePass!739',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.student.refresh_from_db()
        self.assertTrue(self.student.check_password('NewSecurePass!739'))
        self.assertFalse(self.student.check_password('CurrentSecurePass!482'))

    def test_change_password_rejects_an_incorrect_current_password(self):
        self.client.force_authenticate(self.student)

        response = self.client.post(
            self.url,
            {
                'current_password': 'NotTheCurrentPassword!482',
                'new_password': 'NewSecurePass!739',
                'confirm_password': 'NewSecurePass!739',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('current_password', response.data)
        self.student.refresh_from_db()
        self.assertTrue(self.student.check_password('CurrentSecurePass!482'))

    def test_change_password_requires_authentication(self):
        response = self.client.post(
            self.url,
            {
                'current_password': 'CurrentSecurePass!482',
                'new_password': 'NewSecurePass!739',
                'confirm_password': 'NewSecurePass!739',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)


class ThemePreferenceTests(APITestCase):
    def setUp(self):
        user_model = get_user_model()
        self.first = user_model.objects.create_user(username='theme-one', password='testpass123')
        self.second = user_model.objects.create_user(username='theme-two', password='testpass123')
        self.url = reverse('accounts:user-set-theme')

    def test_theme_is_private_to_each_account_and_in_me(self):
        self.client.force_authenticate(self.first)
        response = self.client.patch(self.url, {'theme_preference': 'dark'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['theme_preference'], 'dark')
        self.first.refresh_from_db()
        self.second.refresh_from_db()
        self.assertEqual(self.first.theme_preference, 'dark')
        self.assertEqual(self.second.theme_preference, 'system')
        self.assertEqual(self.client.get(reverse('accounts:user-me')).data['user']['theme_preference'], 'dark')

        self.client.force_authenticate(self.second)
        self.assertEqual(self.client.get(reverse('accounts:user-me')).data['user']['theme_preference'], 'system')

    def test_theme_validation_and_authentication(self):
        self.client.force_authenticate(self.first)
        response = self.client.patch(self.url, {'theme_preference': 'invalid'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.first.refresh_from_db()
        self.assertEqual(self.first.theme_preference, 'system')
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.patch(self.url, {'theme_preference': 'light'}, format='json').status_code, status.HTTP_401_UNAUTHORIZED)


class CookieSessionSecurityTests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username='cookie-user', password='CookiePass!482', role=get_user_model().Role.STUDENT,
        )
        self.teacher = get_user_model().objects.create_user(
            username='cookie-teacher', password='CookiePass!482',
            role=get_user_model().Role.TEACHER,
        )
        self.admin = get_user_model().objects.create_user(
            username='cookie-admin', password='CookiePass!482',
            role=get_user_model().Role.ADMIN,
        )

    def login(self, user):
        response = self.client.post('/api/auth/token/', {
            'username': user.username, 'password': 'CookiePass!482',
        }, format='json')
        self.assertEqual(response.status_code, 200)
        return response

    def assert_refresh_lifetime(self, cookie, lifetime):
        refresh = RefreshToken(cookie.value)
        self.assertEqual(
            refresh['exp'] - refresh['iat'],
            int(lifetime.total_seconds()),
        )
        self.assertGreaterEqual(
            int(cookie['max-age']),
            int(lifetime.total_seconds()) - 2,
        )
        return refresh

    def test_cookie_free_refresh_does_not_require_csrf(self):
        self.client = APIClient(enforce_csrf_checks=True)
        fresh = self.client.post('/api/auth/token/refresh/', {}, format='json')
        self.assertEqual(fresh.status_code, status.HTTP_204_NO_CONTENT)

        csrf = self.client.get('/api/auth/csrf/').data['csrf_token']
        self.client.cookies.clear()
        blocked = self.client.post(
            '/api/auth/token/refresh/', {}, format='json', HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(blocked.status_code, status.HTTP_204_NO_CONTENT)

    def test_session_cookie_still_requires_csrf_before_rotation(self):
        self.client = APIClient(enforce_csrf_checks=True)
        login = self.login(self.user)
        original = login.cookies['aralforge_refresh'].value
        rejected = self.client.post('/api/auth/token/refresh/', {}, format='json')
        self.assertEqual(rejected.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(rejected.data['code'], 'csrf_failed')
        self.assertNotIn('aralforge_refresh', rejected.cookies)
        csrf = self.client.get('/api/auth/csrf/').data['csrf_token']
        recovered = self.client.post(
            '/api/auth/token/refresh/', {}, format='json', HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(recovered.status_code, status.HTTP_200_OK)
        self.assertNotEqual(recovered.cookies['aralforge_refresh'].value, original)

    def test_expired_refresh_is_unauthenticated_without_clearing_another_tabs_cookie(self):
        self.client = APIClient(enforce_csrf_checks=True)
        login = self.login(self.user)
        expired = RefreshToken(login.cookies['aralforge_refresh'].value)
        expired.set_exp(lifetime=timedelta(seconds=-1))
        self.client.cookies['aralforge_refresh'] = str(expired)
        csrf = self.client.get('/api/auth/csrf/').data['csrf_token']
        response = self.client.post(
            '/api/auth/token/refresh/', {}, format='json', HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertNotIn('aralforge_refresh', response.cookies)

    @override_settings(AUTH_REFRESH_COOKIE_SECURE=True, AUTH_REFRESH_COOKIE_SAMESITE='Lax')
    def test_same_origin_refresh_cookie_is_secure_httponly_and_host_only(self):
        cookie = self.login(self.user).cookies['aralforge_refresh']
        self.assertTrue(cookie['secure'])
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['samesite'], 'Lax')
        self.assertEqual(cookie['domain'], '')
        self.assertEqual(cookie['path'], '/api/auth/')

    def test_refresh_token_is_httponly_rotated_and_revoked_on_logout(self):
        login = self.login(self.user)
        self.assertIn('access', login.data)
        self.assertNotIn('refresh', login.data)
        refresh_cookie = login.cookies['aralforge_refresh']
        self.assertTrue(refresh_cookie['httponly'])
        original_refresh = refresh_cookie.value
        original_token = self.assert_refresh_lifetime(
            refresh_cookie,
            timedelta(days=settings.AUTH_REFRESH_TOKEN_DAYS),
        )
        outstanding = OutstandingToken.objects.get(jti=original_token['jti'])
        self.assertEqual(int(outstanding.expires_at.timestamp()), original_token['exp'])

        csrf = self.client.get('/api/auth/csrf/').data['csrf_token']
        refreshed = self.client.post(
            '/api/auth/token/refresh/', {}, format='json', HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(refreshed.status_code, 200, refreshed.data)
        self.assertIn('access', refreshed.data)
        rotated_cookie = refreshed.cookies['aralforge_refresh']
        rotated_refresh = rotated_cookie.value
        self.assertNotEqual(rotated_refresh, original_refresh)
        self.assert_refresh_lifetime(
            rotated_cookie,
            timedelta(days=settings.AUTH_REFRESH_TOKEN_DAYS),
        )

        logged_out = self.client.post(
            '/api/auth/logout/', {}, format='json', HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(logged_out.status_code, 204)
        self.assertEqual(logged_out.cookies['aralforge_refresh']['max-age'], 0)

        self.client.cookies['aralforge_refresh'] = rotated_refresh
        csrf = self.client.get('/api/auth/csrf/').data['csrf_token']
        after_logout = self.client.post('/api/auth/token/refresh/', {}, format='json', HTTP_X_CSRFTOKEN=csrf)
        self.assertEqual(after_logout.status_code, 204)

    def test_refresh_with_invalid_csrf_token_is_forbidden_without_revoking_session(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.login(self.user)
        csrf = self.client.get('/api/auth/csrf/').data['csrf_token']

        rejected = self.client.post(
            '/api/auth/token/refresh/', {}, format='json', HTTP_X_CSRFTOKEN='invalid-token',
        )

        self.assertEqual(rejected.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(rejected.data['code'], 'csrf_failed')
        self.assertIn('CSRF validation failed:', rejected.data['detail'])

        recovered = self.client.post(
            '/api/auth/token/refresh/', {}, format='json', HTTP_X_CSRFTOKEN=csrf,
        )

        self.assertEqual(recovered.status_code, status.HTTP_200_OK)
        self.assertIn('access', recovered.data)

    def test_teacher_refresh_token_uses_the_configured_lifetime(self):
        login = self.login(self.teacher)

        self.assert_refresh_lifetime(
            login.cookies['aralforge_refresh'],
            timedelta(days=settings.AUTH_REFRESH_TOKEN_DAYS),
        )

    def test_admin_refresh_token_uses_the_configured_lifetime(self):
        login = self.login(self.admin)

        self.assert_refresh_lifetime(
            login.cookies['aralforge_refresh'],
            timedelta(days=settings.AUTH_REFRESH_TOKEN_DAYS),
        )

    def test_disabled_account_cannot_refresh_a_durable_session(self):
        self.login(self.user)
        self.user.is_active = False
        self.user.save(update_fields=('is_active',))

        csrf = self.client.get('/api/auth/csrf/').data['csrf_token']
        refreshed = self.client.post(
            '/api/auth/token/refresh/', {}, format='json', HTTP_X_CSRFTOKEN=csrf,
        )

        self.assertEqual(refreshed.status_code, status.HTTP_204_NO_CONTENT)
