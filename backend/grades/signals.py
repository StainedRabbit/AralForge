from django.db.models.signals import post_save
from django.dispatch import receiver

from subjects.models import Subject

from .models import GradingTemplate


@receiver(post_save, sender=Subject)
def apply_default_grading_template(sender, instance, created, **kwargs):
    if not created:
        return

    template = GradingTemplate.objects.filter(is_default=True).first()

    if template:
        template.apply_to_subject(instance)
