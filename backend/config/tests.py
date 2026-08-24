import os
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from config.settings import append_unique, env_origin_list, env_regex_list, load_env_file


class DeploymentEnvironmentTests(SimpleTestCase):
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
