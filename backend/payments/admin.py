import csv
from django.http import HttpResponse
from django.core.exceptions import PermissionDenied
from django.contrib import admin
from django.contrib.auth import get_user_model

from .models import Credential, Deposit, PaymentRequest, SendRequest, WalletSync


User = get_user_model()

class CSVExportAdmin(admin.ModelAdmin):
    """Export selected rows from the changelist, restricted to superusers."""

    actions = ("export_csv",)

    @admin.action(description="Export selected records as CSV")
    def export_csv(self, request, queryset):
        if not request.user.is_active or not request.user.is_superuser:
            raise PermissionDenied
        fields = [
            field for field in self.model._meta.concrete_fields
            if field.name not in {"password", "digest"}
        ]
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = (
            f'attachment; filename="zoerdwallet_{self.model._meta.model_name}.csv"'
        )
        response["Cache-Control"] = "no-store"
        response.write("\ufeff")
        writer = csv.writer(response)
        writer.writerow([field.name for field in fields])
        for obj in queryset.iterator(chunk_size=500):
            row = []
            for field in fields:
                value = getattr(obj, field.attname)
                value = "" if value is None else str(value)
                if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")):
                    value = "'" + value
                row.append(value)
            writer.writerow(row)
        return response

    def get_actions(self, request):
        actions = super().get_actions(request)
        if not request.user.is_superuser:
            actions.pop("export_csv", None)
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
