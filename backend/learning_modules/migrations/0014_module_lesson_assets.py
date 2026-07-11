from django.db import migrations, models
import django.core.validators
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('learning_modules', '0013_lesson_main_activity'),
    ]

    operations = [
        migrations.CreateModel(
            name='ModuleLessonAsset',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                (
                    'file',
                    models.FileField(
                        upload_to='module_lesson_assets/',
                        validators=[
                            django.core.validators.FileExtensionValidator(
                                allowed_extensions=['png', 'jpg', 'jpeg', 'webp', 'svg'],
                            ),
                        ],
                    ),
                ),
                ('original_name', models.CharField(max_length=255)),
                ('alt_text', models.CharField(blank=True, max_length=240)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                (
                    'lesson',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='lesson_assets',
                        to='learning_modules.modulelesson',
                    ),
                ),
            ],
            options={
                'ordering': ['lesson', '-created_at', 'id'],
            },
        ),
    ]
