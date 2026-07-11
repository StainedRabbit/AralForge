from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('learning_modules', '0012_printable_pdf_status'),
    ]

    operations = [
        migrations.AddField(
            model_name='moduleactivity',
            name='lesson',
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name='main_activity',
                to='learning_modules.modulelesson',
            ),
        ),
        migrations.AddField(
            model_name='moduleactivity',
            name='max_attempts',
            field=models.PositiveSmallIntegerField(default=3),
        ),
        migrations.AddField(
            model_name='moduleactivity',
            name='passing_score',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True),
        ),
        migrations.AlterField(
            model_name='moduleactivity',
            name='activity_type',
            field=models.CharField(
                choices=[
                    ('TEXT', 'Text'),
                    ('FILE_UPLOAD', 'File Upload'),
                    ('CODE_COMPLETE', 'Complete Coding'),
                    ('CODE_FILL_BLANK', 'Fill in the Blank Coding'),
                    ('INTERACTIVE', 'Interactive'),
                ],
                default='TEXT',
                max_length=30,
            ),
        ),
        migrations.CreateModel(
            name='ModuleActivityQuestion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                (
                    'question_type',
                    models.CharField(
                        choices=[
                            ('multiple_choice', 'Multiple Choice'),
                            ('true_false', 'True/False'),
                            ('fill_blank', 'Fill Blank'),
                            ('ordering', 'Ordering'),
                            ('matching', 'Matching'),
                            ('code_output', 'Code Output'),
                        ],
                        max_length=30,
                    ),
                ),
                ('prompt', models.TextField()),
                ('points', models.DecimalField(decimal_places=2, default=1, max_digits=6)),
                ('order', models.PositiveIntegerField(default=0)),
                ('explanation', models.TextField(blank=True)),
                ('correct_text_answers', models.JSONField(blank=True, default=list)),
                ('case_sensitive', models.BooleanField(default=False)),
                ('code_snippet', models.TextField(blank=True)),
                ('expected_output', models.TextField(blank=True)),
                ('is_published', models.BooleanField(default=True)),
                (
                    'activity',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='questions',
                        to='learning_modules.moduleactivity',
                    ),
                ),
            ],
            options={
                'ordering': ['activity', 'order', 'id'],
            },
        ),
        migrations.CreateModel(
            name='ModuleActivityAttempt',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('attempt_number', models.PositiveSmallIntegerField(default=1)),
                ('score', models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True)),
                ('max_score', models.DecimalField(decimal_places=2, default=0, max_digits=7)),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('submitted_at', models.DateTimeField(blank=True, null=True)),
                ('is_submitted', models.BooleanField(default=False)),
                (
                    'activity',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='attempts',
                        to='learning_modules.moduleactivity',
                    ),
                ),
                (
                    'student',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='module_activity_attempts',
                        to=settings.AUTH_USER_MODEL,
                    ),
                ),
            ],
            options={
                'ordering': ['-started_at'],
            },
        ),
        migrations.CreateModel(
            name='ModuleActivityQuestionChoice',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('text', models.CharField(max_length=500)),
                ('is_correct', models.BooleanField(default=False)),
                ('order', models.PositiveIntegerField(default=0)),
                (
                    'question',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='choices',
                        to='learning_modules.moduleactivityquestion',
                    ),
                ),
            ],
            options={
                'ordering': ['question', 'order', 'id'],
            },
        ),
        migrations.CreateModel(
            name='ModuleActivityMatchingPair',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('left_text', models.CharField(max_length=500)),
                ('right_text', models.CharField(max_length=500)),
                ('order', models.PositiveIntegerField(default=0)),
                (
                    'question',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='matching_pairs',
                        to='learning_modules.moduleactivityquestion',
                    ),
                ),
            ],
            options={
                'ordering': ['question', 'order', 'id'],
            },
        ),
        migrations.CreateModel(
            name='ModuleActivityAnswer',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('text_answer', models.TextField(blank=True)),
                ('choice_order', models.JSONField(blank=True, default=list)),
                ('matching_answer', models.JSONField(blank=True, default=dict)),
                ('is_correct', models.BooleanField(blank=True, null=True)),
                ('points_earned', models.DecimalField(blank=True, decimal_places=2, max_digits=6, null=True)),
                ('feedback', models.TextField(blank=True)),
                (
                    'attempt',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='answers',
                        to='learning_modules.moduleactivityattempt',
                    ),
                ),
                (
                    'question',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='answers',
                        to='learning_modules.moduleactivityquestion',
                    ),
                ),
                (
                    'selected_choice',
                    models.ForeignKey(
                        blank=True,
                        null=True,
                        on_delete=django.db.models.deletion.SET_NULL,
                        related_name='answers',
                        to='learning_modules.moduleactivityquestionchoice',
                    ),
                ),
            ],
            options={
                'ordering': ['question__order', 'question__id'],
            },
        ),
        migrations.AddConstraint(
            model_name='moduleactivityattempt',
            constraint=models.UniqueConstraint(
                fields=('activity', 'student', 'attempt_number'),
                name='unique_module_activity_attempt_number',
            ),
        ),
        migrations.AddConstraint(
            model_name='moduleactivityanswer',
            constraint=models.UniqueConstraint(
                fields=('attempt', 'question'),
                name='unique_module_activity_answer_per_question',
            ),
        ),
    ]
