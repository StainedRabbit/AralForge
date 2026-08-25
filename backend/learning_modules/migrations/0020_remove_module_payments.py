from django.db import migrations, models


def prepare_access_grants(apps, schema_editor):
    ModuleAccess = apps.get_model('learning_modules', 'ModuleAccess')
    ModuleAccess.objects.exclude(payment_status='PAID').update(is_active=False)
    ModuleAccess.objects.filter(activated_by__isnull=True).update(is_active=False)
    ModuleAccess.objects.filter(access_type='PAYMENT').update(access_type='ENROLLED')


def restore_access_type(apps, schema_editor):
    ModuleAccess = apps.get_model('learning_modules', 'ModuleAccess')
    ModuleAccess.objects.filter(access_type='ENROLLED').update(access_type='PAYMENT')


class Migration(migrations.Migration):
    dependencies = [
        ('learning_modules', '0019_activity_reliability'),
    ]

    operations = [
        migrations.RunPython(prepare_access_grants, restore_access_type),
        migrations.RemoveField(model_name='module', name='is_paid'),
        migrations.RemoveField(model_name='module', name='price'),
        migrations.RemoveField(model_name='moduleaccess', name='amount_paid'),
        migrations.RemoveField(model_name='moduleaccess', name='payment_reference'),
        migrations.RemoveField(model_name='moduleaccess', name='payment_status'),
        migrations.AlterField(
            model_name='moduleaccess',
            name='access_type',
            field=models.CharField(
                choices=[
                    ('ENROLLED', 'Enrolled Module'),
                    ('ADVANCE_STUDY', 'Advance Study'),
                ],
                default='ENROLLED',
                max_length=20,
            ),
        ),
    ]
