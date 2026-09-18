import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthProvider";
import { session } from "../auth/session";
import { appRoutes } from "../router";
import { API_ORIGIN } from "../test/handlers";
import { server } from "../test/server";

function renderAt(path: string) {
  session.setToken("zpay_recovery");
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AuthProvider><RouterProvider router={router} /></AuthProvider>
  </QueryClientProvider>);
}
afterEach(() => { session.clear(); vi.restoreAllMocks(); });

it("handles a render exception with safe recovery and navigation without exposing details", async () => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  server.use(http.get(`${API_ORIGIN}/api/v1/balance/`, () => HttpResponse.json({
    total_zatoshis: "secret-raw-exception", spendable_zatoshis: null, pending_zatoshis: null,
    confirmed_received_zatoshis: null, synced_at: null, stale: true, settlement_enabled: false,
  })));
  renderAt("/dashboard");
  expect(await screen.findByRole("heading", { name: "Something went wrong" })).toBeVisible();
  expect(screen.getByRole("button", { name: "Reload page" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Go to payments" })).toHaveAttribute("href", "/payments");
  expect(document.body).not.toHaveTextContent(/secret-raw-exception|Invalid zatoshi amount|stack trace/i);
  await userEvent.setup().click(screen.getByRole("link", { name: "Go to payments" }));
  expect(await screen.findByRole("heading", { name: "Payments" })).toBeVisible();
});

it("explains a 403 session boundary and recovers to sign-in", async () => {
  server.use(http.get(`${API_ORIGIN}/api/v1/keys/`, () => HttpResponse.json({ detail: "Forbidden." }, { status: 403 })));
  renderAt("/api-keys");
  expect(await screen.findByText(/integration API keys cannot replace a dashboard session/i)).toBeVisible();
  await userEvent.setup().click(screen.getByRole("button", { name: "Sign in again" }));
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
  expect(session.getToken()).toBeNull();
});

it("preserves session-specific recovery for an API-key mutation 403", async () => {
  server.use(
    http.get(`${API_ORIGIN}/api/v1/keys/`, () => HttpResponse.json([])),
    http.post(`${API_ORIGIN}/api/v1/keys/`, () => HttpResponse.json({ detail: "Forbidden." }, { status: 403 })),
  );
  renderAt("/api-keys");
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Key name"), "Checkout integration");
  await user.click(screen.getByRole("button", { name: "Create API key" }));
  expect(await screen.findByText(/integration API keys cannot replace a dashboard session/i)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Sign in again" }));
  expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
});
