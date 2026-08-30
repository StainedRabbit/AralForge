from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0004_remove_studentprofile_section_and_year_level')]

    operations = [
        migrations.AddIndex(
            model_name='user',
            index=models.Index(fields=['role', 'is_active'], name='user_role_active_idx'),
        ),
        migrations.AddIndex(
            model_name='user',
            index=models.Index(fields=['last_name', 'first_name', 'id'], name='user_name_order_idx'),
        ),
    ]
