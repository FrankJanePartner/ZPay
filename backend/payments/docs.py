"""OpenAPI contracts and examples for the public API."""
from drf_spectacular.extensions import OpenApiAuthenticationExtension
from drf_spectacular.utils import extend_schema, extend_schema_view, OpenApiExample, OpenApiParameter, OpenApiResponse, inline_serializer
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView
from rest_framework import serializers
from . import views
from .serializers import CredentialsInput, LoginSecretInput, KeyInput, KeyOutput, PaymentInput, PaymentOutput, SendInput, SendOutput

class BearerScheme(OpenApiAuthenticationExtension):
    target_class = "payments.auth.BearerAuthentication"
    name = "BearerToken"
    def get_security_definition(self, auto_schema):
        return {"type": "http", "scheme": "bearer", "description": "Paste a dashboard token or API key, without the Bearer prefix. Key management and logout require a dashboard token."}

# Both representations use the homepage; no separate documentation route is needed.
def documentation_home(request):
    if request.GET.get("schema") == "1":
        return SpectacularAPIView.as_view(authentication_classes=[], permission_classes=[])(request)
    return SpectacularSwaggerView.as_view(url="?schema=1", authentication_classes=[], permission_classes=[])(request)

ISSUED_SESSION = inline_serializer(name="IssuedMerchantSession", fields={"token": serializers.CharField(), "expires_in": serializers.IntegerField(), "login_key": serializers.CharField()})
MESSAGE = inline_serializer(name="MerchantAuthMessage", fields={"detail": serializers.CharField()})
RECOVERY_EMAIL = inline_serializer(name="MerchantRecoveryEmail", fields={"email": serializers.EmailField(), "login_key": serializers.CharField()})
RECOVERY_REQUEST = inline_serializer(name="MerchantRecoveryRequest", fields={"email": serializers.EmailField()})
RECOVERY_FINISH = inline_serializer(name="MerchantRecoveryFinish", fields={"uid": serializers.CharField(), "token": serializers.CharField()})
SESSION = inline_serializer(name="DashboardSession", fields={"token": serializers.CharField(), "expires_in": serializers.IntegerField()})
HEALTH = inline_serializer(name="ServiceHealth", fields={"service": serializers.CharField(), "status": serializers.CharField(), "settlement_enabled": serializers.BooleanField()})
class IssuedKey(KeyOutput):
    key = serializers.CharField(help_text="Shown once. Save securely; list responses never return the secret.")
    class Meta(KeyOutput.Meta):
        fields = [*KeyOutput.Meta.fields, "key"]

PID = "0787e217-5be4-4258-a9d1-ca991c2558c4"
KEY = {"id": "86e12063-f955-45b0-812a-9b4b10d2cac4", "name": "Private Bill", "prefix": "zpay_example", "created_at": "2026-09-15T15:00:00Z", "revoked_at": None}
PAYMENT = {"id": PID, "reference": "private-bill-order-1042", "amount_zatoshis": "100000", "address": "u1EXAMPLE_NOT_A_PAYMENT_ADDRESS", "status": "awaiting_payment", "received_zatoshis": "0", "funding_status": "unpaid", "created_at": "2026-09-15T15:00:00Z", "expires_at": "2026-09-15T15:30:00Z"}
def example(name, value, **kw):
    return OpenApiExample(name, value=value, **kw)
def error(message):
    return OpenApiResponse(response={"type": "object", "properties": {"detail": {"type": "string"}}, "required": ["detail"]}, description=message, examples=[example("Error", {"detail": message})])
AUTH_ERRORS = {401: error("Invalid or revoked token."), 429: error("Request was throttled. Retry after the indicated delay.")}
BAD_INPUT = OpenApiResponse(response={"type": "object", "additionalProperties": {}}, description="Field validation errors; values may be a string or list of messages.", examples=[example("Invalid field", {"password": ["This password is too short. It must contain at least 12 characters."]})])
CREDENTIAL_EXAMPLES = [example("Credentials", {"email": "developer@example.com", "password": "Example-only-Password!42"}, request_only=True), example("Dashboard session", {"token": "zpay_EXAMPLE_DASHBOARD_TOKEN", "expires_in": 43200}, response_only=True)]

views.Health = extend_schema_view(get=extend_schema(tags=["Health"], summary="Check API availability", description="Checks Django availability only; not node sync, wallet readiness or settlement.", responses={200: HEALTH}, examples=[example("Healthy API", {"service": "ZOERDWALLET API", "status": "ok", "settlement_enabled": False})]))(views.Health)
views.Register = extend_schema_view(post=extend_schema(tags=["Authentication"], summary="Register private merchant", description="No email or password required. Returns one-time login_key and dashboard session. Save the login_key securely.", request=None, responses={201: ISSUED_SESSION, 429: AUTH_ERRORS[429]}, examples=[example("Merchant created", {"token":"zpay_EXAMPLE_SESSION","expires_in":43200,"login_key":"zpay_EXAMPLE_ONE_TIME_LOGIN_SECRET"}, response_only=True)]))(views.Register)
views.Login = extend_schema_view(post=extend_schema(tags=["Authentication"], summary="Log in", description="Returns a new dashboard token. Use Authorize to supply it for key management.", request=LoginSecretInput, responses={200: SESSION, 400: BAD_INPUT, **AUTH_ERRORS}, examples=CREDENTIAL_EXAMPLES))(views.Login)
views.LegacyLogin = extend_schema_view(post=extend_schema(tags=["Authentication"], summary="Existing account password login", request=CredentialsInput, responses={200: SESSION, **AUTH_ERRORS}, examples=CREDENTIAL_EXAMPLES))(views.LegacyLogin)
views.LegacyMigrate = extend_schema_view(post=extend_schema(tags=["Authentication"], summary="Start existing merchant migration", request=CredentialsInput, responses={201: ISSUED_SESSION, **AUTH_ERRORS}, examples=[example("Migration secret", {"token":"zpay_EXAMPLE_SESSION","expires_in":43200,"login_key":"zpay_EXAMPLE_ONE_TIME_LOGIN_SECRET"}, response_only=True)]))(views.LegacyMigrate)
views.ConfirmLegacyMigrate = extend_schema_view(post=extend_schema(tags=["Authentication"], summary="Confirm saved login secret and disable old password", request=LoginSecretInput, responses={200: SESSION, **AUTH_ERRORS}, examples=[example("Dashboard session", {"token":"zpay_EXAMPLE_SESSION","expires_in":43200}, response_only=True)]))(views.ConfirmLegacyMigrate)
views.ActivateLoginSecret = extend_schema_view(post=extend_schema(tags=["Authentication"], summary="Activate secret for an existing authenticated merchant", request=None, responses={201: inline_serializer(name="ActivatedLoginSecret", fields={"login_key":serializers.CharField()}), **AUTH_ERRORS}, examples=[example("One-time secret", {"login_key":"zpay_EXAMPLE_ONE_TIME_LOGIN_SECRET"}, response_only=True)]))(views.ActivateLoginSecret)
views.SetRecoveryEmail = extend_schema_view(post=extend_schema(tags=["Authentication"], summary="Send recovery email verification", request=RECOVERY_EMAIL, responses={200: MESSAGE, **AUTH_ERRORS}, examples=[example("Email queued", {"detail":"Check your email to verify recovery access."}, response_only=True)]))(views.SetRecoveryEmail)
views.VerifyRecoveryEmail = extend_schema_view(post=extend_schema(tags=["Authentication"], summary="Verify recovery email", request=inline_serializer(name="MerchantVerificationToken", fields={"token":serializers.CharField()}), responses={200: MESSAGE, **AUTH_ERRORS}, examples=[example("Email verified", {"detail":"Recovery email verified."}, response_only=True)]))(views.VerifyRecoveryEmail)
views.RequestRecovery = extend_schema_view(post=extend_schema(tags=["Authentication"], summary="Request optional email recovery", request=RECOVERY_REQUEST, responses={200: MESSAGE, **AUTH_ERRORS}, examples=[example("Request accepted", {"detail":"If this address is verified, a recovery link will be sent."}, response_only=True)]))(views.RequestRecovery)
views.CompleteRecovery = extend_schema_view(post=extend_schema(tags=["Authentication"], summary="Replace lost merchant login secret", request=RECOVERY_FINISH, responses={200: ISSUED_SESSION, **AUTH_ERRORS}, examples=[example("Replacement secret", {"token":"zpay_EXAMPLE_SESSION","expires_in":43200,"login_key":"zpay_EXAMPLE_REPLACEMENT_SECRET"}, response_only=True)]))(views.CompleteRecovery)
views.Logout = extend_schema_view(post=extend_schema(tags=["Authentication"], summary="Revoke the current dashboard session", description="Dashboard token only. No request body. Success is HTTP 204 with an empty response body; clear the token from the frontend.", request=None, responses={204: OpenApiResponse(description="Session revoked. Empty body."), 403: error("You do not have permission to perform this action."), **AUTH_ERRORS}))(views.Logout)
views.Keys = extend_schema_view(
    get=extend_schema(tags=["API keys"], summary="List your API keys", description="Dashboard token only. Returns an unpaginated array, including revoked keys. Secret keys are never returned here.", responses={200: KeyOutput(many=True), 403: error("You do not have permission to perform this action."), **AUTH_ERRORS}, examples=[example("Key metadata", KEY, response_only=True)]),
    post=extend_schema(tags=["API keys"], summary="Create an API key", description="Dashboard token only. Store the returned key securely: it is shown once. Use it as a bearer token for payment requests.", request=KeyInput, responses={201: IssuedKey, 400: BAD_INPUT, 403: error("You do not have permission to perform this action."), **AUTH_ERRORS}, examples=[example("Key name", {"name": "Private Bill"}, request_only=True), example("Issued key", {**KEY, "key": "zpay_EXAMPLE_API_KEY"}, response_only=True)])
)(views.Keys)
views.RevokeKey = extend_schema_view(delete=extend_schema(tags=["API keys"], summary="Revoke an API key", description="Dashboard token only. Supply the key UUID from the list response. Success is HTTP 204 with an empty body. Keys belonging to another account return 404.", request=None, responses={204: OpenApiResponse(description="Key revoked. Empty body."), 404: error("Not found."), 403: error("You do not have permission to perform this action."), **AUTH_ERRORS}))(views.RevokeKey)
PAYMENT_EXAMPLES = [example("Awaiting payment", PAYMENT, response_only=True), example("Expired window", {**PAYMENT, "status": "expired"}, response_only=True), example("Allocation pending", {**PAYMENT, "address": None, "expires_at": None, "status": "provisioning"}, response_only=True)]
views.Payments = extend_schema_view(
    get=extend_schema(tags=["Payment requests"], summary="List your payment requests", description="Bearer API key or dashboard token. Paginated (50 per page), newest first. Only the authenticated account's requests are visible. Render reference, amount, address, status and expires_at; an expired address remains recorded.", responses={200: PaymentOutput(many=True), **AUTH_ERRORS}, examples=PAYMENT_EXAMPLES),
    post=extend_schema(tags=["Payment requests"], summary="Create or retry a receiving-address request", description="Bearer API key or dashboard token. Amount is an integer string in zatoshis; maximum 2100000000000000. ttl_seconds is 60–1800 (default 1800), measured from address allocation. Use a new Idempotency-Key per order, and the same key and exact payload for retries. Returns 201 for a new request or 200 for a replay/recovered request. A changed payload with the same key returns 409. On 503, retry with the SAME key and payload. Expiration never destroys an address or funds.", request=PaymentInput, parameters=[OpenApiParameter("Idempotency-Key", str, OpenApiParameter.HEADER, required=True, description="1–128 letters, digits, dots, underscores, colons or hyphens.", examples=[example("Order identifier", "private-bill-order-1042")])], responses={201: PaymentOutput, 200: PaymentOutput, 400: BAD_INPUT, 409: error("Idempotency-Key already used with a different payload."), 503: error("Wallet service unavailable. Retry with the same Idempotency-Key."), **AUTH_ERRORS}, examples=[example("Request an address", {"reference": "private-bill-order-1042", "amount_zatoshis": "100000", "ttl_seconds": 1800}, request_only=True), example("Allocated address", PAYMENT, response_only=True)])
)(views.Payments)
views.PaymentDetail = extend_schema_view(get=extend_schema(tags=["Payment requests"], summary="Read a payment request", description="Bearer API key or dashboard token. Use the request UUID returned on creation. A request belonging to another account returns 404. status reflects the payment window. received_zatoshis and funding_status reflect mined deposits from the last complete scan, including late payments. Check /api/v1/balance/ for scan freshness.", responses={200: PaymentOutput, 404: error("Not found."), **AUTH_ERRORS}, examples=PAYMENT_EXAMPLES))(views.PaymentDetail)

# Document both successful send responses, including idempotent replay.
SEND = {"id": PID, "recipient_address": "u1EXAMPLE_RECIPIENT", "amount_zatoshis": "100000", "memo": "Example payment", "status": "broadcast", "txids": ["example-transaction-id"], "error": ""}
views.Sends = extend_schema_view(
    get=extend_schema(tags=["Sends"], summary="List outgoing transfers", description="Paginated outgoing transfers belonging to the authenticated account.", responses={200: SendOutput(many=True), **AUTH_ERRORS}, examples=[example("Outgoing transfer", SEND, response_only=True)]),
    post=extend_schema(tags=["Sends"], summary="Send or retry a Zcash transfer", description="Use the same Idempotency-Key and payload when retrying.", request=SendInput, parameters=[OpenApiParameter("Idempotency-Key", str, OpenApiParameter.HEADER, required=True)], responses={201: SendOutput, 200: SendOutput, 400: BAD_INPUT, 409: error("Idempotency-Key already used with a different payload."), 503: error("Wallet service unavailable. Retry with the same Idempotency-Key."), **AUTH_ERRORS}, examples=[example("Outgoing transfer", SEND, response_only=True), example("Transfer request", {"recipient_address": "u1EXAMPLE_RECIPIENT", "amount_zatoshis": "100000", "memo": "Example payment"}, request_only=True)])
)(views.Sends)
