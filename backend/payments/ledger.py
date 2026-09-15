from datetime import timedelta
from django.db.models import Sum
from django.utils import timezone
from rest_framework import generics, serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema, OpenApiExample, inline_serializer
from .models import Deposit, WalletSync

class DepositOutput(serializers.ModelSerializer):
    amount_zatoshis = serializers.SerializerMethodField()
    confirmations = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    late = serializers.SerializerMethodField()
    class Meta:
        model = Deposit
        fields = ["id", "payment_request", "txid", "pool", "output_index", "amount_zatoshis", "address", "mined_height", "block_time", "confirmations", "status", "late", "first_seen_at"]
    def get_amount_zatoshis(self, obj) -> str:
        return str(obj.amount_zatoshis)
    def get_confirmations(self, obj) -> int:
        tip = self.context.get("chain_height")
        return max(0, tip - obj.mined_height + 1) if obj.active and tip is not None else 0
    def get_status(self, obj) -> str:
        return "confirmed" if obj.active else "reversed"
    def get_late(self, obj) -> bool | None:
        # Block time is the available chain timestamp, not the sender's broadcast time.
        if not obj.payment_request or not obj.payment_request.expires_at:
            return None
        return obj.block_time >= obj.payment_request.expires_at

BALANCE = inline_serializer(name="WalletBalance", fields={
    "total_zatoshis": serializers.CharField(allow_null=True),
    "spendable_zatoshis": serializers.CharField(allow_null=True),
    "pending_zatoshis": serializers.CharField(allow_null=True),
    "confirmed_received_zatoshis": serializers.CharField(allow_null=True),
    "chain_height": serializers.IntegerField(allow_null=True),
    "synced_at": serializers.DateTimeField(allow_null=True),
    "stale": serializers.BooleanField(), "sync_error": serializers.CharField(),
    "settlement_enabled": serializers.BooleanField(),
})
class Balance(APIView):
    @extend_schema(tags=["Wallet"], summary="Read your wallet balance", responses={200: BALANCE}, description="Bearer API key or dashboard token. Values are integer zatoshi strings from the last complete SDK scan. Null amounts mean not yet synced. stale is true after 120 seconds or a sync failure. SDK spendability uses its minimum confirmations policy; it is not permission to withdraw. Settlement remains disabled. confirmed_received is cumulative external mined receipts, not an available balance.", examples=[OpenApiExample("Not yet scanned", value={"total_zatoshis": None, "spendable_zatoshis": None, "pending_zatoshis": None, "confirmed_received_zatoshis": None, "chain_height": None, "synced_at": None, "stale": True, "sync_error": "", "settlement_enabled": False})])
    def get(self, request):
        state = WalletSync.objects.filter(owner=request.user).first()
        ready = state is not None and state.synced_at is not None
        received = Deposit.objects.filter(owner=request.user, active=True).aggregate(total=Sum("amount_zatoshis"))["total"] or 0
        return Response({**{key: str(getattr(state, key)) if ready else None for key in ("total_zatoshis", "spendable_zatoshis", "pending_zatoshis")},
            "confirmed_received_zatoshis": str(received) if ready else None,
            "chain_height": state.chain_height if ready else None,
            "synced_at": state.synced_at if ready else None,
            "stale": not ready or bool(state.last_error) or state.synced_at < timezone.now()-timedelta(seconds=120),
            "sync_error": state.last_error if state else "", "settlement_enabled": False})

class Transactions(generics.ListAPIView):
    serializer_class = DepositOutput
    def get_queryset(self):
        return Deposit.objects.filter(owner=self.request.user).select_related("payment_request")
    def get_serializer_context(self):
        context = super().get_serializer_context()
        context["chain_height"] = WalletSync.objects.filter(owner=self.request.user).values_list("chain_height", flat=True).first()
        return context
    @extend_schema(tags=["Wallet"], summary="List received transaction outputs", description="Paginated deposit history (50 per page). One row per transaction output; one transaction may have multiple outputs. Only mined external receipts are listed; mempool transactions are not included. Reversed rows remain for audit but do not count toward received totals. late compares block time with the request expiry, not broadcast time. An unmatched output has payment_request=null and still belongs to your wallet. Confirmations reflect the last successful scan; check balance.stale.", examples=[OpenApiExample("Deposit output", value={"id": "db32a049-4b34-4c48-ae39-072c5f9395c00", "payment_request": "0787e217-5be4-4258-a9d1-ca991c2558c4", "txid": "ab"*32, "pool": 3, "output_index": 0, "amount_zatoshis": "100000", "address": "u1EXAMPLE_NOT_A_PAYMENT_ADDRESS", "mined_height": 3484368, "block_time": "2026-09-15T16:00:00Z", "confirmations": 1, "status": "confirmed", "late": True, "first_seen_at": "2026-09-15T16:01:00Z"}, response_only=True)])
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)
