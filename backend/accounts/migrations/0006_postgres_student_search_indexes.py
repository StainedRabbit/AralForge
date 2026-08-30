from django.db import migrations


def create_postgres_search_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    statements = (
        'CREATE EXTENSION IF NOT EXISTS pg_trgm',
        'CREATE INDEX IF NOT EXISTS user_username_trgm_idx ON accounts_user USING gin (UPPER(username) gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS user_first_name_trgm_idx ON accounts_user USING gin (UPPER(first_name) gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS user_last_name_trgm_idx ON accounts_user USING gin (UPPER(last_name) gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS user_email_trgm_idx ON accounts_user USING gin (UPPER(email) gin_trgm_ops)',
        'CREATE INDEX IF NOT EXISTS profile_number_trgm_idx ON accounts_studentprofile USING gin (UPPER(student_number) gin_trgm_ops)',
    )
    with schema_editor.connection.cursor() as cursor:
        for statement in statements:
            cursor.execute(statement)


def drop_postgres_search_indexes(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        for name in (
            'user_username_trgm_idx',
            'user_first_name_trgm_idx',
            'user_last_name_trgm_idx',
            'user_email_trgm_idx',
            'profile_number_trgm_idx',
        ):
            cursor.execute(f'DROP INDEX IF EXISTS {name}')


class Migration(migrations.Migration):
    dependencies = [('accounts', '0005_user_performance_indexes')]

    operations = [migrations.RunPython(create_postgres_search_indexes, drop_postgres_search_indexes)]
