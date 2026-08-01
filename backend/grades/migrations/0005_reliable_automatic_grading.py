import django.db.models.deletion
from django.db import migrations, models


def seed_policies_and_preserve_grades(apps, schema_editor):
    Subject = apps.get_model('subjects', 'Subject')
    Policy = apps.get_model('grades', 'SubjectGradingPolicy')
    StudentCategoryGrade = apps.get_model('grades', 'StudentCategoryGrade')
    PeriodGrade = apps.get_model('grades', 'PeriodGrade')
    FinalGrade = apps.get_model('grades', 'FinalGrade')
    for subject in Subject.objects.all():
        Policy.objects.get_or_create(subject=subject)
    StudentCategoryGrade.objects.filter(transmuted_grade__isnull=False).update(completion_status='COMPLETE')
    PeriodGrade.objects.filter(raw_score__isnull=False).update(completion_status='COMPLETE')
    FinalGrade.objects.filter(final_grade__isnull=False).update(completion_status='COMPLETE')


class Migration(migrations.Migration):
    dependencies = [
        ('grades', '0004_class_scoped_grades'),
        ('subjects', '0003_schedulestudent_and_more'),
    ]

    operations = [
        migrations.AddField(model_name='finalgrade', name='completed_period_count', field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name='finalgrade', name='completion_status', field=models.CharField(choices=[('PENDING', 'Pending'), ('COMPLETE', 'Complete'), ('NOT_APPLICABLE', 'Not applicable')], default='PENDING', max_length=20)),
        migrations.AddField(model_name='finalgrade', name='required_period_count', field=models.PositiveIntegerField(default=4)),
        migrations.AddField(model_name='finalgrade', name='withheld_reason', field=models.CharField(blank=True, max_length=200)),
        migrations.AddField(model_name='gradeitem', name='is_required', field=models.BooleanField(default=True)),
        migrations.AddField(model_name='gradingtemplate', name='final_weight', field=models.DecimalField(decimal_places=2, default=25, max_digits=5)),
        migrations.AddField(model_name='gradingtemplate', name='midterm_weight', field=models.DecimalField(decimal_places=2, default=25, max_digits=5)),
        migrations.AddField(model_name='gradingtemplate', name='prefinal_weight', field=models.DecimalField(decimal_places=2, default=25, max_digits=5)),
        migrations.AddField(model_name='gradingtemplate', name='prelim_weight', field=models.DecimalField(decimal_places=2, default=25, max_digits=5)),
        migrations.AddField(model_name='gradingtemplate', name='transmutation_base', field=models.DecimalField(decimal_places=2, default=60, max_digits=6)),
        migrations.AddField(model_name='gradingtemplate', name='transmutation_scale', field=models.DecimalField(decimal_places=2, default=40, max_digits=6)),
        migrations.AddField(model_name='periodgrade', name='completion_status', field=models.CharField(choices=[('PENDING', 'Pending'), ('COMPLETE', 'Complete'), ('NOT_APPLICABLE', 'Not applicable')], default='PENDING', max_length=20)),
        migrations.AddField(model_name='periodgrade', name='pending_item_count', field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name='periodgrade', name='required_item_count', field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name='periodgrade', name='resolved_item_count', field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name='periodgrade', name='withheld_reason', field=models.CharField(blank=True, max_length=200)),
        migrations.AddField(model_name='studentcategorygrade', name='completion_status', field=models.CharField(choices=[('PENDING', 'Pending'), ('COMPLETE', 'Complete'), ('NOT_APPLICABLE', 'Not applicable')], default='COMPLETE', max_length=20)),
        migrations.AddField(model_name='studentcategorygrade', name='pending_item_count', field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name='studentcategorygrade', name='required_item_count', field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name='studentcategorygrade', name='resolved_item_count', field=models.PositiveIntegerField(default=0)),
        migrations.AddField(model_name='studentcategorygrade', name='withheld_reason', field=models.CharField(blank=True, max_length=200)),
        migrations.AddField(model_name='studentgradeitemscore', name='origin', field=models.CharField(choices=[('MANUAL', 'Manual'), ('AUTOMATIC', 'Automatic'), ('OVERRIDE', 'Override')], default='MANUAL', max_length=20)),
        migrations.AddField(model_name='studentgradeitemscore', name='override_reason', field=models.CharField(blank=True, max_length=240)),
        migrations.AddField(model_name='studentgradeitemscore', name='status', field=models.CharField(choices=[('GRADED', 'Graded'), ('EXCUSED', 'Excused')], default='GRADED', max_length=20)),
        migrations.AlterField(model_name='studentcategorygrade', name='raw_score', field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True)),
        migrations.AlterField(model_name='studentcategorygrade', name='total_score', field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True)),
        migrations.AlterField(model_name='studentgradeitemscore', name='raw_score', field=models.DecimalField(blank=True, decimal_places=2, max_digits=7, null=True)),
        migrations.CreateModel(
            name='SubjectGradingPolicy',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('transmutation_base', models.DecimalField(decimal_places=2, default=60, max_digits=6)),
                ('transmutation_scale', models.DecimalField(decimal_places=2, default=40, max_digits=6)),
                ('prelim_weight', models.DecimalField(decimal_places=2, default=25, max_digits=5)),
                ('midterm_weight', models.DecimalField(decimal_places=2, default=25, max_digits=5)),
                ('prefinal_weight', models.DecimalField(decimal_places=2, default=25, max_digits=5)),
                ('final_weight', models.DecimalField(decimal_places=2, default=25, max_digits=5)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('source_template', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='subject_policies', to='grades.gradingtemplate')),
                ('subject', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='grading_policy', to='subjects.subject')),
            ],
        ),
        migrations.RunPython(seed_policies_and_preserve_grades, migrations.RunPython.noop),
    ]
