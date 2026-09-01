import unittest

from scripts.benchmark_api import parse_server_timing, percentile


class BenchmarkApiTests(unittest.TestCase):
    def test_parse_server_timing_returns_database_duration_and_query_count(self):
        self.assertEqual(
            parse_server_timing('app;dur=45.1, db;dur=12.3;desc="6 queries"'),
            (12.3, 6),
        )

    def test_parse_server_timing_distinguishes_disabled_database_timing(self):
        self.assertEqual(parse_server_timing('app;dur=45.1'), (None, None))

    def test_percentile_uses_nearest_rank(self):
        self.assertEqual(percentile([1, 2, 3, 4, 5], 95), 5)


if __name__ == '__main__':
    unittest.main()
