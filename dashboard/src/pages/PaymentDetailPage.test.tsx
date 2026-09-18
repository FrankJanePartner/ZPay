import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthProvider";
import { session } from "../auth/session";
import type { PaymentRequest } from "../api/types";
import { appRoutes } from "../router";
import { API_ORIGIN } from "../test/handlers";
import { server } from "../test/server";
import { ExpiryCountdown } from "./PaymentDetailPage";

const paymentId = "0787e217-5be4-4258-a9d1-ca991c2558c4";
const basePayment: PaymentRequest = {
  id: paymentId,
  reference: "order-1042",
  amount_zatoshis: "100000000",
  address: "u1examplepaymentaddress",
  status: "awaiting_payment",
  created_at: "2099-09-17T10:00:00Z",
  expires_at: "2099-09-17T10:30:00Z",
  received_zatoshis: "0",
  funding_status: "unpaid",
};

function renderDetail(payment: PaymentRequest) {
  session.setToken("zpay_existing");
  server.use(
    http.get(`${API_ORIGIN}/api/v1/payment-requests/${paymentId}/`, () =>
      HttpResponse.json(payment),
    ),
  );
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [`/payments/${paymentId}`],
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
  vi.useRealTimers();
});

describe("payment detail states", () => {
  it.each([
    {
      name: "provisioning",
      payment: {
        ...basePayment,
        address: null,
        expires_at: null,
        status: "provisioning" as const,
      },
      window: "Payment window: Provisioning",
      funding: "Funding status: Unpaid",
      received: "Received 0.00000000 ZEC",
    },
    {
      name: "awaiting payment",
      payment: basePayment,
      window: "Payment window: Awaiting payment",
      funding: "Funding status: Unpaid",
      received: "Received 0.00000000 ZEC",
    },
    {
      name: "expired and unpaid",
      payment: { ...basePayment, status: "expired" as const },
      window: "Payment window: Expired",
      funding: "Funding status: Unpaid",
      received: "Received 0.00000000 ZEC",
    },
    {
      name: "expired with received funds",
      payment: {
        ...basePayment,
        status: "expired" as const,
        received_zatoshis: "100000000",
        funding_status: "paid" as const,
      },
      window: "Payment window: Expired",
      funding: "Funding status: Paid",
      received: "Received 1.00000000 ZEC",
    },
    {
      name: "partially paid",
      payment: {
        ...basePayment,
        received_zatoshis: "25000000",
        funding_status: "partially_paid" as const,
      },
      window: "Payment window: Awaiting payment",
      funding: "Funding status: Partially paid",
      received: "Received 0.25000000 ZEC",
    },
    {
      name: "exactly paid",
      payment: {
        ...basePayment,
        received_zatoshis: "100000000",
        funding_status: "paid" as const,
      },
      window: "Payment window: Awaiting payment",
      funding: "Funding status: Paid",
      received: "Received 1.00000000 ZEC",
    },
    {
      name: "overpaid",
      payment: {
        ...basePayment,
        received_zatoshis: "125000000",
        funding_status: "overpaid" as const,
      },
      window: "Payment window: Awaiting payment",
      funding: "Funding status: Overpaid",
      received: "Received 1.25000000 ZEC",
    },
  ])("renders $name without merging the two status families", async ({ payment, window, funding, received }) => {
    renderDetail(payment);

    expect(await screen.findByText(window)).toBeVisible();
    expect(screen.getByText(funding)).toBeVisible();
    expect(screen.getByText(received)).toBeVisible();
  });

  it("keeps an expired paid request's received amount visible", async () => {
    renderDetail({
      ...basePayment,
      status: "expired",
      received_zatoshis: "100000000",
      funding_status: "paid",
    });

    expect(await screen.findByText("Funding status: Paid")).toBeVisible();
    expect(screen.getByText("Received 1.00000000 ZEC")).toBeVisible();
    expect(screen.getByText(/received funds remain recorded/i)).toBeVisible();
    expect(screen.queryByText(/funds (?:were )?(?:lost|vanished)/i)).not.toBeInTheDocument();
  });

  it("provides copy controls for the full payment UUID and address", async () => {
    renderDetail(basePayment);

    expect(await screen.findByText(paymentId)).toBeVisible();
    expect(screen.getByText(basePayment.address!)).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy payment ID" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy address" })).toBeVisible();
  });

  it("shows a provisioning explanation instead of an invented address", async () => {
    renderDetail({
      ...basePayment,
      address: null,
      expires_at: null,
      status: "provisioning",
    });

    expect(await screen.findByText(/address is still being provisioned/i)).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy address" })).not.toBeInTheDocument();
  });
});

describe("ExpiryCountdown", () => {
  it("becomes Expired when the payment window ends", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
    render(<ExpiryCountdown expiresAt="2026-09-17T10:00:02Z" />);

    expect(screen.getByText("Expires in 2 seconds")).toBeVisible();
    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByText("Expired")).toBeVisible();
  });

  it("reconciles the payment-window badge when the local countdown expires", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
    renderDetail({
      ...basePayment,
      expires_at: "2026-09-17T10:00:02Z",
    });

    expect(await screen.findByText("Payment window: Awaiting payment")).toBeVisible();
    act(() => vi.advanceTimersByTime(2000));

    expect(screen.getByText("Payment window: Expired")).toBeVisible();
    expect(screen.getByText(/payment window expired/i)).toBeVisible();
  });
});
