import hashlib
import secrets
import uuid
from datetime import timedelta
from django.conf import settings
from django.db import models
from django.utils import timezone

class Credential(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    name = models.CharField(max_length=80)
    kind = models.CharField(max_length=12, choices=[("session", "Session"), ("api", "API")])
    digest = models.CharField(max_length=64, unique=True)
    prefix = models.CharField(max_length=16)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    @classmethod
    def issue(cls, owner, name, kind):
        raw = "zpay_" + secrets.token_urlsafe(32)
        credential = cls.objects.create(
            owner=owner, name=name, kind=kind,
            digest=hashlib.sha256(raw.encode()).hexdigest(), prefix=raw[:16],
            expires_at=timezone.now() + timedelta(hours=12) if kind == "session" else None,
        )
        return credential, raw

class PaymentRequest(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    idempotency_key = models.CharField(max_length=128)
    reference = models.CharField(max_length=128)
    amount_zatoshis = models.PositiveBigIntegerField()
    ttl_seconds = models.PositiveIntegerField(default=1800)
    address = models.CharField(max_length=1024, null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner", "idempotency_key"], name="unique_owner_payment_key"),
            models.CheckConstraint(condition=models.Q(amount_zatoshis__gte=1, amount_zatoshis__lte=2100000000000000), name="valid_zcash_amount"),
            models.CheckConstraint(condition=models.Q(ttl_seconds__gte=60, ttl_seconds__lte=1800), name="valid_payment_ttl"),
        ]

    @property
    def status(self):
        # Settlement states will come from verified wallet observations, never client input.
        if self.address is None:
            return "provisioning"
        if timezone.now() >= self.expires_at:
            return "expired"
        return "awaiting_payment"
