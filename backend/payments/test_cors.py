from django.test import TestCase, override_settings


@override_settings(CORS_ALLOWED_ORIGINS=["https://zpay.example.com"], SECURE_SSL_REDIRECT=False)
class CorsPolicyTests(TestCase):
    def test_payment_post_preflight_allows_actual_browser_headers(self):
        response = self.client.options(
            "/api/v1/payment-requests/",
            HTTP_ORIGIN="https://zpay.example.com",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization,content-type,idempotency-key",
        )
        self.assertEqual(response["Access-Control-Allow-Origin"], "https://zpay.example.com")
        allowed = {header.strip().lower() for header in response["Access-Control-Allow-Headers"].split(",")}
        self.assertTrue({"authorization", "content-type", "idempotency-key"} <= allowed)
        self.assertIn("POST", response["Access-Control-Allow-Methods"])
        self.assertNotIn("Access-Control-Allow-Credentials", response)

    def test_retry_after_is_exposed_to_dashboard(self):
        response = self.client.get("/api/v1/payment-requests/", HTTP_ORIGIN="https://zpay.example.com")
        self.assertIn("retry-after", response.get("Access-Control-Expose-Headers", "").lower())

    def test_similar_origins_are_not_allowed(self):
        for origin in ["http://zpay.example.com", "https://zpay.example.com.evil.test", "https://zpay.example.com:444"]:
            with self.subTest(origin=origin):
                response = self.client.options(
                    "/api/v1/payment-requests/", HTTP_ORIGIN=origin,
                    HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
                    HTTP_ACCESS_CONTROL_REQUEST_HEADERS="authorization,content-type,idempotency-key",
                )
                self.assertNotIn("Access-Control-Allow-Origin", response)

    def test_configured_origin_is_allowed(self):
        response = self.client.options(
            "/health/",
            HTTP_ORIGIN="https://zpay.example.com",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
        )

        self.assertEqual(response["Access-Control-Allow-Origin"], "https://zpay.example.com")

    def test_unknown_origin_is_rejected(self):
        response = self.client.options(
            "/health/",
            HTTP_ORIGIN="https://attacker.example",
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
        )

        self.assertNotIn("Access-Control-Allow-Origin", response)
