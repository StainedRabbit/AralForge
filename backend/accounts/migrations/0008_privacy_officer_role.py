from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0007_user_middle_name')]
    operations = [
        migrations.AlterField(
            model_name='user',
            name='role',
            field=models.CharField(
                choices=[
                    ('ADMIN', 'Admin'),
                    ('TEACHER', 'Teacher'),
                    ('STUDENT', 'Student'),
                    ('PRIVACY_OFFICER', 'Privacy Officer'),
                ],
                default='STUDENT',
                max_length=20,
            ),
        ),
    ]
