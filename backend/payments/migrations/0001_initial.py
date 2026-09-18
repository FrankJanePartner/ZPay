import uuid
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion

class Migration(migrations.Migration):
    initial = True
    dependencies = [migrations.swappable_dependency(settings.AUTH_USER_MODEL)]
    operations = [
        migrations.CreateModel(name="Credential", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("name", models.CharField(max_length=80)),
            ("kind", models.CharField(choices=[("session", "Session"), ("api", "API")], max_length=12)),
            ("digest", models.CharField(max_length=64, unique=True)),
            ("prefix", models.CharField(max_length=16)),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("expires_at", models.DateTimeField(blank=True, null=True)),
            ("revoked_at", models.DateTimeField(blank=True, null=True)),
            ("owner", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
        ]),
        migrations.CreateModel(name="PaymentRequest", fields=[
            ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
            ("idempotency_key", models.CharField(max_length=128)),
            ("reference", models.CharField(max_length=128)),
            ("amount_zatoshis", models.PositiveBigIntegerField()),
            ("ttl_seconds", models.PositiveIntegerField(default=1800)),
            ("address", models.CharField(blank=True, max_length=1024, null=True, unique=True)),
            ("created_at", models.DateTimeField(auto_now_add=True)),
            ("expires_at", models.DateTimeField(blank=True, null=True)),
            ("owner", models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, to=settings.AUTH_USER_MODEL)),
        ], options={"constraints": [
            models.UniqueConstraint(fields=("owner", "idempotency_key"), name="unique_owner_payment_key"),
            models.CheckConstraint(condition=models.Q(amount_zatoshis__gte=1, amount_zatoshis__lte=2100000000000000), name="valid_zcash_amount"),
            models.CheckConstraint(condition=models.Q(ttl_seconds__gte=60, ttl_seconds__lte=1800), name="valid_payment_ttl"),
        ]}),
    ]
