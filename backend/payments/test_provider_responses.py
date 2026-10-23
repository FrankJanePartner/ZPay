"""Regression tests for untrusted wallet-service responses."""

import io
import json
from unittest.mock import patch
from uuid import uuid4

from django.test import SimpleTestCase, override_settings

from .provider import WalletUnavailable, send_zec


class WalletSendResponseTests(SimpleTestCase):
    def setUp(self):
        self.request = type("Send", (), {
            "id": uuid4(),
            "owner_id": 123,
            "recipient_address": "test-recipient",
            "amount_zatoshis": 1000,
            "memo": "",
        })()

    def wallet_response(self, txids):
        payload = {
            "request_id": str(self.request.id),
            "merchant_id": str(self.request.owner_id),
            "txids": txids,
        }
        return io.BytesIO(json.dumps(payload).encode("utf-8"))

    @override_settings(WALLET_SERVICE_URL="http://127.0.0.1:9999", WALLET_SERVICE_TOKEN="test-token")
    def test_valid_transaction_id_is_accepted(self):
        txid = "a" * 64
        with patch("payments.provider.urlopen", return_value=self.wallet_response([txid])):
            self.assertEqual(send_zec(self.request), [txid])

    @override_settings(WALLET_SERVICE_URL="http://127.0.0.1:9999", WALLET_SERVICE_TOKEN="test-token")
    def test_invalid_transaction_ids_are_rejected(self):
        for txids in (["not-a-txid"], ["a" * 63], ["g" * 64], [], [42], ["a" * 64, "invalid"]):
            with self.subTest(txids=txids):
                with patch("payments.provider.urlopen", return_value=self.wallet_response(txids)):
                    with self.assertRaises(WalletUnavailable):
                        send_zec(self.request)
