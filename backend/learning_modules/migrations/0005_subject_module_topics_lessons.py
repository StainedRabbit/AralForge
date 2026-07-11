# Generated manually for subject modules with competency topics and lessons.

import re

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def slugify(value):
    slug = re.sub(r'[^a-z0-9]+', '-', value.lower()).strip('-')
    return slug or 'module'


def unique_slug(Module, base):
    candidate = slugify(base)
    suffix = 2

    while Module.objects.filter(slug=candidate).exists():
        candidate = f'{slugify(base)}-{suffix}'
        suffix += 1

    return candidate


def migrate_modules_to_topics(apps, schema_editor):
    Subject = apps.get_model('subjects', 'Subject')
    Module = apps.get_model('learning_modules', 'Module')
    ModuleAccess = apps.get_model('learning_modules', 'ModuleAccess')
    ModuleActivity = apps.get_model('learning_modules', 'ModuleActivity')
    ModuleLesson = apps.get_model('learning_modules', 'ModuleLesson')
    ModuleProgress = apps.get_model('learning_modules', 'ModuleProgress')
    ModuleTopic = apps.get_model('learning_modules', 'ModuleTopic')
    ModuleTopicProgress = apps.get_model('learning_modules', 'ModuleTopicProgress')

    for subject in Subject.objects.all().order_by('id'):
        legacy_modules = list(
            Module.objects.filter(subjects=subject, subject__isnull=True).order_by('id')
        )

        if not legacy_modules:
            continue

        container = Module.objects.create(
            title=f'{subject.code} Learning Module',
            slug=unique_slug(Module, f'{subject.code}-learning-module'),
            subject=subject,
            description=subject.description,
            is_paid=any(module.is_paid for module in legacy_modules),
            price=max((module.price for module in legacy_modules), default=0),
            is_published=any(module.is_published for module in legacy_modules),
        )
        container.subjects.add(subject)

        for index, legacy_module in enumerate(legacy_modules, start=1):
            topic = ModuleTopic.objects.create(
                module=container,
                legacy_module=legacy_module,
                title=legacy_module.title,
                order=index,
                overview=legacy_module.description,
                is_published=legacy_module.is_published,
            )
            ModuleLesson.objects.create(
                topic=topic,
                title=legacy_module.title,
                order=1,
                objectives=legacy_module.learning_objectives,
                overview=legacy_module.lesson_overview or legacy_module.content,
                acquisition=legacy_module.detailed_discussion,
                making_meaning=legacy_module.examples,
                transfer=legacy_module.student_activities,
                examples=legacy_module.examples,
                teacher_notes=legacy_module.teacher_notes,
                student_activities=legacy_module.student_activities,
                resources=legacy_module.resources,
                pdf_file=legacy_module.pdf_file,
                is_published=legacy_module.is_published,
            )

            ModuleActivity.objects.filter(module=legacy_module).update(
                module=container,
                topic=topic,
            )

            for progress in ModuleProgress.objects.filter(module=legacy_module):
                ModuleTopicProgress.objects.get_or_create(
                    topic=topic,
                    student_id=progress.student_id,
                    defaults={
                        'started_at': progress.started_at,
                        'completed_at': progress.completed_at,
                    },
                )
                ModuleProgress.objects.get_or_create(
                    module=container,
                    student_id=progress.student_id,
                    defaults={
                        'started_at': progress.started_at,
                        'completed_at': progress.completed_at,
                    },
                )

            for access in ModuleAccess.objects.filter(module=legacy_module):
                ModuleAccess.objects.get_or_create(
                    module=container,
                    student_id=access.student_id,
                    defaults={
                        'activated_by_id': access.activated_by_id,
                        'payment_status': access.payment_status,
                        'amount_paid': access.amount_paid,
                        'payment_reference': access.payment_reference,
                        'is_active': access.is_active,
                        'expires_at': access.expires_at,
                        'notes': access.notes,
                    },
                )

            legacy_module.is_published = False
            legacy_module.save(update_fields=['is_published'])


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('learning_modules', '0004_structured_lesson_material'),
        ('subjects', '0003_schedulestudent_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='module',
            name='subject',
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='learning_module',
                to='subjects.subject',
            ),
        ),
        migrations.CreateModel(
            name='ModuleTopic',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=180)),
                ('order', models.PositiveIntegerField(default=0)),
                ('competency_code', models.CharField(blank=True, max_length=80)),
                ('competency_text', models.TextField(blank=True)),
                ('unit', models.CharField(blank=True, max_length=180)),
                ('overview', models.TextField(blank=True)),
                ('is_published', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('legacy_module', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='migrated_topic', to='learning_modules.module')),
                ('module', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='topics', to='learning_modules.module')),
            ],
            options={
                'ordering': ['module', 'order', 'id'],
            },
        ),
        migrations.CreateModel(
            name='ModuleLesson',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('title', models.CharField(max_length=180)),
                ('order', models.PositiveIntegerField(default=0)),
                ('objectives', models.TextField(blank=True)),
                ('overview', models.TextField(blank=True)),
                ('subtopics', models.TextField(blank=True)),
                ('acquisition', models.TextField(blank=True)),
                ('making_meaning', models.TextField(blank=True)),
                ('transfer', models.TextField(blank=True)),
                ('examples', models.TextField(blank=True)),
                ('teacher_notes', models.TextField(blank=True)),
                ('student_activities', models.TextField(blank=True)),
                ('resources', models.TextField(blank=True)),
                ('assessment_url', models.URLField(blank=True)),
                ('pdf_file', models.FileField(blank=True, upload_to='module_lesson_pdfs/')),
                ('is_published', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('topic', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='lessons', to='learning_modules.moduletopic')),
            ],
            options={
                'ordering': ['topic', 'order', 'id'],
            },
        ),
        migrations.AddField(
            model_name='moduleactivity',
            name='topic',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='activities', to='learning_modules.moduletopic'),
        ),
        migrations.CreateModel(
            name='ModuleTopicProgress',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('student', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='module_topic_progress', to=settings.AUTH_USER_MODEL)),
                ('topic', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='progress', to='learning_modules.moduletopic')),
            ],
            options={
                'ordering': ['-started_at'],
                'verbose_name_plural': 'module topic progress',
            },
        ),
        migrations.AddConstraint(
            model_name='moduletopic',
            constraint=models.UniqueConstraint(fields=('module', 'title'), name='unique_topic_title_per_module'),
        ),
        migrations.AddConstraint(
            model_name='moduletopicprogress',
            constraint=models.UniqueConstraint(fields=('topic', 'student'), name='unique_module_topic_progress'),
        ),
        migrations.RunPython(migrate_modules_to_topics, migrations.RunPython.noop),
    ]
