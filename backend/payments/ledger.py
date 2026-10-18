from datetime import timedelta
from django.db.models import Sum
from django.utils import timezone
from rest_framework import generics, serializers
from rest_framework.response import Response
from rest_framework.views import APIView
from drf_spectacular.utils import extend_schema, OpenApiExample, inline_serializer
from .models import Deposit, WalletSync, SendRequest
from rest_framework.pagination import PageNumberPagination

class DepositOutput(serializers.ModelSerializer):
    amount_zatoshis = serializers.SerializerMethodField()
    confirmations = serializers.SerializerMethodField()
    status = serializers.SerializerMethodField()
    late = serializers.SerializerMethodField()
    class Meta:
        model = Deposit
        fields = ["id", "payment_request", "txid", "pool", "output_index", "amount_zatoshis", "memo", "address", "mined_height", "block_time", "confirmations", "status", "late", "first_seen_at"]
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

class Transactions(APIView):
    """Combined wallet activity. Fees remain null until verified by the wallet SDK."""

    @extend_schema(tags=["Wallet"], summary="List sent and received wallet activity",
                   description="Newest-first, 50 per page. Sent timestamps are local request times, not verified block timestamps. Network fees are null until verified from chain data.")
    def get(self, request):
        chain_height = WalletSync.objects.filter(owner=request.user).values_list("chain_height", flat=True).first()
        incoming = Deposit.objects.filter(owner=request.user).select_related("payment_request")
        outgoing = SendRequest.objects.filter(owner=request.user)
        rows = []
        for deposit in incoming:
            record = DepositOutput(deposit, context={"chain_height": chain_height}).data
            record.update({
                "direction": "received", "timestamp": deposit.block_time.isoformat(),
                "timestamp_source": "block", "fee_zatoshis": None,
                "fee_verified": False, "recipient_address": None,
            })
            rows.append(record)
        for sent in outgoing:
            # A send request can be signed without a confirmed broadcast.
            # Never imply an on-chain confirmation from the local journal.
            rows.append({
                "id": str(sent.id), "direction": "sent",
                "txid": sent.txids[0] if sent.txids else None,
                "txids": sent.txids, "recipient_address": sent.recipient_address,
                "amount_zatoshis": str(sent.amount_zatoshis),
                "memo": sent.memo, "status": sent.status,
                "timestamp": sent.created_at.isoformat(),
                "timestamp_source": "local_request",
                "fee_zatoshis": None, "fee_verified": False,
                "confirmations": None, "error": sent.error,
                "payment_request": None,
            })
        rows.sort(key=lambda row: row["timestamp"], reverse=True)
        paginator = PageNumberPagination()
        paginator.page_size = 50
        page = paginator.paginate_queryset(rows, request, view=self)
        return paginator.get_paginated_response(page)
