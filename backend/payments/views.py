
import re
from datetime import timedelta

from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.utils import extend_schema, OpenApiExample
from rest_framework import generics
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .auth import DashboardOnly
from .models import Credential, PaymentRequest, SendRequest
from .provider import (
    InsufficientFunds,
    WalletUnavailable,
    allocate_address,
    send_zec,
)
from .serializers import (
    CredentialsInput,
    KeyInput,
    KeyOutput,
    PaymentInput,
    PaymentOutput,
    SendInput,
    SendOutput,
)


SEND_IN_PROGRESS = (
    "Transaction outcome could not be confirmed. "
    "Send processing began; reconciliation is required."
)

SEND_OUTCOME_UNCERTAIN = (
    "Transaction outcome could not be confirmed. "
    "Check transaction history and contact support before another send."
)

SEND_INSUFFICIENT_FUNDS = (
    "Insufficient ZEC balance to cover the transfer "
    "amount and network fee."
)

SEND_UNCERTAIN_RESPONSE = (
    "This transaction's outcome is uncertain or processing is "
    "already underway. Check transaction history and contact "
    "support before attempting another send."
)


class Health(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({
            "service": "ZOERDWALLET API",
            "status": "ok",
            "settlement_enabled": False,
        })


class Register(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        data = CredentialsInput(data=request.data)
        data.is_valid(raise_exception=True)

        email = data.validated_data["email"].lower()
        password = data.validated_data["password"]
        user = get_user_model()(username=email, email=email)

        try:
            validate_password(password, user)
        except DjangoValidationError as error:
            raise ValidationError({"password": error.messages})

        try:
            with transaction.atomic():
                user.set_password(password)
                user.save()
                _, token = Credential.issue(user, "Dashboard", "session")
        except IntegrityError:
            raise ValidationError({
                "email": "Account cannot be created with this email."
            })

        return Response({"token": token, "expires_in": 43200}, status=201)


class Login(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        data = CredentialsInput(data=request.data)
        data.is_valid(raise_exception=True)

        user = authenticate(
            username=data.validated_data["email"].lower(),
            password=data.validated_data["password"],
        )

        if user is None:
            return Response({"detail": "Invalid credentials."}, status=401)

        _, token = Credential.issue(user, "Dashboard", "session")
        return Response({"token": token, "expires_in": 43200})


class Logout(APIView):
    permission_classes = [DashboardOnly]

    def post(self, request):
        request.auth.revoked_at = timezone.now()
        request.auth.save(update_fields=["revoked_at"])
        return Response(status=204)


class Keys(APIView):
    permission_classes = [DashboardOnly]

    def get(self, request):
        keys = Credential.objects.filter(
            owner=request.user,
            kind="api",
        ).order_by("-created_at")

        return Response(KeyOutput(keys, many=True).data)

    def post(self, request):
        data = KeyInput(data=request.data)
        data.is_valid(raise_exception=True)

        key, raw = Credential.issue(
            request.user,
            data.validated_data["name"],
            "api",
        )

        return Response({
            **KeyOutput(key).data,
            "key": raw,
        }, status=201)


class RevokeKey(APIView):
    permission_classes = [DashboardOnly]

    def delete(self, request, pk):
        key = get_object_or_404(
            Credential,
            pk=pk,
            owner=request.user,
            kind="api",
        )

        key.revoked_at = timezone.now()
        key.save(update_fields=["revoked_at"])

        return Response(status=204)


class Payments(generics.ListCreateAPIView):
    serializer_class = PaymentOutput

    def get_queryset(self):
        return PaymentRequest.objects.filter(
            owner=self.request.user
        ).order_by("-created_at", "-id")

    def create(self, request, *args, **kwargs):
        key = request.headers.get("Idempotency-Key", "")

        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", key):
            raise ValidationError({
                "Idempotency-Key": (
                    "Provide 1–128 letters, digits, dots, "
                    "underscores, colons or hyphens."
                )
            })

        data = PaymentInput(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data

        payment, created = PaymentRequest.objects.get_or_create(
            owner=request.user,
            idempotency_key=key,
            defaults=values,
        )

        if any(
            getattr(payment, field) != value
            for field, value in values.items()
        ):
            return Response({
                "detail": (
                    "Idempotency-Key already used with a different payload."
                )
            }, status=409)

        if payment.address is None:
            # Persist the request UUID before wallet allocation.
            address = allocate_address(payment)

            try:
                with transaction.atomic():
                    PaymentRequest.objects.filter(
                        pk=payment.pk,
                        address__isnull=True,
                    ).update(
                        address=address,
                        expires_at=(
                            timezone.now()
                            + timedelta(seconds=payment.ttl_seconds)
                        ),
                    )
            except IntegrityError:
                raise WalletUnavailable() from None

            payment.refresh_from_db()

            if payment.address != address:
                raise WalletUnavailable()

        return Response(
            PaymentOutput(payment).data,
            status=201 if created else 200,
        )


class PaymentDetail(generics.RetrieveAPIView):
    serializer_class = PaymentOutput

    def get_queryset(self):
        return PaymentRequest.objects.filter(
            owner=self.request.user
        )


class Sends(generics.ListCreateAPIView):
    serializer_class = SendOutput

    @extend_schema(
        examples=[
            OpenApiExample(
                "Sent request list",
                value={
                    "count": 0,
                    "next": None,
                    "previous": None,
                    "results": [],
                },
                response_only=True,
            )
        ]
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        return SendRequest.objects.filter(
            owner=self.request.user
        ).order_by("-created_at", "-id")

    def create(self, request, *args, **kwargs):
        key = request.headers.get("Idempotency-Key", "")

        if not re.fullmatch(r"[A-Za-z0-9_.:-]{1,128}", key):
            raise ValidationError({
                "Idempotency-Key": (
                    "Provide 1–128 letters, digits, dots, "
                    "underscores, colons or hyphens."
                )
            })

        data = SendInput(data=request.data)
        data.is_valid(raise_exception=True)
        values = data.validated_data

        send_request, created = SendRequest.objects.get_or_create(
            owner=request.user,
            idempotency_key=key,
            defaults=values,
        )

        if (
            send_request.recipient_address != values["recipient_address"]
            or send_request.amount_zatoshis != values["amount_zatoshis"]
            or send_request.memo != values.get("memo", "")
        ):
            return Response(
                {
                    "detail": (
                        "Idempotency-Key already used "
                        "with a different payload."
                    )
                },
                status=409,
            )

        if send_request.status == "broadcast":
            return Response(
                SendOutput(send_request).data,
                status=200,
            )

        # Atomically claim the send before network I/O.
        # Only a never-started pending request or a confirmed
        # insufficient-funds failure may be claimed.
        #
        # The error marker is committed before contacting Rust.
        # A crash or timeout therefore leaves the request blocked
        # for reconciliation rather than making it retryable.
        claimed = SendRequest.objects.filter(
            pk=send_request.pk,
            owner=request.user,
        ).filter(
            Q(status="pending", error="")
            | Q(
                status="failed",
                error=SEND_INSUFFICIENT_FUNDS,
            )
        ).update(
            status="pending",
            error=SEND_IN_PROGRESS,
        )

        if claimed != 1:
            send_request.refresh_from_db()

            if send_request.status == "broadcast":
                return Response(
                    SendOutput(send_request).data,
                    status=200,
                )

            return Response(
                {"detail": SEND_UNCERTAIN_RESPONSE},
                status=409,
            )

        # Only the request that claimed the row reaches the wallet.
        # Do not wrap the wallet call in a database transaction.
        try:
            txids = send_zec(send_request)

        except InsufficientFunds:
            # The wallet explicitly rejected the proposal
            # before broadcasting. This is a confirmed failure.
            SendRequest.objects.filter(
                pk=send_request.pk,
                status="pending",
                error=SEND_IN_PROGRESS,
            ).update(
                status="failed",
                error=SEND_INSUFFICIENT_FUNDS,
            )
            raise

        except WalletUnavailable:
            # The wallet outcome is not confirmed.
            # Keep the record blocked until reconciliation.
            SendRequest.objects.filter(
                pk=send_request.pk,
                status="pending",
                error=SEND_IN_PROGRESS,
            ).update(
                error=SEND_OUTCOME_UNCERTAIN,
            )
            raise

        # A successful wallet response includes transaction IDs.
        # Preserve the claimed marker if the database write fails:
        # it must not become eligible for another send.
        SendRequest.objects.filter(
            pk=send_request.pk,
            status="pending",
            error=SEND_IN_PROGRESS,
        ).update(
            status="broadcast",
            txids=txids,
            error="",
        )

        send_request.refresh_from_db()

        return Response(
            SendOutput(send_request).data,
            status=201 if created else 200,
        )
