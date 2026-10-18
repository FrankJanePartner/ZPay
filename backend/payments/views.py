
import re
import hashlib
import secrets
import uuid
from urllib.parse import quote
from django.conf import settings
from django.core import signing
from django.core.mail import send_mail
from django.contrib.auth.tokens import default_token_generator
from rest_framework.throttling import ScopedRateThrottle
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
    LoginSecretInput,
    RecoveryEmailInput,
    SignedTokenInput,
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


# Login secrets are independent from API credentials and wallet recovery phrases.
# The database stores only SHA-256 digests of high-entropy random secrets.
def _issue_login_key(user):
    Credential.objects.filter(owner=user, kind="login", revoked_at__isnull=True).update(revoked_at=timezone.now())
    _, raw = Credential.issue(user, "Merchant login", "login")
    return raw


def _issue_session(user):
    _, token = Credential.issue(user, "Dashboard", "session")
    return {"token": token, "expires_in": 43200}


def _verified_email(user):
    if not user.email:
        return False
    digest = hashlib.sha256(f"verified:{user.pk}:{user.email.lower()}".encode()).hexdigest()
    return Credential.objects.filter(owner=user, kind="verified", digest=digest, revoked_at__isnull=True).exists()


def _send_recovery_email(email, subject, path):
    origin = settings.DASHBOARD_ORIGIN.rstrip("/")
    if not origin.startswith("https://") and not settings.DEBUG:
        raise RuntimeError("Configure HTTPS ZPAY_DASHBOARD_ORIGIN before enabling recovery")
    if not origin:
        raise RuntimeError("Configure ZPAY_DASHBOARD_ORIGIN")
    send_mail(subject, f"Open this link to continue:\n{origin}{path}\n\nThis link expires in one hour. If you did not request it, ignore this email.", settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False)


class Register(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        with transaction.atomic():
            user = get_user_model()(username="merchant_" + uuid.uuid4().hex)
            user.set_unusable_password()
            user.save()
            login_key = _issue_login_key(user)
            session = _issue_session(user)
        return Response({**session, "login_key": login_key}, status=201)


class Login(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = LoginSecretInput(data=request.data)
        data.is_valid(raise_exception=True)
        digest = hashlib.sha256(data.validated_data["login_key"].encode()).hexdigest()
        key = Credential.objects.select_related("owner").filter(
            digest=digest, kind="login", revoked_at__isnull=True
        ).first()
        if key is None or not key.owner.is_active:
            return Response({"detail": "Invalid login secret."}, status=401)
        return Response(_issue_session(key.owner))


class LegacyLogin(APIView):
    # Existing accounts only; disabled for each account after secret activation.
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = CredentialsInput(data=request.data)
        data.is_valid(raise_exception=True)
        user = authenticate(
            username=data.validated_data["email"].lower(),
            password=data.validated_data["password"],
        )
        if user is None or Credential.objects.filter(owner=user, kind="login").exists():
            return Response({"detail": "Invalid credentials."}, status=401)
        return Response(_issue_session(user))


class LegacyMigrate(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = CredentialsInput(data=request.data)
        data.is_valid(raise_exception=True)
        user = authenticate(username=data.validated_data["email"].lower(),
                            password=data.validated_data["password"])
        if user is None:
            return Response({"detail": "Invalid credentials."}, status=401)
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().get(pk=user.pk)
            if Credential.objects.filter(owner=user, kind="login").exists():
                return Response({"detail": "Account already migrated."}, status=409)
            raw = _issue_login_key(user)
            user.set_unusable_password()
            user.save(update_fields=["password"])
            Credential.objects.filter(owner=user, kind="session").update(revoked_at=timezone.now())
            session = _issue_session(user)
        return Response({**session, "login_key": raw}, status=201)


class ActivateLoginSecret(APIView):
    permission_classes = [DashboardOnly]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        # Preserves the same user ID, payments, deposits and API credentials.
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().get(pk=request.user.pk)
            if Credential.objects.filter(owner=user, kind="login").exists():
                return Response({"detail": "Login secret already activated."}, status=409)
            raw = _issue_login_key(user)
            user.set_unusable_password()
            user.save(update_fields=["password"])
            Credential.objects.filter(owner=user, kind="session").exclude(pk=request.auth.pk).update(revoked_at=timezone.now())
        return Response({"login_key": raw}, status=201)


class SetRecoveryEmail(APIView):
    permission_classes = [DashboardOnly]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = RecoveryEmailInput(data=request.data)
        data.is_valid(raise_exception=True)
        email = data.validated_data["email"].lower()
        # Do not disclose whether another merchant owns an email.
        if get_user_model().objects.filter(email__iexact=email).exclude(pk=request.user.pk).exists():
            return Response({"detail": "This email cannot be used."}, status=400)
        token = signing.dumps({"uid": request.user.pk, "email": email, "prior_email": request.user.email}, salt="zoerd-recovery-verify")
        try:
            _send_recovery_email(email, "Verify your ZOERDWALLET recovery email", "/verify-email?token=" + quote(token))
        except Exception:
            return Response({"detail": "Recovery email delivery is unavailable. Try again later."}, status=503)
        return Response({"detail": "Check your email to verify recovery access."})


class VerifyRecoveryEmail(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = SignedTokenInput(data=request.data)
        data.is_valid(raise_exception=True)
        try:
            payload = signing.loads(data.validated_data["token"], salt="zoerd-recovery-verify", max_age=3600)
            user = get_user_model().objects.get(pk=payload["uid"], is_active=True)
            email = payload["email"].lower()
            prior_email = payload["prior_email"]
        except (signing.BadSignature, signing.SignatureExpired, KeyError, ValueError, get_user_model().DoesNotExist):
            return Response({"detail": "Verification link invalid or expired."}, status=400)
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().get(pk=user.pk)
            if user.email != prior_email:
                return Response({"detail": "Verification link no longer valid."}, status=400)
            if get_user_model().objects.filter(email__iexact=email).exclude(pk=user.pk).exists():
                return Response({"detail": "This email cannot be used."}, status=400)
            Credential.objects.filter(owner=user, kind="verified").update(revoked_at=timezone.now())
            user.email = email
            user.save(update_fields=["email"])
            digest = hashlib.sha256(f"verified:{user.pk}:{email}".encode()).hexdigest()
            Credential.objects.get_or_create(owner=user, kind="verified", digest=digest, defaults={"name": "Verified recovery email", "prefix": "verified"})
            Credential.objects.filter(owner=user, kind="verified", digest=digest).update(revoked_at=None)
        return Response({"detail": "Recovery email verified."})


class RequestRecovery(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        data = RecoveryEmailInput(data=request.data)
        data.is_valid(raise_exception=True)
        email = data.validated_data["email"].lower()
        user = get_user_model().objects.filter(email__iexact=email, is_active=True).first()
        if user and _verified_email(user) and Credential.objects.filter(owner=user, kind="login", revoked_at__isnull=True).exists():
            token = default_token_generator.make_token(user)
            try:
                _send_recovery_email(email, "Reset your ZOERDWALLET login secret", f"/recover?uid={user.pk}&token={quote(token)}")
            except Exception:
                return Response({"detail": "Recovery email delivery is unavailable. Try again later."}, status=503)
        return Response({"detail": "If this address is verified, a recovery link will be sent."})


class CompleteRecovery(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"

    def post(self, request):
        uid = request.data.get("uid")
        token = request.data.get("token")
        if not isinstance(uid, int) and (not isinstance(uid, str) or not uid.isdecimal()):
            return Response({"detail": "Invalid recovery link."}, status=400)
        if not isinstance(token, str) or len(token) > 256:
            return Response({"detail": "Invalid recovery link."}, status=400)
        with transaction.atomic():
            user = get_user_model().objects.select_for_update().filter(pk=uid, is_active=True).first()
            if user is None or not _verified_email(user) or not default_token_generator.check_token(user, token):
                return Response({"detail": "Recovery link invalid or expired."}, status=400)
            raw = _issue_login_key(user)
            user.set_unusable_password()  # Invalidate password-reset token after use.
            user.save(update_fields=["password"])
            Credential.objects.filter(owner=user, kind="session").update(revoked_at=timezone.now())
            session = _issue_session(user)
        return Response({**session, "login_key": raw})


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
