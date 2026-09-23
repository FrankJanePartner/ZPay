import copy
import uuid
from datetime import timedelta
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from .models import Credential, Deposit, PaymentRequest, WalletSync
from .sync import sync_owner

class WalletSyncTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username="sync-test")
        self.other = get_user_model().objects.create_user(username="other-sync-test")
        self.payment = PaymentRequest.objects.create(owner=self.user, idempotency_key="one", reference="order", amount_zatoshis=100000, address="u1TEST", expires_at=timezone.now()-timedelta(minutes=10))
        self.data = {"merchant_id": str(self.user.pk), "network": "main", "complete": True, "chain_height": 100,
            "fully_scanned_height": 100, "total_zatoshis": "100000", "spendable_zatoshis": "100000", "pending_zatoshis": "0",
            "outputs": [{"txid": "ab"*32, "pool": 3, "output_index": 0, "amount_zatoshis": "100000", "address": "u1TEST", "mined_height": 99, "block_time": int(timezone.now().timestamp())}]}
        _, token = Credential.issue(self.user, "test", "api")
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + token)
    def run_sync(self, data=None):
        with patch("payments.sync.fetch_snapshot", return_value=self.data if data is None else data):
            return sync_owner(self.user.pk)
    def test_replays_and_late_deposits_are_attributed_once(self):
        self.run_sync(); self.run_sync()
        self.assertEqual(Deposit.objects.count(), 1)
        payment = self.client.get(f"/api/v1/payment-requests/{self.payment.id}/").json()
        self.assertEqual(payment["status"], "expired")
        self.assertEqual(payment["funding_status"], "paid")
        self.assertEqual(payment["received_zatoshis"], "100000")
        row = self.client.get("/api/v1/transactions/").json()["results"][0]
        self.assertTrue(row["late"])
        self.assertEqual(row["confirmations"], 2)
    def test_reorg_reverses_and_reappearance_restores_same_record(self):
        self.run_sync()
        original = Deposit.objects.get().id
        removed = {**self.data, "outputs": [], "total_zatoshis": "0", "spendable_zatoshis": "0"}
        self.run_sync(removed)
        self.assertFalse(Deposit.objects.get().active)
        self.assertEqual(self.client.get("/api/v1/balance/").json()["confirmed_received_zatoshis"], "0")
        self.run_sync()
        self.assertEqual(Deposit.objects.get().id, original)
        self.assertTrue(Deposit.objects.get().active)
    def test_invalid_partial_or_duplicate_snapshot_preserves_balances(self):
        self.run_sync()
        for changes in ({"complete": False}, {"merchant_id": str(self.other.pk)}, {"fully_scanned_height": 99}, {"outputs": self.data["outputs"]*2}, {"total_zatoshis": "-1"}):
            with self.assertRaises(ValueError):
                self.run_sync({**self.data, **changes})
            self.assertTrue(Deposit.objects.get().active)
            balance = self.client.get("/api/v1/balance/").json()
            self.assertEqual(balance["total_zatoshis"], "100000")
            self.assertTrue(balance["stale"])
    def test_outage_and_concurrent_worker_preserve_snapshot(self):
        self.run_sync()
        with patch("payments.sync.fetch_snapshot", side_effect=TimeoutError):
            with self.assertRaises(TimeoutError): sync_owner(self.user.pk)
        self.assertTrue(self.client.get("/api/v1/balance/").json()["stale"])
        WalletSync.objects.filter(owner=self.user).update(lease=uuid.uuid4(), lease_until=timezone.now()+timedelta(minutes=3))
        with patch("payments.sync.fetch_snapshot") as fetch:
            self.assertFalse(sync_owner(self.user.pk))
            fetch.assert_not_called()
    def test_changed_output_rolls_back_entire_snapshot(self):
        self.run_sync()
        bad = copy.deepcopy(self.data)
        bad["outputs"][0]["amount_zatoshis"] = "1"
        with self.assertRaises(ValueError): self.run_sync(bad)
        self.assertEqual(Deposit.objects.get().amount_zatoshis, 100000)
        self.assertTrue(Deposit.objects.get().active)
    def test_cross_account_isolation_and_unsynced_null_balance(self):
        self.run_sync()
        _, token = Credential.issue(self.other, "test", "api")
        self.client.credentials(HTTP_AUTHORIZATION="Bearer " + token)
        self.assertEqual(self.client.get("/api/v1/transactions/").json()["count"], 0)
        self.assertIsNone(self.client.get("/api/v1/balance/").json()["total_zatoshis"])
        self.assertEqual(self.client.get(f"/api/v1/payment-requests/{self.payment.id}/").status_code, 404)
    def test_unmatched_address_does_not_attach_to_other_account(self):
        PaymentRequest.objects.create(owner=self.other, idempotency_key="two", reference="other", amount_zatoshis=1, address="u1OTHER", expires_at=timezone.now())
        data = copy.deepcopy(self.data)
        data["outputs"][0]["address"] = "u1OTHER"
        self.run_sync(data)
        self.assertIsNone(Deposit.objects.get().payment_request)
        self.assertEqual(Deposit.objects.get().owner, self.user)
    def test_partial_and_overpayments_multiple_outputs(self):
        data = copy.deepcopy(self.data)
        data["outputs"][0]["amount_zatoshis"] = "50000"
        self.run_sync(data)
        self.assertEqual(self.client.get(f"/api/v1/payment-requests/{self.payment.id}/").json()["funding_status"], "partially_paid")
        data["outputs"].append({**data["outputs"][0], "output_index": 1, "amount_zatoshis": "100000"})
        self.run_sync(data)
        payment = self.client.get(f"/api/v1/payment-requests/{self.payment.id}/").json()
        self.assertEqual(payment["funding_status"], "overpaid")
        self.assertEqual(payment["received_zatoshis"], "150000")

    def test_extended_scan_budget_reaches_service_and_preserves_lease(self):
        import json
        import os
        from .sync import fetch_snapshot
        with patch.dict(os.environ, {"ZPAY_WALLET_SYNC_TIMEOUT_SECONDS": "600"}):
            with self.settings(WALLET_SERVICE_URL="http://127.0.0.1:9070", WALLET_SERVICE_TOKEN="test-only"):
                with patch("payments.sync.urlopen") as transport:
                    transport.return_value.__enter__.return_value.read.return_value = json.dumps(self.data).encode()
                    self.assertEqual(fetch_snapshot(self.user.pk), self.data)
                    args, kwargs = transport.call_args
                    self.assertEqual(kwargs["timeout"], 615)
                    self.assertEqual(json.loads(args[0].data)["timeout_seconds"], 600)
            def fetch(owner_id):
                state = WalletSync.objects.get(owner_id=owner_id)
                self.assertGreater((state.lease_until - timezone.now()).total_seconds(), 650)
                return self.data
            with patch("payments.sync.fetch_snapshot", side_effect=fetch):
                self.assertTrue(sync_owner(self.user.pk))

    def test_invalid_scan_budget_is_rejected(self):
        import os
        from .sync import sync_timeout
        for value in ("0", "1801", "invalid"):
            with patch.dict(os.environ, {"ZPAY_WALLET_SYNC_TIMEOUT_SECONDS": value}):
                with self.assertRaises(ValueError):
                    sync_timeout()
