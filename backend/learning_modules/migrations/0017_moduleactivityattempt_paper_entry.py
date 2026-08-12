import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.db.models import Q


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('grades', '0006_gradeitem_date'),
        ('learning_modules', '0016_remove_modulelessonexample_mini_check'),
    ]

    operations = [
        migrations.AddField(
            model_name='moduleactivityattempt',
            name='submission_method',
            field=models.CharField(
                choices=[('ONLINE', 'Online'), ('PAPER', 'Paper')],
                default='ONLINE',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='moduleactivityattempt',
            name='recorded_by',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='recorded_module_activity_attempts',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='moduleactivityattempt',
            name='paper_grade_item',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='paper_activity_attempts',
                to='grades.gradeitem',
            ),
        ),
        migrations.AddConstraint(
            model_name='moduleactivityattempt',
            constraint=models.UniqueConstraint(
                condition=Q(paper_grade_item__isnull=False),
                fields=('paper_grade_item', 'student'),
                name='unique_paper_activity_attempt_per_grade_item_student',
            ),
        ),
    ]
