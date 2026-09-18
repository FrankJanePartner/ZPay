import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthProvider";
import { session } from "../auth/session";
import { appRoutes } from "../router";
import { API_ORIGIN } from "../test/handlers";
import { server } from "../test/server";
import type { DepositOutput, WalletBalance } from "../api/types";

const balance = {
  total_zatoshis: "100000000",
  spendable_zatoshis: "90000000",
  pending_zatoshis: "10000000",
  confirmed_received_zatoshis: "100000000",
  chain_height: 3484368,
  synced_at: "2026-09-15T16:00:00Z",
  stale: false,
  sync_error: "",
  settlement_enabled: false,
};

const recentOutput = {
  id: "db32a049-4b34-4c48-ae39-072c5f9395c00",
  payment_request: "0787e217-5be4-4258-a9d1-ca991c2558c4",
  txid: "ab".repeat(32),
  pool: 3,
  output_index: 0,
  amount_zatoshis: "100000000",
  address: "u1examplefulladdress",
  mined_height: 3484368,
  block_time: "2026-09-15T16:00:00Z",
  confirmations: 1,
  status: "confirmed" as const,
  late: false,
  first_seen_at: "2026-09-15T16:01:00Z",
};

function renderDashboard() {
  session.setToken("zpay_existing");
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/dashboard"] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

function respondWith(wallet: WalletBalance = balance, outputs: DepositOutput[] = [recentOutput]) {
  server.use(
    http.get(`${API_ORIGIN}/api/v1/balance/`, () => HttpResponse.json(wallet)),
    http.get(`${API_ORIGIN}/api/v1/transactions/`, () =>
      HttpResponse.json({ count: outputs.length, next: null, previous: null, results: outputs }),
    ),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  session.clear();
});

describe("dashboard overview", () => {
  it("ages a successful snapshot locally after 120 seconds while retaining exact values", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    const syncedAt = new Date().toISOString();
    respondWith({ ...balance, synced_at: syncedAt });
    renderDashboard();
    expect(await screen.findByText("Total wallet balance")).toBeVisible();
    expect(screen.queryByText(/out of date/i)).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(121_000); });
    expect(screen.getByText(/out of date/i)).toBeVisible();
    expect(screen.getAllByText("1.00000000 ZEC").length).toBeGreaterThan(0);
  });

  it("immediately identifies browser offline state and refreshes when online again", async () => {
    respondWith({ ...balance, synced_at: new Date().toISOString() });
    renderDashboard();
    expect(await screen.findByText("Total wallet balance")).toBeVisible();
    await act(async () => { window.dispatchEvent(new Event("offline")); });
    expect(screen.getByText(/offline.*retained.*not current/i)).toBeVisible();
    expect(screen.getAllByText("1.00000000 ZEC").length).toBeGreaterThan(0);
    respondWith({ ...balance, total_zatoshis: "200000000", synced_at: new Date().toISOString() });
    await act(async () => { window.dispatchEvent(new Event("online")); });
    expect(await screen.findByText("2.00000000 ZEC")).toBeVisible();
    expect(screen.queryByText(/offline.*retained.*not current/i)).not.toBeInTheDocument();
    expect(screen.getByText("Online")).toBeVisible();
  });

  it("shows at most five recent payments with distinct window and funding labels", async () => {
    respondWith();
    server.use(http.get(`${API_ORIGIN}/api/v1/payment-requests/`, () => HttpResponse.json({
      count: 8, next: null, previous: null,
      results: Array.from({ length: 8 }, (_, index) => ({
        id: `recent-${index}`, reference: `order-${index}`, status: "expired", funding_status: "paid",
        amount_zatoshis: "100000000", received_zatoshis: "100000000", address: "u1example",
        created_at: "2026-09-17T10:00:00Z", expires_at: "2026-09-17T10:30:00Z",
      })),
    })));
    renderDashboard();
    expect(await screen.findByRole("heading", { name: "Recent payment requests" })).toBeVisible();
    expect(await screen.findByRole("link", { name: "View order-0 details" })).toHaveAttribute("href", "/payments/recent-0");
    expect(screen.getAllByText("Window: Expired")).toHaveLength(5);
    expect(screen.getAllByText("Funding: Paid")).toHaveLength(5);
    expect(screen.queryByText("order-5")).not.toBeInTheDocument();
  });
  it("renders unsynced amounts honestly and names disabled settlement", async () => {
    respondWith({
      ...balance,
      total_zatoshis: null,
      spendable_zatoshis: null,
      pending_zatoshis: null,
      confirmed_received_zatoshis: null,
      chain_height: null,
      synced_at: null,
      stale: true,
    });

    renderDashboard();

    expect(await screen.findAllByText("Not synced")).toHaveLength(4);
    expect(screen.getByRole("alert")).toHaveTextContent(/out of date/i);
    expect(screen.getByText("Settlement disabled")).toBeVisible();
    expect(screen.queryByText("0.00000000 ZEC")).not.toBeInTheDocument();
  });

  it("formats observed zatoshi balances without a floating point conversion", async () => {
    respondWith();

    renderDashboard();

    expect(await screen.findAllByText("1.00000000 ZEC")).not.toHaveLength(0);
    expect(screen.getByText(/Settlement disabled/i)).toBeVisible();
  });

  it("uses skeletons while loading instead of invented zero values", () => {
    server.use(
      http.get(`${API_ORIGIN}/api/v1/balance/`, async () => new Promise<Response>(() => undefined)),
      http.get(`${API_ORIGIN}/api/v1/transactions/`, async () => new Promise<Response>(() => undefined)),
    );

    renderDashboard();

    const walletLoading = screen.getByRole("status", { name: "Loading wallet balance" });
    expect(walletLoading).toBeVisible();
    expect(walletLoading).toHaveAttribute("aria-busy", "true");
    expect(walletLoading).toHaveTextContent("Loading wallet balance");
    expect(screen.queryByText(/0\.00000000 ZEC/)).not.toBeInTheDocument();
  });

  it("identifies cumulative receipts as distinct from spendable balance", async () => {
    respondWith();

    renderDashboard();

    expect(await screen.findByText("Cumulative received")).toBeVisible();
    expect(screen.getByText(/lifetime confirmed receipts; this is not a spendable balance/i)).toBeVisible();
  });

  it("offers next actions when there are no recent outputs", async () => {
    respondWith(balance, []);

    renderDashboard();

    expect(await screen.findByText(/No received outputs yet/i)).toBeVisible();
    expect(screen.getByRole("link", { name: /Create payment request/i })).toHaveAttribute(
      "href",
      "/payments",
    );
    expect(screen.getByRole("link", { name: /View all transactions/i })).toHaveAttribute(
      "href",
      "/transactions",
    );
  });

  it("keeps cached values visible with an offline warning after a refresh fails", async () => {
    respondWith();
    const rendered = renderDashboard();

    expect(await screen.findAllByText("1.00000000 ZEC")).not.toHaveLength(0);
    server.use(
      http.get(`${API_ORIGIN}/api/v1/balance/`, () => HttpResponse.error()),
      http.get(`${API_ORIGIN}/api/v1/transactions/`, () => HttpResponse.error()),
    );

    await act(async () => {
      await rendered.queryClient.invalidateQueries({ queryKey: ["wallet-balance"] });
      await rendered.queryClient.invalidateQueries({ queryKey: ["recent-transactions"] });
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/offline/i);
    });
    expect(screen.getAllByText("1.00000000 ZEC")).not.toHaveLength(0);
  });

  it.each([
    ["a server error", () => HttpResponse.json({ detail: "Service unavailable." }, { status: 503 })],
    ["a malformed success response", () => new HttpResponse('{"incomplete":', { headers: { "Content-Type": "application/json" } })],
  ])("marks retained values unavailable after %s", async (_name, failedResponse) => {
    respondWith();
    const rendered = renderDashboard();

    expect(await screen.findAllByText("1.00000000 ZEC")).not.toHaveLength(0);
    server.use(http.get(`${API_ORIGIN}/api/v1/balance/`, failedResponse));

    await act(async () => {
      await rendered.queryClient.invalidateQueries({ queryKey: ["wallet-balance"] });
    });

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/could not be refreshed/i);
    });
    expect(screen.getAllByText("1.00000000 ZEC")).not.toHaveLength(0);
  });

  it("labels reversed outputs explicitly", async () => {
    respondWith(balance, [{ ...recentOutput, status: "reversed" }]);

    renderDashboard();

    expect(await screen.findByText("Reversed")).toBeVisible();
  });

  it("retries each initially failed dashboard section", async () => {
    let shouldFail = true;
    server.use(
      http.get(`${API_ORIGIN}/api/v1/balance/`, () =>
        shouldFail ? HttpResponse.json({ detail: "Service unavailable." }, { status: 503 }) : HttpResponse.json(balance),
      ),
      http.get(`${API_ORIGIN}/api/v1/transactions/`, () =>
        shouldFail
          ? HttpResponse.json({ detail: "Service unavailable." }, { status: 503 })
          : HttpResponse.json({ count: 1, next: null, previous: null, results: [recentOutput] }),
      ),
    );

    renderDashboard();

    expect(await screen.findByRole("button", { name: "Retry wallet balance" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry recent outputs" })).toBeVisible();
    shouldFail = false;
    await act(async () => {
      await screen.getByRole("button", { name: "Retry wallet balance" }).click();
      await screen.getByRole("button", { name: "Retry recent outputs" }).click();
    });

    expect(await screen.findAllByText("1.00000000 ZEC")).not.toHaveLength(0);
    expect(screen.getByText(/Transaction ababab/i)).toBeVisible();
  });
});
