from django.core.management.base import BaseCommand

from grades.models import GradeItem, GradeItemSourceType
from grades.source_sync import sync_items


class Command(BaseCommand):
    help = 'Idempotently synchronize linked grade-item scores from source work.'

    def add_arguments(self, parser):
        parser.add_argument('--item', type=int, help='Synchronize only one grade item ID.')

    def handle(self, *args, **options):
        queryset = GradeItem.objects.exclude(source_type=GradeItemSourceType.MANUAL)
        if options['item']:
            queryset = queryset.filter(pk=options['item'])
        changed = sync_items(queryset)
        self.stdout.write(self.style.SUCCESS(f'Synchronized {changed} grade score(s).'))
