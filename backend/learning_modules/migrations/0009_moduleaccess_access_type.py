from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('learning_modules', '0008_modulelesson_enrichment_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='moduleaccess',
            name='access_type',
            field=models.CharField(
                choices=[
                    ('PAYMENT', 'Payment'),
                    ('ADVANCE_STUDY', 'Advance Study'),
                ],
                default='PAYMENT',
                max_length=20,
            ),
        ),
        migrations.RemoveConstraint(
            model_name='moduleaccess',
            name='unique_module_access_per_student',
        ),
        migrations.AddConstraint(
            model_name='moduleaccess',
            constraint=models.UniqueConstraint(
                fields=('module', 'student', 'access_type'),
                name='unique_module_access_type_per_student',
            ),
        ),
    ]
