from unittest.mock import patch

from django.test import SimpleTestCase, override_settings


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
