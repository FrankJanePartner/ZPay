import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthProvider";
import { session } from "../auth/session";
import { appRoutes } from "../router";
import { API_ORIGIN } from "../test/handlers";
import { server } from "../test/server";

const payment = {
  id: "0787e217-5be4-4258-a9d1-ca991c2558c4",
  reference: "order-1042",
  amount_zatoshis: "100000",
  address: "u1examplepaymentaddress",
  status: "awaiting_payment" as const,
  created_at: "2026-09-17T10:00:00Z",
  expires_at: "2026-09-17T10:30:00Z",
  received_zatoshis: "25000",
  funding_status: "partially_paid" as const,
};

interface CapturedRequest {
  key: string | null;
  body: string;
}

function renderPayments() {
  session.setToken("zpay_existing");
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/payments"] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, router };
}

function emptyList() {
  server.use(
    http.get(`${API_ORIGIN}/api/v1/payment-requests/`, () =>
      HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
    ),
  );
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Reference"), "order-1042");
  await user.type(screen.getByLabelText("Amount (zatoshis)"), "100000");
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  session.clear();
});

describe("payments page", () => {
  it("disables throttled submission until the deadline and preserves the exact attempt", async () => {
    const user = userEvent.setup();
    emptyList();
    const requests: CapturedRequest[] = [];
    server.use(http.post(`${API_ORIGIN}/api/v1/payment-requests/`, async ({ request }) => {
      requests.push({ key: request.headers.get("Idempotency-Key"), body: await request.text() });
      return HttpResponse.json({ detail: "Throttled" }, { status: 429, headers: { "Retry-After": "30" } });
    }));
    renderPayments();
    await fillRequiredFields(user);
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    await user.click(screen.getByRole("button", { name: "Create payment request" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Create payment request" })).toBeDisabled());
    await act(async () => { vi.advanceTimersByTime(29_000); });
    await user.click(screen.getByRole("button", { name: "Create payment request" }));
    expect(requests).toHaveLength(1);
    await act(async () => { vi.advanceTimersByTime(1_000); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Create payment request" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "Create payment request" }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toEqual(requests[0]);
  });

  it("navigates payment pages and can return from a failed page", async () => {
    const user = userEvent.setup();
    let fail = true;
    server.use(http.get(`${API_ORIGIN}/api/v1/payment-requests/`, ({ request }) => {
      const second = new URL(request.url).searchParams.get("page") === "2";
      if (second && fail) return HttpResponse.json({ detail: "Unavailable" }, { status: 503 });
      return HttpResponse.json({ count: 2, next: second ? null : `${API_ORIGIN}/api/v1/payment-requests/?page=2`,
        previous: second ? "/api/v1/payment-requests/" : null,
        results: [{ ...payment, reference: second ? "second-page" : "first-page" }],
      });
    }));
    renderPayments();
    expect(await screen.findByText("first-page")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByRole("button", { name: "Back to previous page" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back to previous page" }));
    expect(await screen.findByText("first-page")).toBeVisible();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("second-page")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("first-page")).toBeVisible();
  });

  it.each(["https://evil.test/api/v1/payment-requests/?page=2", "/api/v1/keys/?page=2"])(
    "rejects unsafe payment pagination with first-page recovery: %s", async (next) => {
      const user = userEvent.setup();
      server.use(http.get(`${API_ORIGIN}/api/v1/payment-requests/`, () => HttpResponse.json({
        count: 2, next, previous: null, results: [payment],
      })));
      renderPayments();
      await user.click(await screen.findByRole("button", { name: "Next page" }));
      expect(await screen.findByText("Invalid pagination URL.")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Back to first page" }));
      expect(await screen.findByText(payment.reference)).toBeVisible();
    },
  );
  it("submits an integer amount string with the default 1800-second TTL", async () => {
    const user = userEvent.setup();
    const requests: CapturedRequest[] = [];
    emptyList();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, async ({ request }) => {
        requests.push({
          key: request.headers.get("Idempotency-Key"),
          body: await request.text(),
        });
        return HttpResponse.json(payment, { status: 201 });
      }),
      http.get(`${API_ORIGIN}/api/v1/payment-requests/${payment.id}/`, () =>
        HttpResponse.json(payment),
      ),
    );

    const { router } = renderPayments();
    await fillRequiredFields(user);
    expect(screen.getByLabelText("Expiry (seconds)")).toHaveValue(1800);
    await user.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/payments/${payment.id}`));
    expect(requests).toHaveLength(1);
    expect(requests[0]?.key).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.parse(requests[0]!.body)).toEqual({
      reference: "order-1042",
      amount_zatoshis: "100000",
      ttl_seconds: 1800,
    });
    expect(typeof JSON.parse(requests[0]!.body).amount_zatoshis).toBe("string");
  });

  it("accepts the maximum Zcash amount as an exact integer string", async () => {
    const user = userEvent.setup();
    const requests: CapturedRequest[] = [];
    emptyList();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, async ({ request }) => {
        requests.push({ key: request.headers.get("Idempotency-Key"), body: await request.text() });
        return HttpResponse.json(payment, { status: 201 });
      }),
      http.get(`${API_ORIGIN}/api/v1/payment-requests/${payment.id}/`, () =>
        HttpResponse.json(payment),
      ),
    );

    renderPayments();
    await user.type(screen.getByLabelText("Reference"), "maximum-order");
    await user.type(screen.getByLabelText("Amount (zatoshis)"), "2100000000000000");
    await user.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(JSON.parse(requests[0]!.body).amount_zatoshis).toBe("2100000000000000");
  });

  it("rejects an amount above the Zcash maximum before making a request", async () => {
    const user = userEvent.setup();
    const requests: CapturedRequest[] = [];
    emptyList();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, async ({ request }) => {
        requests.push({ key: request.headers.get("Idempotency-Key"), body: await request.text() });
        return HttpResponse.json(payment, { status: 201 });
      }),
      http.get(`${API_ORIGIN}/api/v1/payment-requests/${payment.id}/`, () =>
        HttpResponse.json(payment),
      ),
    );

    renderPayments();
    await user.type(screen.getByLabelText("Reference"), "over-maximum-order");
    const amount = screen.getByLabelText("Amount (zatoshis)");
    await user.type(amount, "2100000000000001");
    await user.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() =>
      expect(amount).toHaveAccessibleDescription(
        "Amount must be no more than 2100000000000000 zatoshis.",
      ),
    );
    expect(amount).toHaveAttribute("aria-invalid", "true");
    expect(requests).toHaveLength(0);
  });

  it("associates sanitized API field errors with payment inputs", async () => {
    const user = userEvent.setup();
    emptyList();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, () =>
        HttpResponse.json(
          {
            reference: ["<script>customer-secret</script>"],
            amount_zatoshis: ["Amount exceeds the Zcash monetary range."],
            ttl_seconds: ["Expiry must be between 60 and 1800 seconds."],
          },
          { status: 400 },
        ),
      ),
    );

    renderPayments();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Reference")).toHaveAccessibleDescription(
        "Request failed. Please try again.",
      ),
    );
    expect(screen.queryByText(/customer-secret/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Amount (zatoshis)")).toHaveAccessibleDescription(
      "Amount exceeds the Zcash monetary range.",
    );
    expect(screen.getByLabelText("Expiry (seconds)")).toHaveAccessibleDescription(
      "Choose 60–1800 seconds. Default: 1800. Expiry must be between 60 and 1800 seconds.",
    );
  });

  it.each([59, 1801])("does not submit a TTL of %s seconds", async (ttl) => {
    const user = userEvent.setup();
    const requests: CapturedRequest[] = [];
    emptyList();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, async ({ request }) => {
        requests.push({ key: request.headers.get("Idempotency-Key"), body: await request.text() });
        return HttpResponse.json(payment, { status: 201 });
      }),
    );

    renderPayments();
    await fillRequiredFields(user);
    const ttlInput = screen.getByLabelText("Expiry (seconds)");
    await user.clear(ttlInput);
    await user.type(ttlInput, String(ttl));
    await user.click(screen.getByRole("button", { name: "Create payment request" }));

    expect(ttlInput).toBeInvalid();
    expect(requests).toHaveLength(0);
  });

  it("disables submission while the first request is in flight", async () => {
    const user = userEvent.setup();
    const requests: CapturedRequest[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    emptyList();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, async ({ request }) => {
        requests.push({ key: request.headers.get("Idempotency-Key"), body: await request.text() });
        await pending;
        return HttpResponse.json(payment, { status: 201 });
      }),
      http.get(`${API_ORIGIN}/api/v1/payment-requests/${payment.id}/`, () =>
        HttpResponse.json(payment),
      ),
    );

    renderPayments();
    await fillRequiredFields(user);
    const submit = screen.getByRole("button", { name: "Create payment request" });
    await user.click(submit);

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Creating payment request" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Creating payment request" }));
    expect(requests).toHaveLength(1);

    await act(async () => release());
  });

  it("abandons a pending creation when navigation unmounts the payments page", async () => {
    const user = userEvent.setup();
    let requestSignal: AbortSignal | undefined;
    let markRequestStarted!: () => void;
    let releaseResponse!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    let detailRequests = 0;
    let balanceRequests = 0;
    let transactionRequests = 0;
    emptyList();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, async ({ request }) => {
        requestSignal = request.signal;
        markRequestStarted();
        await responseGate;
        return HttpResponse.json(payment, { status: 201 });
      }),
      http.get(`${API_ORIGIN}/api/v1/payment-requests/${payment.id}/`, () => {
        detailRequests += 1;
        return HttpResponse.json(payment);
      }),
      http.get(`${API_ORIGIN}/api/v1/balance/`, () => {
        balanceRequests += 1;
        return HttpResponse.json({
          total_zatoshis: null,
          spendable_zatoshis: null,
          pending_zatoshis: null,
          confirmed_received_zatoshis: null,
          chain_height: null,
          synced_at: null,
          stale: true,
          sync_error: "",
          settlement_enabled: false,
        });
      }),
      http.get(`${API_ORIGIN}/api/v1/transactions/`, () => {
        transactionRequests += 1;
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
      }),
    );

    const { router } = renderPayments();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create payment request" }));
    await requestStarted;
    await user.click(screen.getByRole("link", { name: "Overview" }));

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
    expect(router.state.location.pathname).toBe("/dashboard");
    await waitFor(() => {
      expect(balanceRequests).toBe(1);
      expect(transactionRequests).toBe(1);
    });
    await waitFor(() => expect(requestSignal?.aborted).toBe(true));

    await act(async () => releaseResponse());
    expect(router.state.location.pathname).toBe("/dashboard");
    expect(detailRequests).toBe(0);
    expect(balanceRequests).toBe(1);
    expect(transactionRequests).toBe(1);
  });

  it("abandons merchant A creation across logout and merchant B login", async () => {
    const user = userEvent.setup();
    let requestSignal: AbortSignal | undefined;
    let markRequestStarted!: () => void;
    let releaseResponse!: () => void;
    const requestStarted = new Promise<void>((resolve) => {
      markRequestStarted = resolve;
    });
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const listTokens: Array<string | null> = [];
    let detailRequests = 0;
    server.use(
      http.get(`${API_ORIGIN}/api/v1/payment-requests/`, ({ request }) => {
        listTokens.push(request.headers.get("authorization"));
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
      }),
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, async ({ request }) => {
        requestSignal = request.signal;
        markRequestStarted();
        await responseGate;
        return HttpResponse.json(payment, { status: 201 });
      }),
      http.post(`${API_ORIGIN}/api/v1/auth/logout/`, () =>
        new HttpResponse(null, { status: 204 }),
      ),
      http.post(`${API_ORIGIN}/api/v1/auth/login/`, () =>
        HttpResponse.json({ token: "zpay_merchant_b", expires_in: 43_200 }),
      ),
      http.get(`${API_ORIGIN}/api/v1/payment-requests/${payment.id}/`, () => {
        detailRequests += 1;
        return HttpResponse.json(payment);
      }),
    );

    const { router } = renderPayments();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create payment request" }));
    await requestStarted;
    await user.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    await waitFor(() => expect(requestSignal?.aborted).toBe(true));

    await user.type(screen.getByRole("textbox", { name: "Email" }), "merchant-b@example.com");
    await user.type(screen.getByLabelText("Password"), "strong-password-482");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeVisible();
    await user.click(screen.getByRole("link", { name: "Payments" }));
    expect(await screen.findByRole("heading", { name: "Payments" })).toBeVisible();
    await waitFor(() =>
      expect(listTokens.filter((token) => token === "Bearer zpay_merchant_b")).toHaveLength(2),
    );

    await act(async () => releaseResponse());
    expect(router.state.location.pathname).toBe("/payments");
    expect(detailRequests).toBe(0);
    // Overview recent payments and the payments list each fetched once; the old operation adds neither.
    expect(listTokens.filter((token) => token === "Bearer zpay_merchant_b")).toHaveLength(2);
  });

  it("recovers a prior operation when the API replays it with status 200", async () => {
    const user = userEvent.setup();
    emptyList();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, () =>
        HttpResponse.json(payment, { status: 200 }),
      ),
      http.get(`${API_ORIGIN}/api/v1/payment-requests/${payment.id}/`, () =>
        HttpResponse.json(payment),
      ),
    );

    const { router } = renderPayments();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() => expect(router.state.location.pathname).toBe(`/payments/${payment.id}`));
  });

  it("retries a 503 with the exact same idempotency header and body", async () => {
    const user = userEvent.setup();
    const requests: CapturedRequest[] = [];
    emptyList();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, async ({ request }) => {
        requests.push({ key: request.headers.get("Idempotency-Key"), body: await request.text() });
        if (requests.length === 1) {
          return HttpResponse.json(
            { detail: "Wallet service unavailable. Retry with the same Idempotency-Key." },
            { status: 503 },
          );
        }
        return HttpResponse.json(payment, { status: 200 });
      }),
      http.get(`${API_ORIGIN}/api/v1/payment-requests/${payment.id}/`, () =>
        HttpResponse.json(payment),
      ),
    );

    renderPayments();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create payment request" }));
    await user.click(await screen.findByRole("button", { name: "Retry safely" }));

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]).toEqual(requests[0]);
  });

  it("uses a fresh attempt when the ordinary form is submitted after a 409 conflict", async () => {
    const user = userEvent.setup();
    const requests: CapturedRequest[] = [];
    emptyList();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, async ({ request }) => {
        requests.push({ key: request.headers.get("Idempotency-Key"), body: await request.text() });
        if (requests.length === 1) {
          return HttpResponse.json(
            { detail: "Idempotency-Key already used with a different payload." },
            { status: 409 },
          );
        }
        return HttpResponse.json(payment, { status: 201 });
      }),
      http.get(`${API_ORIGIN}/api/v1/payment-requests/${payment.id}/`, () =>
        HttpResponse.json(payment),
      ),
    );

    renderPayments();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create payment request" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/key conflicts.*start a new payment/i);
    expect(screen.queryByRole("button", { name: "Retry safely" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.key).not.toBe(requests[0]?.key);
    expect(requests[1]?.body).toBe(requests[0]?.body);
  });

  it("generates a new key when the payload is edited after a failed request", async () => {
    const user = userEvent.setup();
    const requests: CapturedRequest[] = [];
    emptyList();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/payment-requests/`, async ({ request }) => {
        requests.push({ key: request.headers.get("Idempotency-Key"), body: await request.text() });
        return HttpResponse.json(
          { detail: "Wallet service unavailable. Retry with the same Idempotency-Key." },
          { status: 503 },
        );
      }),
    );

    renderPayments();
    await fillRequiredFields(user);
    await user.click(screen.getByRole("button", { name: "Create payment request" }));
    expect(await screen.findByRole("button", { name: "Retry safely" })).toBeVisible();

    const amount = screen.getByLabelText("Amount (zatoshis)");
    await user.clear(amount);
    await user.type(amount, "200000");
    await user.click(screen.getByRole("button", { name: "Create payment request" }));

    await waitFor(() => expect(requests).toHaveLength(2));
    expect(requests[1]?.key).not.toBe(requests[0]?.key);
    expect(JSON.parse(requests[1]!.body)).toEqual({
      reference: "order-1042",
      amount_zatoshis: "200000",
      ttl_seconds: 1800,
    });
  });

  it("lists requested and received amounts with separate window and funding statuses", async () => {
    server.use(
      http.get(`${API_ORIGIN}/api/v1/payment-requests/`, () =>
        HttpResponse.json({ count: 1, next: null, previous: null, results: [payment] }),
      ),
    );

    renderPayments();

    expect(await screen.findByText("order-1042")).toBeVisible();
    expect(screen.getByText("Requested 0.00100000 ZEC")).toBeVisible();
    expect(screen.getByText("Received 0.00025000 ZEC")).toBeVisible();
    expect(screen.getByText("Window: Awaiting payment")).toBeVisible();
    expect(screen.getByText("Funding: Partially paid")).toBeVisible();
    expect(screen.getByText(/Expires:/)).toBeVisible();
    expect(screen.getByRole("link", { name: "View order-1042 details" })).toHaveAttribute(
      "href",
      `/payments/${payment.id}`,
    );
  });

  it.each([
    { failure: "offline", warning: /offline.*most recently available payment requests/i },
    { failure: "503", warning: /could not be refreshed.*most recently available snapshot/i },
  ])(
    "keeps the cached list visibly stale and retryable after a $failure route-return failure",
    async ({ failure, warning }) => {
      const user = userEvent.setup();
      let listRequests = 0;
      server.use(
        http.get(`${API_ORIGIN}/api/v1/payment-requests/`, () => {
          listRequests += 1;
          if (listRequests === 2) {
            return failure === "offline"
              ? HttpResponse.error()
              : HttpResponse.json({ detail: "Service unavailable." }, { status: 503 });
          }
          return HttpResponse.json({ count: 1, next: null, previous: null, results: [payment] });
        }),
        http.get(`${API_ORIGIN}/api/v1/payment-requests/${payment.id}/`, () =>
          HttpResponse.json(payment),
        ),
      );

      renderPayments();
      expect(await screen.findByText("order-1042")).toBeVisible();
      await user.click(screen.getByRole("link", { name: "View order-1042 details" }));
      expect(await screen.findByRole("heading", { name: "order-1042" })).toBeVisible();
      await user.click(screen.getByRole("link", { name: "Back to payments" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(warning);
      expect(screen.getByText("order-1042")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Retry payment requests" }));
      await waitFor(() => expect(listRequests).toBe(3));
      await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
      expect(screen.getByText("order-1042")).toBeVisible();
    },
  );
});
