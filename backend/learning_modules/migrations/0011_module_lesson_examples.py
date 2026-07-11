from django.core.validators import FileExtensionValidator
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('learning_modules', '0010_cash_paid_module_access'),
    ]

    operations = [
        migrations.CreateModel(
            name='ModuleLessonExample',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('order', models.PositiveIntegerField(default=0)),
                ('title', models.CharField(max_length=180)),
                ('image', models.FileField(blank=True, upload_to='module_lesson_examples/', validators=[FileExtensionValidator(allowed_extensions=['png', 'jpg', 'jpeg', 'webp', 'svg'])])),
                ('alt_text', models.CharField(blank=True, max_length=240)),
                ('body', models.TextField(blank=True)),
                ('common_mistake', models.TextField(blank=True)),
                ('mini_check', models.TextField(blank=True)),
                ('is_published', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('lesson', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='lesson_examples', to='learning_modules.modulelesson')),
            ],
            options={
                'ordering': ['lesson', 'order', 'id'],
            },
        ),
    ]
