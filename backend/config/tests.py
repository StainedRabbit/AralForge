import os
import runpy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.http import HttpResponse
from django.test import RequestFactory
from django.test import SimpleTestCase, override_settings

from config.middleware import RequestTimingMiddleware
from config.object_storage import (
    object_storage_summary,
    resolve_object_storage_config,
)
from config.settings import (
    append_unique,
    env_bounded_int,
    env_origin_list,
    env_regex_list,
    load_env_file,
)


class DeploymentEnvironmentTests(SimpleTestCase):
    canonical_storage = {
        'OBJECT_STORAGE_S3_ENDPOINT': 'https://account.r2.cloudflarestorage.com',
        'OBJECT_STORAGE_S3_REGION': 'auto',
        'OBJECT_STORAGE_S3_ACCESS_KEY_ID': 'canonical-access-key',
        'OBJECT_STORAGE_S3_SECRET_ACCESS_KEY': 'canonical-secret-key',
        'OBJECT_STORAGE_BUCKET': 'aralforge-media',
    }

    def production_environment(self, **overrides):
        return {
            **self.canonical_storage,
            'DEBUG': 'False',
            'SECRET_KEY': 'production-configuration-test-key-only',
            'ALLOWED_HOSTS': 'api.example.test',
            'DATABASE_URL': 'postgresql://test:test@localhost/aralforge_test',
            'REDIS_URL': 'redis://localhost:6379/0',
            'CELERY_TASK_ALWAYS_EAGER': 'False',
            'CORS_ALLOWED_ORIGINS': 'https://frontend.example.test',
            'CSRF_TRUSTED_ORIGINS': 'https://frontend.example.test',
            'AUTH_REFRESH_COOKIE_SECURE': 'True',
            'CSRF_COOKIE_SECURE': 'True',
            **overrides,
        }

    def test_production_accepts_same_origin_and_legacy_secure_cookies(self):
        for same_site in ('Lax', 'None'):
            with self.subTest(same_site=same_site), patch.dict(
                os.environ,
                self.production_environment(
                    AUTH_REFRESH_COOKIE_SAMESITE=same_site,
                    CSRF_COOKIE_SAMESITE=same_site,
                ),
                clear=True,
            ):
                configured = runpy.run_path(
                    str(Path(__file__).with_name('settings.py')),
                    run_name='config.production_cookie_validation',
                )
                self.assertEqual(configured['AUTH_REFRESH_COOKIE_SAMESITE'], same_site)
                self.assertEqual(configured['CSRF_COOKIE_SAMESITE'], same_site)
                self.assertTrue(configured['AUTH_REFRESH_COOKIE_SECURE'])
                self.assertTrue(configured['CSRF_COOKIE_SECURE'])

    def test_production_still_rejects_insecure_session_cookies(self):
        for setting in ('AUTH_REFRESH_COOKIE_SECURE', 'CSRF_COOKIE_SECURE'):
            with self.subTest(setting=setting), patch.dict(
                os.environ,
                self.production_environment(**{setting: 'False'}),
                clear=True,
            ):
                with self.assertRaisesRegex(RuntimeError, f'{setting} must be enabled'):
                    runpy.run_path(
                        str(Path(__file__).with_name('settings.py')),
                        run_name='config.production_cookie_validation',
                    )

    @patch.dict(os.environ, {'ARALFORGE_TEST_SETTING': 'platform-value'})
    def test_local_env_file_does_not_override_platform_values(self):
        with TemporaryDirectory() as directory:
            env_path = Path(directory) / '.env'
            env_path.write_text('ARALFORGE_TEST_SETTING=file-value\n', encoding='utf-8')

            load_env_file(env_path)

        self.assertEqual(os.environ['ARALFORGE_TEST_SETTING'], 'platform-value')

    @patch.dict(
        os.environ,
        {
            'TEST_ORIGINS': (
                'https://frontend.kevinezertanierla.workers.dev,'
                'https://aralforge.com'
            ),
        },
    )
    def test_origin_list_accepts_exact_comma_separated_origins(self):
        self.assertEqual(
            env_origin_list('TEST_ORIGINS'),
            [
                'https://frontend.kevinezertanierla.workers.dev',
                'https://aralforge.com',
            ],
        )

    def test_origin_list_rejects_wildcards_and_url_paths(self):
        invalid_values = (
            'https://*.workers.dev',
            'https://frontend.kevinezertanierla.workers.dev/path',
            'https://user:password@example.com',
        )

        for value in invalid_values:
            with self.subTest(value=value), patch.dict(
                os.environ,
                {'TEST_ORIGINS': value},
            ):
                with self.assertRaisesRegex(RuntimeError, 'exact HTTP'):
                    env_origin_list('TEST_ORIGINS')

    @patch.dict(os.environ, {'TEST_REGEXES': '['})
    def test_regex_list_rejects_invalid_regular_expressions(self):
        with self.assertRaisesRegex(RuntimeError, 'invalid regular expression'):
            env_regex_list('TEST_REGEXES')

    def test_railway_hostname_can_be_added_without_duplicates(self):
        hosts = ['api.example.test']

        append_unique(hosts, ' aralforge-staging.up.railway.app ')
        append_unique(hosts, 'aralforge-staging.up.railway.app')

        self.assertEqual(
            hosts,
            ['api.example.test', 'aralforge-staging.up.railway.app'],
        )

    @patch.dict(os.environ, {'TEST_REFRESH_SESSION_DAYS': '90'})
    def test_bounded_integer_environment_value_is_accepted(self):
        self.assertEqual(
            env_bounded_int('TEST_REFRESH_SESSION_DAYS', 30, 1, 400),
            90,
        )

    @patch.dict(os.environ, {'TEST_REFRESH_SESSION_DAYS': '401'})
    def test_bounded_integer_environment_value_rejects_invalid_range(self):
        with self.assertRaisesRegex(RuntimeError, 'between 1 and 400'):
            env_bounded_int('TEST_REFRESH_SESSION_DAYS', 30, 1, 400)

    def test_canonical_object_storage_configuration_is_resolved(self):
        config = resolve_object_storage_config(self.canonical_storage, required=True)

        self.assertEqual(config['source'], 'OBJECT_STORAGE')
        self.assertEqual(config['bucket'], 'aralforge-media')
        self.assertEqual(config['region'], 'auto')

    def test_legacy_object_storage_configuration_remains_supported(self):
        legacy = {
            'SUPABASE_S3_ENDPOINT': (
                'https://exampleaccountid.r2.cloudflarestorage.com'
            ),
            'SUPABASE_S3_REGION': 'auto',
            'SUPABASE_S3_ACCESS_KEY_ID': 'test-access-key',
            'SUPABASE_S3_SECRET_ACCESS_KEY': 'test-secret-key',
            'SUPABASE_STORAGE_BUCKET': 'aralforge-production-media',
        }

        config = resolve_object_storage_config(legacy, required=True)

        self.assertEqual(config['source'], 'SUPABASE')
        self.assertEqual(
            config['endpoint'],
            'https://exampleaccountid.r2.cloudflarestorage.com',
        )

    def test_partial_or_mixed_object_storage_configuration_is_rejected(self):
        partial = {'OBJECT_STORAGE_S3_ENDPOINT': self.canonical_storage['OBJECT_STORAGE_S3_ENDPOINT']}
        mixed = {
            **self.canonical_storage,
            'SUPABASE_STORAGE_BUCKET': 'legacy-bucket',
        }

        with self.assertRaisesRegex(RuntimeError, 'Incomplete OBJECT_STORAGE'):
            resolve_object_storage_config(partial)
        with self.assertRaisesRegex(RuntimeError, 'mixes OBJECT_STORAGE'):
            resolve_object_storage_config(mixed)

    def test_r2_endpoint_and_region_are_validated(self):
        with self.assertRaisesRegex(RuntimeError, 'R2 account endpoint'):
            resolve_object_storage_config({
                **self.canonical_storage,
                'OBJECT_STORAGE_S3_ENDPOINT': (
                    'https://account.r2.cloudflarestorage.com/aralforge-media'
                ),
            })
        with self.assertRaisesRegex(RuntimeError, 'region must be auto'):
            resolve_object_storage_config({
                **self.canonical_storage,
                'OBJECT_STORAGE_S3_REGION': 'us-east-1',
            })

    def test_object_storage_summary_never_contains_credentials(self):
        config = resolve_object_storage_config(self.canonical_storage)

        summary = object_storage_summary(config)
        rendered = repr(summary)

        self.assertEqual(summary['endpoint_host'], 'account.r2.cloudflarestorage.com')
        self.assertEqual(len(summary['access_key_fingerprint']), 12)
        self.assertNotIn('canonical-access-key', rendered)
        self.assertNotIn('canonical-secret-key', rendered)


class HealthCheckTests(SimpleTestCase):
    databases = {'default'}

    @override_settings(
        SECURE_SSL_REDIRECT=True,
        SECURE_REDIRECT_EXEMPT=[r'^api/health/$'],
    )
    def test_health_check_reports_database_readiness(self):
        response = self.client.get('/api/health/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'ok'})

    @patch('config.health.connection.cursor', side_effect=RuntimeError('database unavailable'))
    def test_health_check_hides_database_errors(self, mocked_cursor):
        response = self.client.get('/api/health/')

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'status': 'unavailable'})
        mocked_cursor.assert_called_once_with()


class RequestTimingMiddlewareTests(SimpleTestCase):
    def setUp(self):
        self.request_factory = RequestFactory()

    @patch.dict(
        os.environ,
        {'API_DB_TIMING_ENABLED': 'false', 'API_SLOW_REQUEST_MS': '750'},
    )
    @patch('config.middleware.logger.warning')
    @patch('config.middleware.perf_counter', side_effect=[10.0, 11.0])
    def test_slow_summary_request_is_identifiable_without_database_timing(
        self,
        _mocked_clock,
        mocked_warning,
    ):
        middleware = RequestTimingMiddleware(lambda _request: HttpResponse('ok'))
        request = self.request_factory.get(
            '/api/modules/modules/?view=summary&limit=100',
        )

        response = middleware(request)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Server-Timing'], 'app;dur=1000.0')
        warning_args = mocked_warning.call_args.args
        self.assertIn('view=%s', warning_args[0])
        self.assertEqual(warning_args[3], 'summary')
        self.assertEqual(warning_args[6:10], (-1.0, -1.0, -1.0, -1))

    @patch.dict(
        os.environ,
        {'API_DB_TIMING_ENABLED': 'true', 'API_SLOW_REQUEST_MS': '750'},
    )
    @patch('config.middleware.logger.warning')
    @patch('config.middleware.perf_counter', side_effect=[20.0, 21.0])
    def test_database_timing_is_exposed_in_headers_and_slow_log(
        self,
        _mocked_clock,
        mocked_warning,
    ):
        middleware = RequestTimingMiddleware(lambda _request: HttpResponse('ok'))
        request = self.request_factory.get('/api/modules/modules/')

        response = middleware(request)

        self.assertEqual(
            response['Server-Timing'],
            'app;dur=1000.0, db;dur=0.0;desc="0 queries"',
        )
        warning_args = mocked_warning.call_args.args
        self.assertEqual(warning_args[3], 'default')
        self.assertEqual(warning_args[6:10], (0.0, 0.0, 1000.0, 0))
