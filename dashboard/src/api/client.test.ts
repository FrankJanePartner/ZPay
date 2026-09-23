import { http, HttpResponse } from "msw";
import { afterEach, expect, it, vi } from "vitest";
import { session } from "../auth/session";
import { API_ORIGIN } from "../test/handlers";
import { server } from "../test/server";
import { ApiError, apiRequest } from "./client";
import type { DepositOutput } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
  session.clear();
});

it("forces no-store even if a caller requests HTTP caching", async () => {
  server.use(http.get(`${API_ORIGIN}/api/v1/private/`, ({ request }) =>
    HttpResponse.json({ cache: request.cache }),
  ));
  await expect(apiRequest("/api/v1/private/", { cache: "force-cache" })).resolves.toEqual({ cache: "no-store" });
});

it("does not resend any session request before Retry-After expires", async () => {
  let now = Date.parse("2026-09-17T00:00:00Z");
  vi.spyOn(Date, "now").mockImplementation(() => now);
  let requests = 0;
  server.use(http.post(`${API_ORIGIN}/api/v1/cooldown/`, () => {
    requests += 1;
    return requests === 1
      ? HttpResponse.json({ detail: "Throttled" }, { status: 429, headers: { "Retry-After": "30" } })
      : HttpResponse.json({ ok: true });
  }));
  await expect(apiRequest("/api/v1/cooldown/", { method: "POST" })).rejects.toMatchObject({ status: 429 });
  now += 29_999;
  await expect(apiRequest("/api/v1/cooldown/", { method: "POST" })).rejects.toMatchObject({ status: 429 });
  expect(requests).toBe(1);
  now += 1;
  await expect(apiRequest("/api/v1/cooldown/", { method: "POST" })).resolves.toEqual({ ok: true });
  expect(requests).toBe(2);
});

it("sends the dashboard session as a bearer token", async () => {
  session.setToken("zpay_example");
  server.use(
    http.get(`${API_ORIGIN}/api/v1/private/`, ({ request }) => {
      return HttpResponse.json({ authorization: request.headers.get("authorization") });
    }),
  );

  await expect(apiRequest<{ authorization: string }>("/api/v1/private/")).resolves.toEqual({
    authorization: "Bearer zpay_example",
  });
});

it.each(["https://attacker.example/api/v1/private/", "//attacker.example/api/v1/private/"])(
  "rejects a foreign API URL before fetch: %s",
  async (path) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("fetch must not run"));

    try {
      await expect(apiRequest(path)).rejects.toMatchObject({
        status: 0,
        detail: "Invalid API path.",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  },
);

it("returns undefined for an empty successful response", async () => {
  server.use(http.delete(`${API_ORIGIN}/api/v1/keys/key-id/`, () => new HttpResponse(null, { status: 204 })));

  await expect(apiRequest("/api/v1/keys/key-id/", { method: "DELETE" })).resolves.toBeUndefined();
});

it("clears the dashboard session after an unauthorized response", async () => {
  session.setToken("zpay_example");
  server.use(http.get(`${API_ORIGIN}/api/v1/private/`, () => HttpResponse.json({ detail: "Invalid or revoked token." }, { status: 401 })));

  await expect(apiRequest("/api/v1/private/")).rejects.toMatchObject({ status: 401 });
  expect(session.getToken()).toBeNull();
});

it("does not clear a newer session after an older request returns unauthorized", async () => {
  let releaseResponse!: () => void;
  let requestStarted!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const started = new Promise<void>((resolve) => {
    requestStarted = resolve;
  });
  server.use(
    http.get(`${API_ORIGIN}/api/v1/private/`, async () => {
      requestStarted();
      await responseGate;
      return HttpResponse.json({ detail: "Invalid or revoked token." }, { status: 401 });
    }),
  );
  session.setToken("zpay_older");

  const request = apiRequest("/api/v1/private/");
  await started;
  session.setToken("zpay_newer");
  releaseResponse();

  await expect(request).rejects.toMatchObject({ status: 401 });
  expect(session.getToken()).toBe("zpay_newer");
});

it("captures a retry-after delay from a throttled response", async () => {
  server.use(http.get(`${API_ORIGIN}/api/v1/throttled/`, () => HttpResponse.json({ detail: "Request was throttled." }, { status: 429, headers: { "Retry-After": "30" } })));

  await expect(apiRequest("/api/v1/throttled/")).rejects.toMatchObject({
    status: 429,
    retryAfterSeconds: 30,
  });
});

it("accepts structured JSON error media types case-insensitively", async () => {
  server.use(
    http.get(
      `${API_ORIGIN}/api/v1/problem/`,
      () => new HttpResponse(
        JSON.stringify({ detail: "Structured problem detail." }),
        { status: 400, headers: { "Content-Type": "Application/Problem+JSON; charset=utf-8" } },
      ),
    ),
  );

  await expect(apiRequest("/api/v1/problem/")).rejects.toMatchObject({
    status: 400,
    detail: "Structured problem detail.",
  });
});

it("accepts a structured JSON success media type", async () => {
  server.use(
    http.get(
      `${API_ORIGIN}/api/v1/vendor-json/`,
      () => new HttpResponse(
        JSON.stringify({ status: "ok" }),
        { headers: { "Content-Type": "application/vnd.api+json" } },
      ),
    ),
  );

  await expect(apiRequest("/api/v1/vendor-json/")).resolves.toEqual({ status: "ok" });
});

it.each([
  ["an HTTP date", "Thu, 17 Sep 2026 00:00:45 GMT", 45],
  ["an excessive delta", "999999", 86_400],
])("parses and bounds Retry-After from %s", async (_name, retryAfter, expected) => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-17T00:00:00Z"));
  server.use(
    http.get(
      `${API_ORIGIN}/api/v1/retry-later/`,
      () => HttpResponse.json(
        { detail: "Request was throttled." },
        { status: 429, headers: { "Retry-After": retryAfter } },
      ),
    ),
  );

  await expect(apiRequest("/api/v1/retry-later/")).rejects.toMatchObject({
    retryAfterSeconds: expected,
  });
});

it("preserves a safe API detail", async () => {
  server.use(http.get(`${API_ORIGIN}/api/v1/wallet/`, () => HttpResponse.json({ detail: "Wallet service unavailable. Retry with the same Idempotency-Key." }, { status: 503 })));

  await expect(apiRequest("/api/v1/wallet/")).rejects.toMatchObject({
    status: 503,
    detail: "Wallet service unavailable. Retry with the same Idempotency-Key.",
  });
});

it("normalizes network failures to status zero", async () => {
  server.use(http.get(`${API_ORIGIN}/api/v1/offline/`, () => HttpResponse.error()));

  await expect(apiRequest("/api/v1/offline/")).rejects.toMatchObject({
    status: 0,
    detail: "Network request failed. Check your connection and try again.",
  });
});

it("does not expose HTML or server traces in error text", async () => {
  server.use(http.get(`${API_ORIGIN}/api/v1/broken/`, () => new HttpResponse("<html><body>Traceback: sensitive server trace</body></html>", { status: 500, headers: { "Content-Type": "text/html" } })));

  try {
    await apiRequest("/api/v1/broken/");
    throw new Error("Expected request to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).detail).toBe("Request failed. Please try again.");
    expect((error as ApiError).detail).not.toMatch(/html|traceback|sensitive/i);
  }
});

it("sanitizes HTML and Java-style traces in JSON error fields", async () => {
  server.use(
    http.get(`${API_ORIGIN}/api/v1/invalid/`, () =>
      HttpResponse.json(
        {
          detail: "Traceback: sensitive server trace",
          email: ["<html>unsafe field</html>", "java.lang.IllegalStateException: secret\n at com.example.Api.run(Api.java:42)"],
        },
        { status: 400 },
      ),
    ),
  );

  await expect(apiRequest("/api/v1/invalid/")).rejects.toMatchObject({
    detail: "Request failed. Please try again.",
    fields: {
      email: ["Request failed. Please try again.", "Request failed. Please try again."],
    },
  });
});

it("normalizes an HTML success response into a safe API error", async () => {
  server.use(
    http.get(
      `${API_ORIGIN}/api/v1/html-success/`,
      () => new HttpResponse("<html><body>Traceback: secret</body></html>", { headers: { "Content-Type": "text/html" } }),
    ),
  );

  await expect(apiRequest("/api/v1/html-success/")).rejects.toMatchObject({
    status: 200,
    detail: "Invalid API response. Please try again.",
  });
});

it("normalizes malformed JSON success responses into a safe API error", async () => {
  server.use(
    http.get(
      `${API_ORIGIN}/api/v1/malformed-success/`,
      () => new HttpResponse('{"incomplete":', { headers: { "Content-Type": "application/json" } }),
    ),
  );

  await expect(apiRequest("/api/v1/malformed-success/")).rejects.toMatchObject({
    status: 200,
    detail: "Invalid API response. Please try again.",
  });
});

it("models a deposit with no receiving address", () => {
  const deposit: DepositOutput = {
    id: "db32a049-4b34-4c48-ae39-072c5f9395c00",
    payment_request: null,
    txid: "ab".repeat(32),
    pool: 3,
    output_index: 0,
    amount_zatoshis: "100000",
    address: null,
    mined_height: 3484368,
    block_time: "2026-09-15T16:00:00Z",
    confirmations: 1,
    status: "confirmed",
    late: null,
    first_seen_at: "2026-09-15T16:01:00Z",
  };

  expect(deposit.address).toBeNull();
});
