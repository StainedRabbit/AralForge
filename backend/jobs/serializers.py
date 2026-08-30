from rest_framework import serializers

from .models import BackgroundJob


class BackgroundJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = BackgroundJob
        fields = (
            'id', 'job_type', 'owner', 'status', 'attempts', 'progress', 'total', 'result',
            'error', 'created_at', 'started_at', 'finished_at',
        )
        read_only_fields = fields
