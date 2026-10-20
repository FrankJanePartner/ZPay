import csv
from datetime import date, datetime

from django.contrib import admin
from django.core.exceptions import PermissionDenied
from django.http import StreamingHttpResponse
from django.utils import timezone
from django.contrib.auth import get_user_model

from .models import Credential, Deposit, PaymentRequest, SendRequest, WalletSync


User = get_user_model()


class _CSVBuffer:
    """csv.writer only needs an object with a write method."""

    def write(self, value):
        return value


def _csv_value(value):
    if value is None:
        return ""
    if isinstance(value, (datetime, date)):
        value = value.isoformat()
    else:
        value = str(value)
    # Spreadsheet applications may interpret imported values as formulas.
    if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
        return "'" + value
    return value


class CSVExportAdmin(admin.ModelAdmin):
    """Download the selected or all filtered rows through Django admin actions."""

    actions = ("export_selected_csv",)
    # Never expose password hashes or authentication-token digests.
    csv_excluded_fields = frozenset({"password", "digest"})

    @admin.action(description="Export selected / all filtered records as CSV")
    def export_selected_csv(self, request, queryset):
        if not request.user.is_active or not request.user.is_staff or not request.user.is_superuser:
            raise PermissionDenied("CSV exports require a superuser.")

        fields = [
            field for field in self.model._meta.concrete_fields
            if field.name not in self.csv_excluded_fields
        ]
        names = [field.attname for field in fields]
        writer = csv.writer(_CSVBuffer())

        def rows():
            yield "\ufeff" + writer.writerow([field.name for field in fields])
            for obj in queryset.order_by(self.model._meta.pk.name).iterator(chunk_size=1000):
                yield writer.writerow([_csv_value(getattr(obj, name)) for name in names])

        filename = f"zoerdwallet_{self.model._meta.model_name}_{timezone.now():%Y%m%d_%H%M%S}.csv"
        response = StreamingHttpResponse(rows(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="{filename}"'
        response["Cache-Control"] = "no-store, private"
        response["X-Content-Type-Options"] = "nosniff"
        return response

    def get_actions(self, request):
        actions = super().get_actions(request)
        if not request.user.is_superuser:
            actions.pop("export_selected_csv", None)
        return actions


if admin.site.is_registered(User):
    admin.site.unregister(User)


@admin.register(User)
class UserAdmin(CSVExportAdmin):
    list_display = ("id", "username", "email", "is_staff", "is_active", "date_joined")
    list_filter = ("is_staff", "is_active")
    search_fields = ("username", "email")
    readonly_fields = ("id", "date_joined", "last_login")


@admin.register(Credential)
class CredentialAdmin(CSVExportAdmin):
    list_display = ("prefix", "owner", "name", "kind", "created_at", "expires_at", "revoked_at")
    list_filter = ("kind", "revoked_at")
    search_fields = ("prefix", "name", "owner__username", "owner__email")
    readonly_fields = ("id", "digest", "prefix", "created_at")


@admin.register(PaymentRequest)
class PaymentRequestAdmin(CSVExportAdmin):
    list_display = ("id", "owner", "reference", "amount_zatoshis", "status", "address", "created_at", "expires_at")
    list_filter = ("created_at", "expires_at")
    search_fields = ("reference", "address", "owner__username", "owner__email")
    readonly_fields = ("id", "created_at", "expires_at")


@admin.register(WalletSync)
class WalletSyncAdmin(CSVExportAdmin):
    list_display = ("owner", "chain_height", "synced_at", "last_attempt_at", "total_zatoshis", "spendable_zatoshis", "pending_zatoshis")
    search_fields = ("owner__username", "owner__email")
    readonly_fields = (
        "owner",
        "chain_height",
        "synced_at",
        "last_attempt_at",
        "last_error",
        "total_zatoshis",
        "spendable_zatoshis",
        "pending_zatoshis",
        "lease",
        "lease_until",
    )


@admin.register(Deposit)
class DepositAdmin(CSVExportAdmin):
    list_display = ("txid", "pool", "output_index", "owner", "amount_zatoshis", "memo", "mined_height", "block_time", "active")
    list_filter = ("pool", "active", "block_time")
    search_fields = ("txid", "address", "memo", "owner__username", "owner__email")
    readonly_fields = ("id", "first_seen_at", "updated_at")


@admin.register(SendRequest)
class SendRequestAdmin(CSVExportAdmin):
    list_display = ("id", "owner", "amount_zatoshis", "recipient_address", "memo", "status", "created_at", "updated_at")
    list_filter = ("status", "created_at")
    search_fields = ("recipient_address", "memo", "owner__username", "owner__email")
    readonly_fields = ("id", "created_at", "updated_at", "txids", "error")
