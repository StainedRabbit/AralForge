from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ('accounts', '0003_user_must_change_password'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='studentprofile',
            name='section',
        ),
        migrations.RemoveField(
            model_name='studentprofile',
            name='year_level',
        ),
    ]
