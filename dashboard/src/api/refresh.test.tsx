import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthProvider";
import { session } from "../auth/session";
import { appRoutes } from "../router";
import { API_ORIGIN } from "../test/handlers";
import { server } from "../test/server";

afterEach(() => session.clear());

it.each([
  ["/dashboard", ["balance", "transactions", "payment-requests"]],
  ["/payments", ["payment-requests"]],
  ["/transactions", ["transactions"]],
  ["/payments/polling-payment", ["payment-requests/polling-payment"]],
])("refreshes financial observations on %s, pauses offline, and refreshes on reconnect", async (route, endpoints) => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  const counts: Record<string, number> = {};
  server.use(...endpoints.map((endpoint) => http.get(`${API_ORIGIN}/api/v1/${endpoint}/`, () => {
    counts[endpoint] = (counts[endpoint] ?? 0) + 1;
    if (endpoint === "balance") return HttpResponse.json({
      total_zatoshis: "100000000", spendable_zatoshis: "100000000", pending_zatoshis: "0",
      confirmed_received_zatoshis: "100000000", synced_at: new Date().toISOString(), stale: false,
      sync_error: "", chain_height: 100, settlement_enabled: false,
    });
    if (endpoint === "payment-requests/polling-payment") return HttpResponse.json({
      id: "polling-payment", reference: "Polling payment", amount_zatoshis: "100000000",
      received_zatoshis: counts[endpoint] > 1 ? "100000000" : "0",
      funding_status: counts[endpoint] > 1 ? "paid" : "unpaid", status: "awaiting_payment",
      address: "u1example", created_at: new Date().toISOString(), expires_at: "2099-01-01T00:00:00Z",
    });
    return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
  })));
  session.setToken("zpay_refresh");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><AuthProvider><RouterProvider router={createMemoryRouter(appRoutes, { initialEntries: [route] })} /></AuthProvider></QueryClientProvider>);
  await waitFor(() => endpoints.forEach((endpoint) => expect(counts[endpoint]).toBe(1)));
  await act(async () => { vi.advanceTimersByTime(30_000); });
  await waitFor(() => endpoints.forEach((endpoint) => expect(counts[endpoint]).toBe(2)));
  if (route.includes("polling-payment")) expect(await screen.findByText("Funding status: Paid")).toBeVisible();
  await act(async () => { window.dispatchEvent(new Event("offline")); });
  await act(async () => { vi.advanceTimersByTime(90_000); });
  endpoints.forEach((endpoint) => expect(counts[endpoint]).toBe(2));
  await act(async () => { window.dispatchEvent(new Event("online")); });
  await waitFor(() => endpoints.forEach((endpoint) => expect(counts[endpoint]).toBe(3)));
});
