import time
from django.core.management.base import BaseCommand, CommandError
from payments.models import PaymentRequest
from payments.sync import sync_owner

class Command(BaseCommand):
    help = "Scan merchant wallets and import complete deposit snapshots. No transfers are made."
    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")
        parser.add_argument("--interval", type=int, default=30)
    def handle(self, *args, **options):
        if options["interval"] < 5:
            raise CommandError("Interval must be at least 5 seconds")
        try:
            while True:
                failures = 0
                owners = PaymentRequest.objects.filter(address__isnull=False).order_by("owner_id").values_list("owner_id", flat=True).distinct()
                for owner in owners:
                    try:
                        if sync_owner(owner):
                            self.stdout.write(f"Account {owner}: snapshot updated")
                    except Exception:
                        failures += 1
                        self.stderr.write(f"Account {owner}: sync failed; retained previous snapshot. Check wallet service and node.")
                if options["once"]:
                    if failures:
                        raise CommandError(f"{failures} account(s) failed to sync")
                    return
                time.sleep(options["interval"])
        except KeyboardInterrupt:
            self.stdout.write("Wallet sync stopped")
