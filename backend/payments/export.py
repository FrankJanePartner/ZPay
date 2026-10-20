"""Read-only, merchant-scoped CSV export of wallet activity."""
import csv
from datetime import date, datetime, time, timedelta, timezone as dt_timezone
from decimal import Decimal
from django.http import StreamingHttpResponse
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView
from .auth import DashboardOnly
from .models import Deposit, SendRequest

MAX_DAYS = 366

def parse_day(raw, label):
    if not isinstance(raw, str):
        raise ValidationError({label: "Provide a date in YYYY-MM-DD format."})
    try:
        parsed = date.fromisoformat(raw)
    except ValueError:
        raise ValidationError({label: "Provide a valid date in YYYY-MM-DD format."})
    if parsed.isoformat() != raw:
        raise ValidationError({label: "Provide a date in YYYY-MM-DD format."})
    return parsed

def safe_cell(value):
    text = "" if value is None else str(value)
    if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
        return "'" + text
    return text

class Echo:
    def write(self, value):
        return value

class ExportTransactions(APIView):
    permission_classes = [DashboardOnly]

    def get(self, request):
        start = parse_day(request.query_params.get("start"), "start")
        end = parse_day(request.query_params.get("end"), "end")
        if end < start:
            raise ValidationError({"end": "End date must be on or after start date."})
        if (end - start).days >= MAX_DAYS:
            raise ValidationError({"end": "Choose a date range of at most 366 days."})
        beginning = datetime.combine(start, time.min, tzinfo=dt_timezone.utc)
        exclusive_end = datetime.combine(end + timedelta(days=1), time.min, tzinfo=dt_timezone.utc)

        deposits = Deposit.objects.filter(
            owner=request.user, block_time__gte=beginning, block_time__lt=exclusive_end
        ).select_related("payment_request").order_by("-block_time", "-id")
        sends = SendRequest.objects.filter(
            owner=request.user, created_at__gte=beginning, created_at__lt=exclusive_end
        ).order_by("-created_at", "-id")

        headers = [
            "Timestamp (UTC)", "Timestamp source", "Direction", "Amount (ZEC)",
            "Amount (zatoshis)", "Status", "Transaction ID", "Recipient / receiving address",
            "Memo", "Network fee (ZEC)", "Fee verified", "Payment request ID",
            "Confirmations", "Record ID",
        ]

        def entries():
            # Merge two ordered querysets without loading all transaction records into memory.
            from heapq import merge
            def received():
                for item in deposits.iterator(chunk_size=500):
                    yield (-item.block_time.timestamp(), str(item.id), item, "received")
            def sent():
                for item in sends.iterator(chunk_size=500):
                    yield (-item.created_at.timestamp(), str(item.id), item, "sent")
            for _, _, item, direction in merge(received(), sent()):
                if direction == "received":
                    yield [
                        item.block_time.isoformat(), "block", direction,
                        str(Decimal(item.amount_zatoshis) / Decimal(100000000)),
                        item.amount_zatoshis, "confirmed" if item.active else "reversed",
                        item.txid, item.address, item.memo, "", "No",
                        item.payment_request_id, "", item.id,
                    ]
                else:
                    yield [
                        item.created_at.isoformat(), "local_request", direction,
                        str(Decimal(item.amount_zatoshis) / Decimal(100000000)),
                        item.amount_zatoshis, item.status,
                        "; ".join(item.txids or []), item.recipient_address, item.memo,
                        "", "No", "", "", item.id,
                    ]

        def stream():
            writer = csv.writer(Echo())
            yield "\ufeff"
            yield writer.writerow(headers)
            for row in entries():
                yield writer.writerow([safe_cell(value) for value in row])

        response = StreamingHttpResponse(stream(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = (
            f'attachment; filename="zoerdwallet_transactions_{start}_{end}.csv"'
        )
        response["Cache-Control"] = "private, no-store"
        response["X-Content-Type-Options"] = "nosniff"
        return response
