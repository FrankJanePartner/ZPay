from django.test import TestCase

class DocumentationTests(TestCase):
    def test_homepage_serves_swagger_for_browser(self):
        response = self.client.get("/", HTTP_ACCEPT="text/html")
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "SwaggerUIBundle")
        self.assertContains(response, "?schema" + chr(92) + "u003D1")

    def test_schema_documents_contracts(self):
        response = self.client.get("/?schema=1", HTTP_ACCEPT="application/vnd.oai.openapi+json")
        self.assertEqual(response.status_code, 200)
        schema = response.json()
        paths = schema["paths"]
        self.assertEqual(sum(len([m for m in item if m in ("get", "post", "delete")]) for item in paths.values()), 12)
        self.assertNotIn("/", paths)
        post = paths["/api/v1/payment-requests/"]["post"]
        self.assertTrue(any(p["name"] == "Idempotency-Key" and p["required"] for p in post["parameters"]))
        self.assertIn("409", post["responses"])
        self.assertIn("503", post["responses"])
        self.assertIn("examples", post["requestBody"]["content"]["application/json"])
        self.assertEqual(schema["components"]["securitySchemes"]["BearerToken"]["scheme"], "bearer")
        self.assertEqual(paths["/api/v1/auth/register/"]["post"]["security"], [{}])
        for item in paths.values():
            for method, operation in item.items():
                if method not in ("get", "post", "delete"):
                    continue
                for code, result in operation["responses"].items():
                    if code.startswith("2") and code != "204":
                        self.assertIn("examples", result["content"]["application/json"])
