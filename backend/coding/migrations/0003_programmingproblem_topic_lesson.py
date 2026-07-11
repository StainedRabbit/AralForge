# Generated manually for lesson-linked fill-in-blank coding assessments.

import django.db.models.deletion
from django.db import migrations, models


def migrated_topic_for(module):
    try:
        return module.migrated_topic
    except module.__class__.migrated_topic.RelatedObjectDoesNotExist:
        return None


def migrate_problem_links(apps, schema_editor):
    ProgrammingProblem = apps.get_model('coding', 'ProgrammingProblem')
    ModuleLesson = apps.get_model('learning_modules', 'ModuleLesson')

    for problem in ProgrammingProblem.objects.select_related('module').all():
        if not problem.module_id:
            continue

        topic = migrated_topic_for(problem.module)
        if not topic:
            continue

        lesson = ModuleLesson.objects.filter(topic=topic).order_by('order', 'id').first()
        problem.topic_id = topic.id
        if lesson:
            problem.lesson_id = lesson.id
        problem.save(update_fields=['topic', 'lesson'])


class Migration(migrations.Migration):

    dependencies = [
        ('coding', '0002_codeblank_codeblankanswer_and_more'),
        ('learning_modules', '0006_deped_lesson_template_fields'),
    ]

    operations = [
        migrations.AddField(
            model_name='programmingproblem',
            name='topic',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='programming_problems',
                to='learning_modules.moduletopic',
            ),
        ),
        migrations.AddField(
            model_name='programmingproblem',
            name='lesson',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='programming_problems',
                to='learning_modules.modulelesson',
            ),
        ),
        migrations.RunPython(migrate_problem_links, migrations.RunPython.noop),
    ]
