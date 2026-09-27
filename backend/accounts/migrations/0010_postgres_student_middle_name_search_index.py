from django.db import migrations


def create_index(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            'CREATE INDEX IF NOT EXISTS user_middle_name_trgm_idx '
            'ON accounts_user USING gin (UPPER(middle_name) gin_trgm_ops)'
        )


def drop_index(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('DROP INDEX IF EXISTS user_middle_name_trgm_idx')


class Migration(migrations.Migration):
    dependencies = [('accounts', '0009_user_theme_preference')]

    operations = [migrations.RunPython(create_index, drop_index)]
