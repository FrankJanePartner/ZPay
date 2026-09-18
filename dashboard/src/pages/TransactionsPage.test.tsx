import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DepositOutput } from "../api/types";
import { AuthProvider } from "../auth/AuthProvider";
import { session } from "../auth/session";
import { appRoutes } from "../router";
import { API_ORIGIN } from "../test/handlers";
import { server } from "../test/server";

const txid = "cd".repeat(32);
const paymentId = "0787e217-5be4-4258-a9d1-ca991c2558c4";

const confirmed: DepositOutput = {
  id: "db32a049-4b34-4c48-ae39-072c5f9395c0",
  payment_request: paymentId,
  txid,
  pool: 3,
  output_index: 7,
  amount_zatoshis: "123456789",
  address: "u1example",
  mined_height: 3484368,
  block_time: "2026-09-15T16:00:00Z",
  confirmations: 12,
  status: "confirmed",
  late: true,
  first_seen_at: "2026-09-15T16:01:00Z",
};

const reversed: DepositOutput = {
  ...confirmed,
  id: "bf70160c-2f98-4c7e-b866-c4947f4d9d20",
  payment_request: null,
  txid: "ef".repeat(32),
  pool: 2,
  output_index: 8,
  amount_zatoshis: "10",
  confirmations: 0,
  status: "reversed",
  late: null,
};

function page(results: DepositOutput[], next: string | null = null, previous: string | null = null) {
  return { count: results.length, next, previous, results };
}

function renderTransactions() {
  session.setToken("zpay_existing");
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/transactions"] });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function respondWithOutputs(outputs: DepositOutput[] = [confirmed, reversed]) {
  server.use(
    http.get(`${API_ORIGIN}/api/v1/transactions/`, () => HttpResponse.json(page(outputs))),
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

describe("transactions page", () => {
  it("shows received-output facts and explicit confirmed and reversed audit states", async () => {
    respondWithOutputs();

    renderTransactions();

    expect(await screen.findByRole("heading", { name: "Transactions" })).toBeVisible();
    expect(await screen.findByText("Confirmed")).toBeVisible();
    expect(screen.getByText("Reversed")).toBeVisible();
    expect(screen.getByText("12 confirmations")).toBeVisible();
    expect(screen.getByText("Pool 3")).toBeVisible();
    expect(screen.getByText("Output 7")).toBeVisible();
    expect(screen.getByText("1.23456789 ZEC")).toBeVisible();
    expect(screen.getByText(/reversed outputs remain visible for audit/i)).toBeVisible();
  });

  it("separates late and unmatched labels and links matched payment requests", async () => {
    respondWithOutputs();

    renderTransactions();

    expect(await screen.findByText("Late payment")).toBeVisible();
    expect(screen.getByText("Unmatched output")).toBeVisible();
    expect(screen.getByRole("link", { name: "View linked payment request" })).toHaveAttribute(
      "href",
      `/payments/${paymentId}`,
    );
  });

  it("copies the complete transaction ID", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    respondWithOutputs([confirmed]);

    renderTransactions();
    await user.click(await screen.findByRole("button", { name: "Copy transaction ID" }));

    expect(writeText).toHaveBeenCalledWith(txid);
  });

  it("follows same-origin page URLs returned by the API", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_ORIGIN}/api/v1/transactions/`, ({ request }) => {
        const pageNumber = new URL(request.url).searchParams.get("page");
        return pageNumber === "2"
          ? HttpResponse.json(page([reversed], null, `${API_ORIGIN}/api/v1/transactions/`))
          : HttpResponse.json(
              page([confirmed], `${API_ORIGIN}/api/v1/transactions/?page=2`),
            );
      }),
    );

    renderTransactions();
    expect(await screen.findByText("12 confirmations")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next page" }));

    expect(await screen.findByText("Reversed")).toBeVisible();
    await waitFor(() => expect(screen.queryByText("12 confirmations")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Previous page" })).toBeEnabled();
  });

  it("rejects cross-origin pagination URLs before making a request", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    server.use(
      http.get(`${API_ORIGIN}/api/v1/transactions/`, () =>
        HttpResponse.json(page([confirmed], "https://attacker.invalid/collect")),
      ),
    );

    renderTransactions();
    await user.click(await screen.findByRole("button", { name: "Next page" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid pagination URL.");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Retry page" }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalledWith(
      "https://attacker.invalid/collect",
      expect.anything(),
    );
  });

  it("retries a failed uncached next page without losing recovery controls", async () => {
    const user = userEvent.setup();
    let pageTwoAttempts = 0;
    server.use(
      http.get(`${API_ORIGIN}/api/v1/transactions/`, ({ request }) => {
        const pageNumber = new URL(request.url).searchParams.get("page");
        if (pageNumber !== "2") {
          return HttpResponse.json(
            page([confirmed], `${API_ORIGIN}/api/v1/transactions/?page=2`),
          );
        }
        pageTwoAttempts += 1;
        return pageTwoAttempts === 1
          ? HttpResponse.json({ detail: "Transaction service unavailable." }, { status: 503 })
          : HttpResponse.json(page([reversed], null, `${API_ORIGIN}/api/v1/transactions/`));
      }),
    );

    renderTransactions();
    await user.click(await screen.findByRole("button", { name: "Next page" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Transaction service unavailable.");
    expect(screen.getByRole("button", { name: "Retry page" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Back to previous page" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Retry page" }));

    expect(await screen.findByText("Reversed")).toBeVisible();
    expect(pageTwoAttempts).toBe(2);
  });

  it("returns from a failed next page to the last successful page", async () => {
    const user = userEvent.setup();
    server.use(
      http.get(`${API_ORIGIN}/api/v1/transactions/`, ({ request }) =>
        new URL(request.url).searchParams.get("page") === "2"
          ? HttpResponse.json({ detail: "Transaction service unavailable." }, { status: 503 })
          : HttpResponse.json(
              page([confirmed], `${API_ORIGIN}/api/v1/transactions/?page=2`),
            ),
      ),
    );

    renderTransactions();
    await user.click(await screen.findByRole("button", { name: "Next page" }));
    expect(await screen.findByRole("alert")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Back to previous page" }));

    expect(await screen.findByText("12 confirmations")).toBeVisible();
    expect(screen.getByRole("button", { name: "Next page" })).toBeVisible();
  });
});
