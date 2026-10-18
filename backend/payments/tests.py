
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITestCase

from .models import Credential, PaymentRequest, SendRequest
from .provider import InsufficientFunds, WalletUnavailable


@override_settings(SECURE_SSL_REDIRECT=False)
class PaymentAPITests(APITestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(
            username="one@example.com",
            password="test-password",
        )
        self.other = get_user_model().objects.create_user(
            username="two@example.com",
            password="test-password",
        )
        self.session, self.token = Credential.issue(
            self.user, "Dashboard", "session"
        )
        self.client.credentials(
            HTTP_AUTHORIZATION="Bearer " + self.token
        )
        self.url = "/api/v1/payment-requests/"
        self.payload = {
            "reference": "order-1",
            "amount_zatoshis": "100000",
            "ttl_seconds": 1800,
        }

    def create_payment(self, **kwargs):
        return self.client.post(
            self.url,
            kwargs or self.payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="order-1",
        )

    def create_send(self, key="send-test-1"):
        return self.client.post(
            "/api/v1/sends/",
            {
                "recipient_address": "test-shielded-recipient",
                "amount_zatoshis": "27900",
                "memo": "",
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
        )

    def test_hash_storage_and_revoke(self):
        response = self.client.post(
            "/api/v1/keys/", {"name": "Private Bill"}
        )
        self.assertEqual(response.status_code, 201)
        key = Credential.objects.get(pk=response.data["id"])
        self.assertNotEqual(key.digest, response.data["key"])
        self.assertNotIn("digest", response.data)
        self.client.delete("/api/v1/keys/" + str(key.pk) + "/")
        self.client.credentials(
            HTTP_AUTHORIZATION="Bearer " + response.data["key"]
        )
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_api_key_cannot_create_other_keys(self):
        _, raw = Credential.issue(self.user, "Private Bill", "api")
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + raw)
        self.assertEqual(
            self.client.post(
                "/api/v1/keys/", {"name": "Escalate"}
            ).status_code,
            403,
        )

    @patch(
        "payments.views.allocate_address",
        return_value="TEST_ONLY_ADDRESS_NOT_VALID_ZCASH",
    )
    def test_retry_reuses_address_and_changed_payload_conflicts(
        self, allocate
    ):
        first = self.create_payment()
        second = self.create_payment()
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["id"], second.data["id"])
        allocate.assert_called_once()
        self.assertEqual(
            self.create_payment(
                **{**self.payload, "amount_zatoshis": "2"}
            ).status_code,
            409,
        )

    @patch(
        "payments.views.allocate_address",
        side_effect=WalletUnavailable(),
    )
    def test_outage_preserves_retry_identity(self, allocate):
        first = self.create_payment()
        self.assertEqual(first.status_code, 503)
        payment = PaymentRequest.objects.get()
        self.assertIsNone(payment.address)
        self.assertIsNone(payment.expires_at)
        self.assertEqual(self.create_payment().status_code, 503)
        self.assertEqual(PaymentRequest.objects.count(), 1)
        self.assertEqual(
            allocate.call_args.args[0].pk, payment.pk
        )

    def test_cross_account_detail_and_list_are_isolated(self):
        payment = PaymentRequest.objects.create(
            owner=self.other,
            idempotency_key="other",
            **self.payload,
        )
        self.assertEqual(
            self.client.get(
                self.url + str(payment.pk) + "/"
            ).status_code,
            404,
        )
        self.assertEqual(
            self.client.get(self.url).data["count"], 0
        )

    def test_foreign_key_cannot_be_revoked(self):
        key, _ = Credential.issue(self.other, "Other", "api")
        self.assertEqual(
            self.client.delete(
                "/api/v1/keys/" + str(key.pk) + "/"
            ).status_code,
            404,
        )

    def test_expired_address_is_retained(self):
        payment = PaymentRequest.objects.create(
            owner=self.user,
            idempotency_key="expired",
            **self.payload,
            address="TEST_ONLY_EXPIRED_ADDRESS",
            expires_at=timezone.now() - timedelta(seconds=1),
        )
        self.assertEqual(payment.status, "expired")
        self.assertEqual(
            PaymentRequest.objects.get(pk=payment.pk).address,
            payment.address,
        )

    def test_rejects_invalid_amounts_and_ttls(self):
        for amount in [
            "0", "-1", "0.1", "1e8", "2100000000000001"
        ]:
            self.assertEqual(
                self.create_payment(
                    **{
                        **self.payload,
                        "amount_zatoshis": amount,
                    }
                ).status_code,
                400,
            )
        self.assertEqual(
            self.create_payment(
                **{
                    **self.payload,
                    "ttl_seconds": 1801,
                }
            ).status_code,
            400,
        )
        self.assertEqual(PaymentRequest.objects.count(), 0)

    def test_session_expiry(self):
        self.session.expires_at = (
            timezone.now() - timedelta(seconds=1)
        )
        self.session.save()
        self.assertEqual(
            self.client.get(self.url).status_code,
            401,
        )

    def test_register_login_logout(self):
        self.client.credentials()
        created = self.client.post("/api/v1/auth/register/", {}, format="json")
        self.assertEqual(created.status_code, 201)
        login = self.client.post("/api/v1/auth/login/", {"login_key": created.data["login_key"]}, format="json")
        self.assertEqual(login.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + login.data["token"])
        self.assertEqual(self.client.post("/api/v1/auth/logout/").status_code, 204)
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_health_with_browser_accept_header(self):
        self.client.credentials()
        response = self.client.get(
            "/health/",
            HTTP_ACCEPT=(
                "text/html,application/xhtml+xml,"
                "application/xml;q=0.9,*/*;q=0.8"
            ),
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response["Content-Type"],
            "application/json",
        )
        self.assertEqual(
            response.json()["service"],
            "ZOERDWALLET API",
        )

    def test_combined_history_contains_sent_and_received_details(self):
        from .models import Deposit

        SendRequest.objects.create(
            owner=self.user,
            idempotency_key="send-1",
            recipient_address="test-shielded-recipient",
            amount_zatoshis=123456,
            memo="Invoice 7",
            status="broadcast",
            txids=["a" * 64],
        )
        Deposit.objects.create(
            owner=self.user,
            txid="b" * 64,
            pool=3,
            output_index=0,
            amount_zatoshis=10000,
            memo="Received note",
            mined_height=100,
            block_time=timezone.now(),
        )
        response = self.client.get("/api/v1/transactions/")
        self.assertEqual(response.status_code, 200)
        rows = response.data["results"]
        self.assertEqual(len(rows), 2)
        by_direction = {
            row["direction"]: row for row in rows
        }
        self.assertEqual(
            by_direction["sent"]["amount_zatoshis"],
            "123456",
        )
        self.assertEqual(
            by_direction["sent"]["memo"],
            "Invoice 7",
        )
        self.assertEqual(
            by_direction["sent"]["txid"],
            "a" * 64,
        )
        self.assertIsNone(
            by_direction["sent"]["fee_zatoshis"]
        )
        self.assertEqual(
            by_direction["received"]["memo"],
            "Received note",
        )
        self.assertEqual(
            by_direction["received"]["timestamp_source"],
            "block",
        )
        self.assertTrue(
            all("timestamp" in row for row in rows)
        )

    def test_transaction_history_isolated_by_account(self):
        SendRequest.objects.create(
            owner=self.other,
            idempotency_key="private",
            recipient_address="test-recipient",
            amount_zatoshis=42,
        )
        response = self.client.get(
            "/api/v1/transactions/"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["count"], 0)

    # Regression tests for ZEC sending failures.

    @patch(
        "payments.views.send_zec",
        side_effect=InsufficientFunds(),
    )
    def test_send_insufficient_funds_returns_422(self, send):
        response = self.create_send()

        self.assertEqual(response.status_code, 422)
        self.assertIn(
            "Insufficient ZEC balance",
            str(response.data["detail"]),
        )
        self.assertEqual(SendRequest.objects.count(), 1)

        record = SendRequest.objects.get()
        self.assertEqual(record.status, "failed")
        self.assertIn(
            "Insufficient ZEC balance",
            record.error,
        )
        self.assertEqual(record.txids, [])
        send.assert_called_once()

    @patch(
        "payments.views.send_zec",
        side_effect=WalletUnavailable(),
    )
    def test_send_outage_preserves_uncertain_record(self, send):
        response = self.create_send(
            key="uncertain-send-1"
        )

        self.assertEqual(response.status_code, 503)
        self.assertEqual(SendRequest.objects.count(), 1)

        record = SendRequest.objects.get()
        self.assertIn(
            "Transaction outcome could not be confirmed.",
            record.error,
        )
        self.assertNotEqual(record.status, "broadcast")
        send.assert_called_once()

    @patch(
        "payments.views.send_zec",
        side_effect=WalletUnavailable(),
    )
    def test_uncertain_send_retry_is_blocked(self, send):
        first = self.create_send(
            key="uncertain-send-2"
        )
        second = self.create_send(
            key="uncertain-send-2"
        )

        self.assertEqual(first.status_code, 503)
        self.assertEqual(second.status_code, 409)
        self.assertEqual(SendRequest.objects.count(), 1)
        self.assertIn(
            "uncertain",
            str(second.data["detail"]).lower(),
        )
        send.assert_called_once()

    @patch("payments.views.send_zec")
    def test_broadcast_send_is_not_sent_twice(self, send):
        send.return_value = ["a" * 64]

        first = self.create_send(
            key="broadcast-send-1"
        )
        second = self.create_send(
            key="broadcast-send-1"
        )

        self.assertIn(first.status_code, (200, 201))
        self.assertEqual(second.status_code, 200)
        self.assertEqual(SendRequest.objects.count(), 1)

        record = SendRequest.objects.get()
        self.assertEqual(record.status, "broadcast")
        self.assertEqual(record.txids, ["a" * 64])
        send.assert_called_once()


@override_settings(SECURE_SSL_REDIRECT=False, DASHBOARD_ORIGIN="https://wallet.example.test",
                   EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend")
class PrivateMerchantAuthTests(APITestCase):
    def test_key_only_signup_login_and_no_email(self):
        created = self.client.post("/api/v1/auth/register/", {}, format="json")
        self.assertEqual(created.status_code, 201)
        key = created.data["login_key"]
        self.assertTrue(len(key) >= 32)
        self.assertEqual(get_user_model().objects.filter(email="").count(), 1)
        self.assertFalse(Credential.objects.filter(digest=key).exists())
        self.assertEqual(self.client.post("/api/v1/auth/login/", {"login_key": "bad"}, format="json").status_code, 400)
        login = self.client.post("/api/v1/auth/login/", {"login_key": key}, format="json")
        self.assertEqual(login.status_code, 200)
        self.assertNotIn("login_key", login.data)

    def test_existing_merchant_keeps_api_keys_and_payments(self):
        user = get_user_model().objects.create_user(username="old@example.com", email="old@example.com", password="Strong-Old-Password-2026")
        api, raw = Credential.issue(user, "Existing API", "api")
        payment = PaymentRequest.objects.create(owner=user, idempotency_key="legacy", reference="legacy", amount_zatoshis=100, ttl_seconds=1800)
        old = self.client.post("/api/v1/auth/legacy-login/", {"email": "old@example.com", "password": "Strong-Old-Password-2026"}, format="json")
        self.assertEqual(old.status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + old.data["token"])
        self.client.credentials()
        migrated = self.client.post("/api/v1/auth/migrate/", {"email": "old@example.com", "password": "Strong-Old-Password-2026"}, format="json")
        self.assertEqual(migrated.status_code, 201)
        self.assertEqual(Credential.objects.get(pk=api.pk).revoked_at, None)
        self.assertEqual(PaymentRequest.objects.get(pk=payment.pk).owner_id, user.pk)
        confirmed = self.client.post("/api/v1/auth/confirm-migrate/", {"login_key": migrated.data["login_key"]}, format="json")
        self.assertEqual(confirmed.status_code, 200)
        self.assertEqual(self.client.post("/api/v1/auth/legacy-login/", {"email": "old@example.com", "password": "Strong-Old-Password-2026"}, format="json").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/auth/login/", {"login_key": migrated.data["login_key"]}, format="json").status_code, 200)

    def test_verified_recovery_rotates_login_key(self):
        from django.core import mail
        from urllib.parse import urlparse, parse_qs
        created = self.client.post("/api/v1/auth/register/", {}, format="json")
        key = created.data["login_key"]
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + created.data["token"])
        requested = self.client.post("/api/v1/auth/recovery-email/", {"email": "recover@example.com", "login_key": key}, format="json")
        self.assertEqual(requested.status_code, 200)
        link = mail.outbox[-1].body.split("https://wallet.example.test")[-1].split()[0]
        token = parse_qs(urlparse(link).query)["token"][0]
        self.client.credentials()
        self.assertEqual(self.client.post("/api/v1/auth/verify-email/", {"token": token}, format="json").status_code, 200)
        self.assertEqual(self.client.post("/api/v1/auth/request-recovery/", {"email": "recover@example.com"}, format="json").status_code, 200)
        link = mail.outbox[-1].body.split("https://wallet.example.test")[-1].split()[0]
        query = parse_qs(urlparse(link).query)
        completed = self.client.post("/api/v1/auth/complete-recovery/", {"uid": query["uid"][0], "token": query["token"][0]}, format="json")
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(self.client.post("/api/v1/auth/login/", {"login_key": key}, format="json").status_code, 401)
        self.assertEqual(self.client.post("/api/v1/auth/login/", {"login_key": completed.data["login_key"]}, format="json").status_code, 200)
        self.assertEqual(self.client.post("/api/v1/auth/complete-recovery/", {"uid": query["uid"][0], "token": query["token"][0]}, format="json").status_code, 400)
