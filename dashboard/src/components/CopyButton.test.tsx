import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthProvider";
import { session } from "../auth/session";
import { DashboardPage } from "../pages/DashboardPage";
import { CopyButton } from "./CopyButton";
import { API_ORIGIN } from "../test/handlers";
import { server } from "../test/server";

const transactionId = "f9".repeat(32);

function renderDashboard() {
  session.setToken("zpay_existing");
  const router = createMemoryRouter([{ path: "/dashboard", element: <DashboardPage /> }], {
    initialEntries: ["/dashboard"],
  });

  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function respondWithDashboard() {
  server.use(
    http.get(`${API_ORIGIN}/api/v1/balance/`, () =>
      HttpResponse.json({
        total_zatoshis: "100000000",
        spendable_zatoshis: "100000000",
        pending_zatoshis: "0",
        confirmed_received_zatoshis: "100000000",
        chain_height: 3484368,
        synced_at: "2026-09-15T16:00:00Z",
        stale: false,
        sync_error: "",
        settlement_enabled: false,
      }),
    ),
    http.get(`${API_ORIGIN}/api/v1/transactions/`, () =>
      HttpResponse.json({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: "db32a049-4b34-4c48-ae39-072c5f9395c00",
            payment_request: "0787e217-5be4-4258-a9d1-ca991c2558c4",
            txid: transactionId,
            pool: 3,
            output_index: 0,
            amount_zatoshis: "100000000",
            address: "u1this-is-the-full-receiving-address",
            mined_height: 3484368,
            block_time: "2026-09-15T16:00:00Z",
            confirmations: 1,
            status: "confirmed",
            late: false,
            first_seen_at: "2026-09-15T16:01:00Z",
          },
        ],
      }),
    ),
  );
}

function setClipboard(writeText: (value: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

afterEach(() => {
  session.clear();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

describe("dashboard copy controls", () => {
  it("writes the full transaction ID rather than its shortened display", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    respondWithDashboard();

    renderDashboard();
    await user.click(await screen.findByRole("button", { name: "Copy transaction ID" }));

    expect(writeText).toHaveBeenCalledWith(transactionId);
    expect(screen.getByRole("status", { name: "transaction ID copy status" })).toHaveTextContent("Copied");
  });

  it("reports a copy failure in its live region", async () => {
    const user = userEvent.setup();
    setClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    respondWithDashboard();

    renderDashboard();
    await user.click(await screen.findByRole("button", { name: "Copy address" }));

    expect(screen.getByRole("status", { name: "address copy status" })).toHaveTextContent("Copy failed");
  });

  it("keeps the newest copy result when earlier clipboard attempts finish later", async () => {
    const user = userEvent.setup();
    let rejectFirst!: (error: Error) => void;
    let releaseSecond!: (value: void) => void;
    let notifyFirstSettled!: () => void;
    const firstSettled = new Promise<void>((resolve) => { notifyFirstSettled = resolve; });
    const firstAttempt = new Promise<void>((_resolve, reject) => { rejectFirst = reject; });
    void firstAttempt.catch(() => notifyFirstSettled());
    const secondAttempt = new Promise<void>((resolve) => { releaseSecond = resolve; });
    const writeText = vi
      .fn<(_: string) => Promise<void>>()
      .mockImplementationOnce(() => firstAttempt)
      .mockImplementationOnce(() => secondAttempt);
    setClipboard(writeText);
    render(<CopyButton label="transaction ID" value={transactionId} />);

    const copy = screen.getByRole("button", { name: "Copy transaction ID" });
    await user.click(copy);
    await user.click(copy);
    const status = screen.getByRole("status", { name: "transaction ID copy status" });
    releaseSecond();
    await waitFor(() => expect(status).toHaveTextContent("Copied"));

    rejectFirst(new Error("denied"));
    await firstSettled;
    expect(status).toHaveTextContent("Copied");
  });

  it("resets its mounted live region before announcing a repeated copy success", async () => {
    const user = userEvent.setup();
    let releaseSecond!: () => void;
    const secondAttempt = new Promise<void>((resolve) => { releaseSecond = resolve; });
    setClipboard(
      vi
        .fn<(_: string) => Promise<void>>()
        .mockResolvedValueOnce(undefined)
        .mockImplementationOnce(() => secondAttempt),
    );
    render(<CopyButton label="transaction ID" value={transactionId} />);

    const status = screen.getByRole("status", { name: "transaction ID copy status" });
    expect(status).toBeEmptyDOMElement();
    const copy = screen.getByRole("button", { name: "Copy transaction ID" });
    await user.click(copy);
    expect(status).toHaveTextContent("Copied");
    await user.click(copy);
    expect(status).toBeEmptyDOMElement();
    releaseSecond();
    await waitFor(() => expect(status).toHaveTextContent("Copied"));
  });
});
