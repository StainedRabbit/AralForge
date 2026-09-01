from django.db import migrations


def mark_topic_pdfs_outdated(apps, schema_editor):
    ModuleTopic = apps.get_model('learning_modules', 'ModuleTopic')
    ModuleTopic.objects.using(schema_editor.connection.alias).exclude(
        pdf_file='',
    ).filter(
        pdf_is_outdated=False,
    ).update(pdf_is_outdated=True)


class Migration(migrations.Migration):
    dependencies = [('learning_modules', '0029_performance_indexes')]

    operations = [
        migrations.RunPython(
            mark_topic_pdfs_outdated,
            migrations.RunPython.noop,
        ),
    ]
