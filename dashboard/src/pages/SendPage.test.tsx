import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../auth/AuthProvider";
import { session } from "../auth/session";
import { appRoutes } from "../router";
import { API_ORIGIN } from "../test/handlers";
import { server } from "../test/server";

function renderSend() {
  session.setToken("zpay_existing");

  const router = createMemoryRouter(appRoutes, {
    initialEntries: ["/send"],
  });

  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  session.clear();
});

describe("Send page", () => {
  it("includes an optional memo in the confirmation and send request", async () => {
    const user = userEvent.setup();
    let requestBody: unknown = null;

    server.use(
      http.get(`${API_ORIGIN}/api/v1/balance/`, () =>
        HttpResponse.json({
          total_zatoshis: "100000000",
          spendable_zatoshis: "100000000",
          pending_zatoshis: "0",
          confirmed_received_zatoshis: "100000000",
          chain_height: 3495040,
          synced_at: "2026-09-28T13:00:00Z",
          stale: false,
          sync_error: "",
          settlement_enabled: false,
        }),
      ),
      http.post(`${API_ORIGIN}/api/v1/sends/`, async ({ request }) => {
        requestBody = await request.json();

        return HttpResponse.json({
          id: "send-test-001",
          recipient_address: "u1testrecipient",
          amount_zatoshis: "100000",
          memo: "Payment for order #123",
          status: "broadcast",
          txids: ["ab".repeat(32)],
          error: "",
          created_at: "2026-09-28T13:00:00Z",
          updated_at: "2026-09-28T13:00:00Z",
        });
      }),
    );

    renderSend();

    await user.type(
      await screen.findByLabelText("Recipient Zcash address"),
      "u1testrecipient",
    );
    await user.type(screen.getByLabelText("Amount (ZEC)"), "0.001");
    await user.type(
      screen.getByLabelText("Memo / Message (optional)"),
      "Payment for order #123",
    );

    expect(screen.getByText("22/512 bytes")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Review send" }));

    expect(screen.getByRole("heading", { name: "Confirm transaction" })).toBeVisible();
    expect(screen.getByText("Memo / Message").parentElement).toHaveTextContent(
      "Payment for order #123",
    );

    await user.click(screen.getByRole("button", { name: "Confirm & Send" }));

    expect(await screen.findByRole("heading", { name: "Transaction broadcast" })).toBeVisible();
    expect(requestBody).toEqual({
      recipient_address: "u1testrecipient",
      amount_zatoshis: "100000",
      memo: "Payment for order #123",
    });
  });

  it("omits the memo from the request when left blank", async () => {
    const user = userEvent.setup();
    let requestBody: unknown = null;

    server.use(
      http.get(`${API_ORIGIN}/api/v1/balance/`, () =>
        HttpResponse.json({
          total_zatoshis: "100000000",
          spendable_zatoshis: "100000000",
          pending_zatoshis: "0",
          confirmed_received_zatoshis: "100000000",
          chain_height: 3495040,
          synced_at: "2026-09-28T13:00:00Z",
          stale: false,
          sync_error: "",
          settlement_enabled: false,
        }),
      ),
      http.post(`${API_ORIGIN}/api/v1/sends/`, async ({ request }) => {
        requestBody = await request.json();

        return HttpResponse.json({
          id: "send-test-002",
          recipient_address: "u1testrecipient",
          amount_zatoshis: "100000",
          memo: "",
          status: "broadcast",
          txids: ["cd".repeat(32)],
          error: "",
          created_at: "2026-09-28T13:00:00Z",
          updated_at: "2026-09-28T13:00:00Z",
        });
      }),
    );

    renderSend();

    await user.type(
      await screen.findByLabelText("Recipient Zcash address"),
      "u1testrecipient",
    );
    await user.type(screen.getByLabelText("Amount (ZEC)"), "0.001");
    await user.click(screen.getByRole("button", { name: "Review send" }));
    await user.click(screen.getByRole("button", { name: "Confirm & Send" }));

    await screen.findByRole("heading", { name: "Transaction broadcast" });

    expect(requestBody).toEqual({
      recipient_address: "u1testrecipient",
      amount_zatoshis: "100000",
    });
  });
});
