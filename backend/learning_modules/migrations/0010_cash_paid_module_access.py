import calendar

from django.db import migrations, models


def add_months(value, months):
    month_index = value.month - 1 + months
    year = value.year + month_index // 12
    month = month_index % 12 + 1
    day = min(value.day, calendar.monthrange(year, month)[1])
    return value.replace(year=year, month=month, day=day)


def prepare_cash_access(apps, schema_editor):
    Module = apps.get_model('learning_modules', 'Module')
    ModuleAccess = apps.get_model('learning_modules', 'ModuleAccess')

    Module.objects.update(is_paid=True)

    for grant in ModuleAccess.objects.all():
        if grant.access_type == 'ADVANCE_STUDY':
            grant.is_active = False
            grant.payment_status = 'UNPAID'
            grant.amount_paid = 0
            grant.expires_at = None
        elif grant.payment_status == 'PAID' and grant.activated_by_id:
            if not grant.expires_at:
                base = grant.activated_at or grant.updated_at
                grant.expires_at = add_months(base, 5)
        else:
            grant.is_active = False
        grant.save()


class Migration(migrations.Migration):

    dependencies = [
        ('learning_modules', '0009_moduleaccess_access_type'),
    ]

    operations = [
        migrations.AlterField(
            model_name='module',
            name='is_paid',
            field=models.BooleanField(default=True),
        ),
        migrations.RunPython(prepare_cash_access, migrations.RunPython.noop),
    ]
