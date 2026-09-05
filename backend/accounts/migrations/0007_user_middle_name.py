from django.db import migrations, models


MIDDLE_NAMES = (
    'De Los Santos', 'Delos Santos', 'De Leon', 'De Guzman', 'La Madrid',
    'De Vera', 'San Jose', 'De Los Angles', 'De Roma',
)


def split_name(value):
    words = value.split()
    if len(words) < 2:
        return ' '.join(words), ''
    normalized = ' '.join(words)
    for suffix in sorted(MIDDLE_NAMES, key=lambda name: len(name.split()), reverse=True):
        if normalized.casefold() == suffix.casefold():
            return normalized, ''
        if normalized.casefold().endswith(' ' + suffix.casefold()):
            count = len(suffix.split())
            return ' '.join(words[:-count]), ' '.join(words[-count:])
    return ' '.join(words[:-1]), words[-1]


def migrate_names(apps, schema_editor, reverse=False):
    User = apps.get_model('accounts', 'User')
    users = User.objects.using(schema_editor.connection.alias)
    batch = []
    for user in users.filter(role='STUDENT').iterator(chunk_size=500):
        if reverse:
            user.first_name = ' '.join(part for part in (user.first_name, user.middle_name) if part)
            user.middle_name = ''
        elif not user.middle_name:
            user.first_name, user.middle_name = split_name(user.first_name)
        else:
            continue
        batch.append(user)
        if len(batch) == 500:
            users.bulk_update(batch, ['first_name', 'middle_name'], batch_size=500)
            batch = []
    if batch:
        users.bulk_update(batch, ['first_name', 'middle_name'], batch_size=500)


def reverse_names(apps, schema_editor):
    migrate_names(apps, schema_editor, reverse=True)


class Migration(migrations.Migration):
    dependencies = [('accounts', '0006_postgres_student_search_indexes')]
    operations = [
        migrations.AddField(
            model_name='user', name='middle_name',
            field=models.CharField(blank=True, default='', max_length=150),
        ),
        migrations.RunPython(migrate_names, reverse_names),
    ]
