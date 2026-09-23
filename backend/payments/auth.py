import hashlib
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission
from .models import Credential

class BearerAuthentication(BaseAuthentication):
    def authenticate(self, request):
        parts = get_authorization_header(request).split()
        if not parts:
            return None
        if len(parts) != 2 or parts[0].lower() != b"bearer":
            raise AuthenticationFailed("Use Authorization: Bearer <token>.")
        digest = hashlib.sha256(parts[1]).hexdigest()
        credential = Credential.objects.select_related("owner").filter(digest=digest, revoked_at=None).first()
        if credential is None or not credential.owner.is_active:
            raise AuthenticationFailed("Invalid or revoked token.")
        if credential.expires_at and credential.expires_at <= timezone.now():
            raise AuthenticationFailed("Token expired.")
        return credential.owner, credential

    def authenticate_header(self, request):
        return "Bearer"

class DashboardOnly(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user.is_authenticated and request.auth and request.auth.kind == "session")
