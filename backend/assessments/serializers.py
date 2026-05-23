from rest_framework import serializers

from .models import Answer, Assessment, AssessmentAttempt, Choice, Question


class ChoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Choice
        fields = ('id', 'question', 'text', 'is_correct', 'order')
        read_only_fields = ('id',)


class QuestionSerializer(serializers.ModelSerializer):
    choices = ChoiceSerializer(many=True, read_only=True)

    class Meta:
        model = Question
        fields = ('id', 'assessment', 'question_type', 'prompt', 'points', 'order', 'explanation', 'choices')
        read_only_fields = ('id',)


class AssessmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Assessment
        fields = (
            'id',
            'title',
            'kind',
            'subject',
            'module',
            'instructions',
            'points_possible',
            'time_limit_minutes',
            'max_attempts',
            'randomize_questions',
            'show_answers_after_submit',
            'counts_toward_grade',
            'is_published',
            'opens_at',
            'closes_at',
            'created_at',
            'updated_at',
        )
        read_only_fields = ('id', 'created_at', 'updated_at')


class AssessmentAttemptSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssessmentAttempt
        fields = (
            'id',
            'assessment',
            'student',
            'attempt_number',
            'score',
            'started_at',
            'submitted_at',
            'is_submitted',
        )
        read_only_fields = ('id', 'started_at')

    def validate_student(self, value):
        request = self.context.get('request')
        if request and not request.user.is_admin_teacher and value != request.user:
            raise serializers.ValidationError('Students can only start attempts for themselves.')

        return value


class AnswerSerializer(serializers.ModelSerializer):
    class Meta:
        model = Answer
        fields = (
            'id',
            'attempt',
            'question',
            'selected_choice',
            'text_answer',
            'code_answer',
            'is_correct',
            'points_earned',
            'feedback',
        )
        read_only_fields = ('id',)
