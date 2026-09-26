from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0008_privacy_officer_role')]

    operations = [
        migrations.AddField(
            model_name='user',
            name='theme_preference',
            field=models.CharField(
                choices=[('system', 'System'), ('light', 'Light'), ('dark', 'Dark')],
                default='system',
                max_length=6,
            ),
        ),
    ]
