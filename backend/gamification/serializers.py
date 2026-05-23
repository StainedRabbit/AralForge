from rest_framework import serializers

from .models import Badge, LevelRule, PointLedger, StudentBadge


class PointLedgerSerializer(serializers.ModelSerializer):
    class Meta:
        model = PointLedger
        fields = ('id', 'student', 'source', 'points', 'description', 'created_at')
        read_only_fields = ('id', 'created_at')


class BadgeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Badge
        fields = ('id', 'name', 'description', 'icon', 'points_required', 'is_active')
        read_only_fields = ('id',)


class StudentBadgeSerializer(serializers.ModelSerializer):
    class Meta:
        model = StudentBadge
        fields = ('id', 'student', 'badge', 'awarded_at')
        read_only_fields = ('id', 'awarded_at')


class LevelRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = LevelRule
        fields = ('id', 'level', 'name', 'points_required')
        read_only_fields = ('id',)
