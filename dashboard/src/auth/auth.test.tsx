import { RouterProvider, createMemoryRouter, useLocation } from "react-router-dom";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, describe, expect, it } from "vitest";
import { apiRequest } from "../api/client";
import { appRoutes } from "../router";
import { API_ORIGIN } from "../test/handlers";
import { renderWithProviders } from "../test/render";
import { server } from "../test/server";
import { LoginPage } from "../pages/LoginPage";
import { AuthProvider, useAuth } from "./AuthProvider";
import { ProtectedRoute } from "./ProtectedRoute";
import { session } from "./session";

function renderAt(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return renderWithProviders(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

function UnauthorizedRequest() {
  return (
    <button
      type="button"
      onClick={() => void apiRequest("/api/v1/private/").catch(() => undefined)}
    >
      Load account
    </button>
  );
}

function ProtectedDestination() {
  const location = useLocation();
  return <p>Destination: {location.pathname}{location.search}{location.hash}</p>;
}

function renderUnauthorizedRequest() {
  const router = createMemoryRouter(
    [
      { path: "/login", element: <LoginPage /> },
      {
        element: <ProtectedRoute />,
        children: [{ path: "/private", element: <UnauthorizedRequest /> }],
      },
    ],
    { initialEntries: ["/private"] },
  );

  return renderWithProviders(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

let capturedAuth: ReturnType<typeof useAuth> | undefined;

function CaptureAuth() {
  capturedAuth = useAuth();
  return null;
}

afterEach(() => {
  capturedAuth = undefined;
  session.clear();
});

describe("authentication routes", () => {
  it("redirects a visitor without a session from a protected route to sign in", async () => {
    renderAt("/dashboard");

    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeVisible();
  });

  it("returns to the full protected URL after sign in", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/auth/login/`, () =>
        HttpResponse.json({ token: "zpay_login", expires_in: 43_200 }),
      ),
    );
    const router = createMemoryRouter(
      [
        { path: "/login", element: <LoginPage /> },
        {
          element: <ProtectedRoute />,
          children: [{ path: "/private", element: <ProtectedDestination /> }],
        },
      ],
      { initialEntries: ["/private?tab=receipts#latest"] },
    );
    renderWithProviders(
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>,
    );

    await user.type(await screen.findByRole("textbox", { name: /email/i }), "merchant@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "strong-password-482");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByText("Destination: /private?tab=receipts#latest")).toBeVisible();
  });

  it("registers with the API and starts a dashboard session", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/auth/register/`, async ({ request }) => {
        expect(await request.json()).toEqual({
          email: "merchant@example.com",
          password: "strong-password-482",
        });
        return HttpResponse.json(
          { token: "zpay_registered", expires_in: 43_200 },
          { status: 201 },
        );
      }),
    );
    renderAt("/register");

    const email = screen.getByRole("textbox", { name: /email/i });
    const password = screen.getByLabelText(/^password$/i);
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(password).toHaveAttribute("autocomplete", "new-password");

    await user.type(email, "merchant@example.com");
    await user.type(password, "strong-password-482");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByRole("heading", { name: /overview/i })).toBeVisible();
    expect(session.getToken()).toBe("zpay_registered");
  });

  it("shows a safe login failure without creating a session", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/auth/login/`, () =>
        HttpResponse.json({ detail: "Invalid credentials." }, { status: 401 }),
      ),
    );
    renderAt("/login");

    const email = screen.getByRole("textbox", { name: /email/i });
    const password = screen.getByLabelText(/^password$/i);
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(password).toHaveAttribute("autocomplete", "current-password");

    await user.type(email, "merchant@example.com");
    await user.type(password, "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials.");
    expect(session.getToken()).toBeNull();
  });

  it("prevents duplicate submissions while sign in is in flight", async () => {
    const user = userEvent.setup();
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    server.use(
      http.post(`${API_ORIGIN}/api/v1/auth/login/`, async () => {
        await responseGate;
        return HttpResponse.json({ token: "zpay_login", expires_in: 43_200 });
      }),
    );
    renderAt("/login");

    await user.type(screen.getByRole("textbox", { name: /email/i }), "merchant@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "strong-password-482");
    const submit = screen.getByRole("button", { name: /sign in/i });
    await user.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    releaseResponse();
    expect(await screen.findByRole("heading", { name: /overview/i })).toBeVisible();
  });

  it("associates API validation messages with their fields", async () => {
    const user = userEvent.setup();
    server.use(
      http.post(`${API_ORIGIN}/api/v1/auth/register/`, () =>
        HttpResponse.json(
          { email: ["Account cannot be created with this email."] },
          { status: 400 },
        ),
      ),
    );
    renderAt("/register");

    const email = screen.getByRole("textbox", { name: /email/i });
    await user.type(email, "merchant@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "strong-password-482");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() =>
      expect(email).toHaveAccessibleDescription("Account cannot be created with this email."),
    );
  });

  it.each(["/login", "/register"])(
    "redirects an authenticated user away from %s",
    async (path) => {
      session.setToken("zpay_existing");
      renderAt(path);

      expect(await screen.findByRole("heading", { name: /overview/i })).toBeVisible();
    },
  );

  it("clears the local session when remote logout is unavailable", async () => {
    const user = userEvent.setup();
    session.setToken("zpay_existing");
    server.use(
      http.post(`${API_ORIGIN}/api/v1/auth/logout/`, () =>
        HttpResponse.json({ detail: "Service unavailable." }, { status: 503 }),
      ),
    );
    renderAt("/dashboard");

    await user.click(await screen.findByRole("button", { name: /log out/i }));

    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeVisible();
    expect(session.getToken()).toBeNull();
  });

  it("never shows merchant A cached balances while merchant B's dashboard request is pending", async () => {
    const user = userEvent.setup();
    const merchantATransactionId = "a1".repeat(32);
    let merchantBRequestStarted!: () => void;
    let releaseMerchantB!: () => void;
    const merchantBRequest = new Promise<void>((resolve) => {
      merchantBRequestStarted = resolve;
    });
    const merchantBGate = new Promise<void>((resolve) => {
      releaseMerchantB = resolve;
    });
    server.use(
      http.post(`${API_ORIGIN}/api/v1/auth/logout/`, () => new HttpResponse(null, { status: 204 })),
      http.post(`${API_ORIGIN}/api/v1/auth/login/`, () =>
        HttpResponse.json({ token: "zpay_merchant_b", expires_in: 43_200 }),
      ),
      http.get(`${API_ORIGIN}/api/v1/balance/`, async ({ request }) => {
        if (request.headers.get("authorization") === "Bearer zpay_merchant_a") {
          return HttpResponse.json({
            total_zatoshis: "100000000",
            spendable_zatoshis: "100000000",
            pending_zatoshis: "0",
            confirmed_received_zatoshis: "100000000",
            chain_height: 1,
            synced_at: "2026-09-15T16:00:00Z",
            stale: false,
            sync_error: "",
            settlement_enabled: false,
          });
        }
        merchantBRequestStarted();
        await merchantBGate;
        return HttpResponse.json({ detail: "Service unavailable." }, { status: 503 });
      }),
      http.get(`${API_ORIGIN}/api/v1/transactions/`, ({ request }) => {
        if (request.headers.get("authorization") === "Bearer zpay_merchant_a") {
          return HttpResponse.json({
            count: 1,
            next: null,
            previous: null,
            results: [{
              id: "db32a049-4b34-4c48-ae39-072c5f9395c00",
              payment_request: null,
              txid: merchantATransactionId,
              pool: 3,
              output_index: 0,
              amount_zatoshis: "1",
              address: "u1merchant-a-address",
              mined_height: 1,
              block_time: "2026-09-15T16:00:00Z",
              confirmations: 1,
              status: "confirmed",
              late: null,
              first_seen_at: "2026-09-15T16:01:00Z",
            }],
          });
        }
        return HttpResponse.json({ count: 0, next: null, previous: null, results: [] });
      }),
    );
    session.setToken("zpay_merchant_a");
    renderAt("/dashboard");

    expect(await screen.findAllByText("1.00000000 ZEC")).not.toHaveLength(0);
    expect(await screen.findByTitle(merchantATransactionId)).toBeVisible();
    await user.click(screen.getByRole("button", { name: /log out/i }));
    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeVisible();

    await user.type(screen.getByRole("textbox", { name: /email/i }), "merchant-b@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "strong-password-482");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await merchantBRequest;

    try {
      expect(screen.queryByText("1.00000000 ZEC")).not.toBeInTheDocument();
      expect(screen.queryByTitle(merchantATransactionId)).not.toBeInTheDocument();
      expect(screen.getByLabelText("Loading wallet balance")).toBeVisible();

      releaseMerchantB();
      expect(await screen.findByRole("alert")).toHaveTextContent("Unable to load wallet balance.");
      expect(screen.queryByText("1.00000000 ZEC")).not.toBeInTheDocument();
      expect(screen.queryByTitle(merchantATransactionId)).not.toBeInTheDocument();
    } finally {
      releaseMerchantB();
    }
  });

  it("redirects protected UI when an authenticated API request returns 401", async () => {
    const user = userEvent.setup();
    session.setToken("zpay_expired");
    server.use(
      http.get(`${API_ORIGIN}/api/v1/private/`, () =>
        HttpResponse.json({ detail: "Invalid or revoked token." }, { status: 401 }),
      ),
    );
    renderUnauthorizedRequest();

    await user.click(screen.getByRole("button", { name: /load account/i }));

    expect(await screen.findByRole("heading", { name: /sign in/i })).toBeVisible();
    expect(session.getToken()).toBeNull();
  });

  it("cancels a pending login when navigation unmounts the login page", async () => {
    const user = userEvent.setup();
    let requestSignal: AbortSignal | undefined;
    let releaseResponse!: () => void;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    server.use(
      http.post(`${API_ORIGIN}/api/v1/auth/login/`, async ({ request }) => {
        requestSignal = request.signal;
        await responseGate;
        return HttpResponse.json({ token: "zpay_abandoned", expires_in: 43_200 });
      }),
    );
    renderAt("/login");

    await user.type(screen.getByRole("textbox", { name: /email/i }), "old@example.com");
    await user.type(screen.getByLabelText(/^password$/i), "strong-password-482");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(requestSignal).toBeDefined());

    await user.click(screen.getByRole("link", { name: /create an account/i }));
    expect(await screen.findByRole("heading", { name: /create account/i })).toBeVisible();

    try {
      await waitFor(() => expect(requestSignal?.aborted).toBe(true));
      expect(session.getToken()).toBeNull();
    } finally {
      releaseResponse();
    }
  });

  it("does not let an older auth response overwrite a newer session", async () => {
    let releaseOlderResponse!: () => void;
    let olderRequestStarted!: () => void;
    const olderResponseGate = new Promise<void>((resolve) => {
      releaseOlderResponse = resolve;
    });
    const olderRequest = new Promise<void>((resolve) => {
      olderRequestStarted = resolve;
    });
    server.use(
      http.post(`${API_ORIGIN}/api/v1/auth/login/`, async () => {
        olderRequestStarted();
        await olderResponseGate;
        return HttpResponse.json({ token: "zpay_older", expires_in: 43_200 });
      }),
      http.post(`${API_ORIGIN}/api/v1/auth/register/`, () =>
        HttpResponse.json(
          { token: "zpay_newer", expires_in: 43_200 },
          { status: 201 },
        ),
      ),
    );
    renderWithProviders(
      <AuthProvider>
        <CaptureAuth />
      </AuthProvider>,
    );

    let olderAttempt!: Promise<boolean>;
    act(() => {
      olderAttempt = capturedAuth!.login({
        email: "old@example.com",
        password: "strong-password-482",
      });
    });
    await olderRequest;

    await act(async () => {
      await capturedAuth!.register({
        email: "new@example.com",
        password: "strong-password-483",
      });
    });
    expect(session.getToken()).toBe("zpay_newer");

    await act(async () => {
      releaseOlderResponse();
      await olderAttempt;
    });
    expect(session.getToken()).toBe("zpay_newer");
  });
});
