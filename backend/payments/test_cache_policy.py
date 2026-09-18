from django.contrib.auth import get_user_model
from django.test import TestCase, override_settings
from .models import Credential


@override_settings(SECURE_SSL_REDIRECT=False)
class CachePolicyTests(TestCase):
    def test_api_success_errors_and_auth_responses_cannot_be_stored(self):
        user = get_user_model().objects.create_user(username="cache@example.com", password="test-password")
        _, token = Credential.issue(user, "Dashboard", "session")
        responses = [
            self.client.get("/api/v1/balance/", HTTP_AUTHORIZATION="Bearer " + token),
            self.client.get("/api/v1/keys/"),
            self.client.post("/api/v1/auth/login/", {"email": "cache@example.com", "password": "test-password"}),
            self.client.get("/api/v1/missing/"),
            self.client.post("/api/v1/auth/logout/", HTTP_AUTHORIZATION="Bearer " + token),
            self.client.get("/health/", HTTP_AUTHORIZATION="Bearer " + token),
        ]
        for response in responses:
            with self.subTest(status=response.status_code):
                self.assertIn("no-store", response.get("Cache-Control", ""))
