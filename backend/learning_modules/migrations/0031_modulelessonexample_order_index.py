from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('learning_modules', '0030_mark_topic_pdfs_outdated')]

    operations = [
        migrations.AddIndex(
            model_name='modulelessonexample',
            index=models.Index(
                fields=['lesson', 'order', 'id'],
                name='lessonex_lesson_order_idx',
            ),
        ),
    ]
