# Generated manually for mock exams with module-selected topics.

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('assessments', '0001_initial'),
        ('learning_modules', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='assessment',
            name='mock_question_count',
            field=models.PositiveSmallIntegerField(default=25),
        ),
        migrations.AddField(
            model_name='assessmentattempt',
            name='selected_topics',
            field=models.ManyToManyField(blank=True, related_name='mock_exam_attempts', to='learning_modules.module'),
        ),
        migrations.AddField(
            model_name='question',
            name='topics',
            field=models.ManyToManyField(blank=True, related_name='assessment_questions', to='learning_modules.module'),
        ),
        migrations.CreateModel(
            name='AssessmentAttemptQuestion',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('order', models.PositiveIntegerField(default=0)),
                ('attempt', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='selected_questions', to='assessments.assessmentattempt')),
                ('question', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='mock_attempts', to='assessments.question')),
            ],
            options={
                'ordering': ['attempt', 'order', 'id'],
            },
        ),
        migrations.AddConstraint(
            model_name='assessmentattemptquestion',
            constraint=models.UniqueConstraint(fields=('attempt', 'question'), name='unique_question_per_mock_attempt'),
        ),
    ]
