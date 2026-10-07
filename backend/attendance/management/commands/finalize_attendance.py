from django.core.management.base import BaseCommand

from attendance.services import finalize_ended_attendance


class Command(BaseCommand):
    help = 'Delete empty attendance sessions and mark missing students absent in ended classes.'

    def handle(self, *args, **options):
        result = finalize_ended_attendance(delete_all_empty=True)
        self.stdout.write(self.style.SUCCESS(
            f"Deleted {result['deleted_sessions']} empty sessions; "
            f"marked {result['created_absences']} unmarked students absent."
        ))
