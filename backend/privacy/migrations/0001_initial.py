import django.db.models.deletion
import uuid

from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True
    dependencies = [
        ('accounts', '0008_privacy_officer_role'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]
    operations = [
        migrations.CreateModel(
            name='LegalAcknowledgment',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('document', models.CharField(choices=[('PRIVACY', 'Privacy Notice'), ('TERMS', 'Terms of Use'), ('ACCEPTABLE_USE', 'Acceptable Use and Academic Integrity')], max_length=30)),
                ('version', models.CharField(max_length=30)),
                ('effective_date', models.DateField()),
                ('action', models.CharField(choices=[('ACKNOWLEDGED', 'Acknowledged'), ('AGREED', 'Agreed')], max_length=20)),
                ('acknowledged_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='legal_acknowledgments', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['acknowledged_at', 'id']},
        ),
        migrations.CreateModel(
            name='PrivacyRequest',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('request_type', models.CharField(choices=[('ACCESS', 'Access'), ('CORRECTION', 'Correction'), ('PORTABILITY', 'Portability'), ('OBJECTION', 'Objection'), ('ERASURE_BLOCKING', 'Erasure or blocking')], max_length=30)),
                ('details', models.TextField(max_length=4000)),
                ('status', models.CharField(choices=[('SUBMITTED', 'Submitted'), ('IDENTITY_VERIFICATION', 'Identity verification'), ('IN_REVIEW', 'In review'), ('APPROVED', 'Approved'), ('DENIED', 'Denied'), ('COMPLETED', 'Completed'), ('CANCELLED', 'Cancelled')], default='SUBMITTED', max_length=30)),
                ('public_response', models.TextField(blank=True, max_length=4000)),
                ('submitted_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('decided_at', models.DateTimeField(blank=True, null=True)),
                ('completed_at', models.DateTimeField(blank=True, null=True)),
                ('assigned_to', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='assigned_privacy_requests', to=settings.AUTH_USER_MODEL)),
                ('subject', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='privacy_requests', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-submitted_at']},
        ),
        migrations.CreateModel(
            name='PrivacyRequestEvent',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event', models.CharField(max_length=40)),
                ('from_status', models.CharField(blank=True, max_length=30)),
                ('to_status', models.CharField(blank=True, max_length=30)),
                ('public_message', models.TextField(blank=True, max_length=2000)),
                ('internal_note', models.TextField(blank=True, max_length=4000)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('actor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='privacy_request_events', to=settings.AUTH_USER_MODEL)),
                ('request', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='events', to='privacy.privacyrequest')),
            ],
            options={'ordering': ['created_at', 'id']},
        ),
        migrations.AddConstraint(
            model_name='legalacknowledgment',
            constraint=models.UniqueConstraint(fields=('user', 'document', 'version', 'action'), name='unique_legal_acknowledgment'),
        ),
        migrations.AddIndex(model_name='privacyrequest', index=models.Index(fields=['status', 'submitted_at'], name='privacy_status_submitted_idx')),
        migrations.AddIndex(model_name='privacyrequest', index=models.Index(fields=['subject', 'submitted_at'], name='privacy_subject_submitted_idx')),
    ]
