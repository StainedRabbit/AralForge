from django.core.management.base import BaseCommand

from grades.models import GradeCategoryChoices, GradingPeriod, GradingTemplate, GradingTemplateItem


class Command(BaseCommand):
    help = 'Create the standard Ezoryx grading template.'

    def handle(self, *args, **options):
        template, _ = GradingTemplate.objects.update_or_create(
            name='Standard Ezoryx Grading',
            defaults={
                'description': 'Default grading setup for prelim, midterm, prefinal, and final periods.',
                'is_default': True,
            },
        )

        items = [
            (GradingPeriod.PRELIM, GradeCategoryChoices.QUIZ, 'Quizzes', 20),
            (GradingPeriod.PRELIM, GradeCategoryChoices.ACTIVITY, 'Activities', 30),
            (GradingPeriod.PRELIM, GradeCategoryChoices.ATTENDANCE, 'Attendance', 10),
            (GradingPeriod.PRELIM, GradeCategoryChoices.EXAM, 'Prelim Exam', 40),
            (GradingPeriod.MIDTERM, GradeCategoryChoices.QUIZ, 'Quizzes', 20),
            (GradingPeriod.MIDTERM, GradeCategoryChoices.ACTIVITY, 'Activities', 25),
            (GradingPeriod.MIDTERM, GradeCategoryChoices.ATTENDANCE, 'Attendance', 10),
            (GradingPeriod.MIDTERM, GradeCategoryChoices.EXAM, 'Midterm Exam', 45),
            (GradingPeriod.PREFINAL, GradeCategoryChoices.QUIZ, 'Quizzes', 15),
            (GradingPeriod.PREFINAL, GradeCategoryChoices.ACTIVITY, 'Activities', 25),
            (GradingPeriod.PREFINAL, GradeCategoryChoices.ATTENDANCE, 'Attendance', 10),
            (GradingPeriod.PREFINAL, GradeCategoryChoices.EXAM, 'Prefinal Exam', 50),
            (GradingPeriod.FINAL, GradeCategoryChoices.QUIZ, 'Quizzes', 15),
            (GradingPeriod.FINAL, GradeCategoryChoices.ACTIVITY, 'Activities', 20),
            (GradingPeriod.FINAL, GradeCategoryChoices.ATTENDANCE, 'Attendance', 10),
            (GradingPeriod.FINAL, GradeCategoryChoices.EXAM, 'Final Exam', 55),
        ]

        for grading_period, category, name, weight in items:
            GradingTemplateItem.objects.update_or_create(
                template=template,
                grading_period=grading_period,
                category=category,
                name=name,
                defaults={'weight': weight},
            )

        GradingTemplate.objects.exclude(pk=template.pk).update(is_default=False)

        self.stdout.write(self.style.SUCCESS('Seeded the standard Ezoryx grading template.'))
