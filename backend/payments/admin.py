from django.contrib import admin
from django.contrib.auth import get_user_model

from .models import Credential, Deposit, PaymentRequest, SendRequest, WalletSync


User = get_user_model()

if admin.site.is_registered(User):
    admin.site.unregister(User)


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    list_display = ("id", "username", "email", "is_staff", "is_active", "date_joined")
    list_filter = ("is_staff", "is_active")
    search_fields = ("username", "email")
    readonly_fields = ("id", "date_joined", "last_login")


@admin.register(Credential)
class CredentialAdmin(admin.ModelAdmin):
    list_display = ("prefix", "owner", "name", "kind", "created_at", "expires_at", "revoked_at")
    list_filter = ("kind", "revoked_at")
    search_fields = ("prefix", "name", "owner__username", "owner__email")
    readonly_fields = ("id", "digest", "prefix", "created_at")


@admin.register(PaymentRequest)
class PaymentRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "reference", "amount_zatoshis", "status", "address", "created_at", "expires_at")
    list_filter = ("created_at", "expires_at")
    search_fields = ("reference", "address", "owner__username", "owner__email")
    readonly_fields = ("id", "created_at", "expires_at")


@admin.register(WalletSync)
class WalletSyncAdmin(admin.ModelAdmin):
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
class DepositAdmin(admin.ModelAdmin):
    list_display = ("txid", "pool", "output_index", "owner", "amount_zatoshis", "memo", "mined_height", "block_time", "active")
    list_filter = ("pool", "active", "block_time")
    search_fields = ("txid", "address", "memo", "owner__username", "owner__email")
    readonly_fields = ("id", "first_seen_at", "updated_at")


@admin.register(SendRequest)
class SendRequestAdmin(admin.ModelAdmin):
    list_display = ("id", "owner", "amount_zatoshis", "recipient_address", "memo", "status", "created_at", "updated_at")
    list_filter = ("status", "created_at")
    search_fields = ("recipient_address", "memo", "owner__username", "owner__email")
    readonly_fields = ("id", "created_at", "updated_at", "txids", "error")
