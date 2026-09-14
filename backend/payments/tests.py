from datetime import timedelta
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase
from .models import Credential, PaymentRequest
from .provider import WalletUnavailable

@override_settings(SECURE_SSL_REDIRECT=False)
class PaymentAPITests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="one@example.com", password="test-password")
        self.other = get_user_model().objects.create_user(username="two@example.com", password="test-password")
        self.session, self.token = Credential.issue(self.user, "Dashboard", "session")
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + self.token)
        self.url = "/api/v1/payment-requests/"
        self.payload = {"reference": "order-1", "amount_zatoshis": "100000", "ttl_seconds": 1800}

    def create_payment(self, **kwargs):
        return self.client.post(self.url, kwargs or self.payload, format="json", HTTP_IDEMPOTENCY_KEY="order-1")

    def test_hash_storage_and_revoke(self):
        response = self.client.post("/api/v1/keys/", {"name": "Private Bill"})
        self.assertEqual(response.status_code, 201)
        key = Credential.objects.get(pk=response.data["id"])
        self.assertNotEqual(key.digest, response.data["key"])
        self.assertNotIn("digest", response.data)
        self.client.delete("/api/v1/keys/" + str(key.pk) + "/")
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + response.data["key"])
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_api_key_cannot_create_other_keys(self):
        _, raw = Credential.issue(self.user, "Private Bill", "api")
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + raw)
        self.assertEqual(self.client.post("/api/v1/keys/", {"name": "Escalate"}).status_code, 403)

    @patch("payments.views.allocate_address", return_value="TEST_ONLY_ADDRESS_NOT_VALID_ZCASH")
    def test_retry_reuses_address_and_changed_payload_conflicts(self, allocate):
        first = self.create_payment()
        second = self.create_payment()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["id"], second.data["id"])
        allocate.assert_called_once()
        self.assertEqual(self.create_payment(**{**self.payload, "amount_zatoshis": "2"}).status_code, 409)

    @patch("payments.views.allocate_address", side_effect=WalletUnavailable())
    def test_outage_preserves_retry_identity(self, allocate):
        first = self.create_payment()
        self.assertEqual(first.status_code, 503)
        payment = PaymentRequest.objects.get()
        self.assertIsNone(payment.address)
        self.assertIsNone(payment.expires_at)
        self.assertEqual(self.create_payment().status_code, 503)
        self.assertEqual(PaymentRequest.objects.count(), 1)
        self.assertEqual(allocate.call_args.args[0].pk, payment.pk)

    def test_cross_account_detail_and_list_are_isolated(self):
        payment = PaymentRequest.objects.create(owner=self.other, idempotency_key="other", **self.payload)
        self.assertEqual(self.client.get(self.url + str(payment.pk) + "/").status_code, 404)
        self.assertEqual(self.client.get(self.url).data["count"], 0)

    def test_foreign_key_cannot_be_revoked(self):
        key, _ = Credential.issue(self.other, "Other", "api")
        self.assertEqual(self.client.delete("/api/v1/keys/" + str(key.pk) + "/").status_code, 404)

    def test_expired_address_is_retained(self):
        payment = PaymentRequest.objects.create(
            owner=self.user, idempotency_key="expired", **self.payload,
            address="TEST_ONLY_EXPIRED_ADDRESS",
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        self.assertEqual(payment.status, "expired")
        self.assertEqual(PaymentRequest.objects.get(pk=payment.pk).address, payment.address)

    def test_rejects_invalid_amounts_and_ttls(self):
        for amount in ["0", "-1", "0.1", "1e8", "2100000000000001"]:
            self.assertEqual(self.create_payment(**{**self.payload, "amount_zatoshis": amount}).status_code, 400)
        self.assertEqual(self.create_payment(**{**self.payload, "ttl_seconds": 1801}).status_code, 400)
        self.assertEqual(PaymentRequest.objects.count(), 0)

    def test_session_expiry(self):
        self.session.expires_at = timezone.now() - timedelta(seconds=1)
        self.session.save()
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_register_login_logout(self):
        self.client.credentials()
        payload = {"email": "new@example.com", "password": "Another-Strong-Password-482"}
        self.assertEqual(self.client.post("/api/v1/auth/register/", payload).status_code, 201)
        login = self.client.post("/api/v1/auth/login/", payload)
        self.assertEqual(login.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + login.data["token"])
        self.assertEqual(self.client.post("/api/v1/auth/logout/").status_code, 204)
        self.assertEqual(self.client.get(self.url).status_code, 401)
