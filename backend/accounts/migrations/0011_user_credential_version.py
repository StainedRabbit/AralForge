from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('accounts', '0010_postgres_student_middle_name_search_index')]

    operations = [
        migrations.AddField(
            model_name='user',
            name='credential_version',
            field=models.PositiveIntegerField(default=0),
        ),
    ]
