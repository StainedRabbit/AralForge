from django.db import migrations


def rename_default_activity_titles(apps, schema_editor):
    """Rename only the former generated title, without touching teacher titles."""
    ModuleActivity = apps.get_model('learning_modules', 'ModuleActivity')
    ModuleTopic = apps.get_model('learning_modules', 'ModuleTopic')

    activities = ModuleActivity.objects.filter(title='Main Activity')
    topic_ids = set(activities.exclude(topic_id=None).values_list('topic_id', flat=True))
    topic_ids.update(
        activities.exclude(lesson_id=None).values_list('lesson__topic_id', flat=True)
    )
    activities.update(title='Quiz')

    if topic_ids:
        ModuleTopic.objects.filter(
            pk__in=topic_ids,
            pdf_generated_at__isnull=False,
        ).update(pdf_is_outdated=True)


class Migration(migrations.Migration):
    dependencies = [('learning_modules', '0031_modulelessonexample_order_index')]

    operations = [
        migrations.RunPython(rename_default_activity_titles, migrations.RunPython.noop),
    ]
