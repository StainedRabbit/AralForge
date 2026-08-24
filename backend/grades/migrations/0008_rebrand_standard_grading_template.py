from django.db import migrations


LEGACY_NAME = 'Standard Ezoryx Grading'
ARALFORGE_NAME = 'Standard AralForge Grading'


def rename_template_forward(apps, schema_editor):
    grading_template = apps.get_model('grades', 'GradingTemplate')
    grading_template.objects.filter(name=LEGACY_NAME).update(name=ARALFORGE_NAME)


def rename_template_reverse(apps, schema_editor):
    grading_template = apps.get_model('grades', 'GradingTemplate')
    grading_template.objects.filter(name=ARALFORGE_NAME).update(name=LEGACY_NAME)


class Migration(migrations.Migration):
    dependencies = [
        ('grades', '0007_production_query_indexes'),
    ]

    operations = [
        migrations.RunPython(rename_template_forward, rename_template_reverse),
    ]
