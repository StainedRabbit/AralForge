from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [
        ('learning_modules', '0018_production_query_indexes'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='moduleactivity',
            name='allow_late_submissions',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='moduleactivity',
            name='opens_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='moduleactivityattempt',
            name='draft_answers',
            field=models.JSONField(blank=True, default=dict),
        ),
        migrations.AddField(
            model_name='moduleactivityattempt',
            name='question_snapshot',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.CreateModel(
            name='ModuleActivityExtension',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('due_at', models.DateTimeField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('activity', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='extensions', to='learning_modules.moduleactivity')),
                ('granted_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='granted_module_activity_extensions', to=settings.AUTH_USER_MODEL)),
                ('student', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='module_activity_extensions', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['due_at', 'student_id']},
        ),
        migrations.AddConstraint(
            model_name='moduleactivityextension',
            constraint=models.UniqueConstraint(fields=('activity', 'student'), name='unique_module_activity_extension_student'),
        ),
    ]
