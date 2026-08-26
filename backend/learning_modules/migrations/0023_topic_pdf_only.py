from django.db import migrations


def delete_retired_pdf_files(apps, schema_editor):
    database_alias = schema_editor.connection.alias

    for model_name in ('Module', 'ModuleLesson'):
        model = apps.get_model('learning_modules', model_name)
        storage = model._meta.get_field('pdf_file').storage
        filenames = set(
            model.objects.using(database_alias)
            .exclude(pdf_file='')
            .values_list('pdf_file', flat=True)
        )
        for filename in filenames:
            if filename:
                storage.delete(filename)


class Migration(migrations.Migration):
    dependencies = [
        ('learning_modules', '0022_moduletopic_printable_pdf'),
    ]

    operations = [
        migrations.RunPython(
            delete_retired_pdf_files,
            migrations.RunPython.noop,
        ),
        migrations.RemoveField(
            model_name='module',
            name='pdf_file',
        ),
        migrations.RemoveField(
            model_name='module',
            name='pdf_generated_at',
        ),
        migrations.RemoveField(
            model_name='module',
            name='pdf_is_outdated',
        ),
        migrations.RemoveField(
            model_name='modulelesson',
            name='pdf_file',
        ),
        migrations.RemoveField(
            model_name='modulelesson',
            name='pdf_generated_at',
        ),
        migrations.RemoveField(
            model_name='modulelesson',
            name='pdf_is_outdated',
        ),
    ]
