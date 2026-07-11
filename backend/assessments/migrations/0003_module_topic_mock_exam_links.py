# Generated manually for mock exams with ModuleTopic-selected topics.

from django.db import migrations, models


def migrated_topic_for(module):
    try:
        return module.migrated_topic
    except module.__class__.migrated_topic.RelatedObjectDoesNotExist:
        return None


def migrate_mock_topic_links(apps, schema_editor):
    Assessment = apps.get_model('assessments', 'Assessment')
    AssessmentAttempt = apps.get_model('assessments', 'AssessmentAttempt')
    Question = apps.get_model('assessments', 'Question')

    for question in Question.objects.prefetch_related('topics').all():
        module_topic_ids = []
        for legacy_module in question.topics.all():
            topic = migrated_topic_for(legacy_module)
            if topic:
                module_topic_ids.append(topic.id)
        if module_topic_ids:
            question.module_topics.add(*module_topic_ids)

    for attempt in AssessmentAttempt.objects.prefetch_related('selected_topics').all():
        module_topic_ids = []
        for legacy_module in attempt.selected_topics.all():
            topic = migrated_topic_for(legacy_module)
            if topic:
                module_topic_ids.append(topic.id)
        if module_topic_ids:
            attempt.selected_module_topics.add(*module_topic_ids)

    for assessment in Assessment.objects.select_related('module').all():
        module = assessment.module
        topic = migrated_topic_for(module) if module else None
        if topic:
            assessment.module_id = topic.module_id
            assessment.save(update_fields=['module'])


class Migration(migrations.Migration):

    dependencies = [
        ('learning_modules', '0005_subject_module_topics_lessons'),
        ('assessments', '0002_mock_exam_topics'),
    ]

    operations = [
        migrations.AddField(
            model_name='assessmentattempt',
            name='selected_module_topics',
            field=models.ManyToManyField(blank=True, related_name='mock_exam_attempts', to='learning_modules.moduletopic'),
        ),
        migrations.AddField(
            model_name='question',
            name='module_topics',
            field=models.ManyToManyField(blank=True, related_name='assessment_questions', to='learning_modules.moduletopic'),
        ),
        migrations.RunPython(migrate_mock_topic_links, migrations.RunPython.noop),
    ]
