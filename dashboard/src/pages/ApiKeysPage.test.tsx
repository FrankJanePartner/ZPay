import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { KeyMetadata } from "../api/types";
import { AuthProvider } from "../auth/AuthProvider";
import { session } from "../auth/session";
import { appRoutes } from "../router";
import { API_ORIGIN } from "../test/handlers";
import { server } from "../test/server";

const secret = "zpay_once_only_super_secret";
const activeKey: KeyMetadata = {
  id: "86e12063-f955-45b0-812a-9b4b10d2cac4",
  name: "Private Bill",
  prefix: "zpay_exam",
  created_at: "2026-09-15T15:00:00Z",
  revoked_at: null,
};

function renderApiKeys() {
  session.setToken("zpay_existing");
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/api-keys"] });
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
  return { ...view, queryClient };
}

function respondWithKeys(keys: KeyMetadata[] = [activeKey]) {
  server.use(
    http.get(`${API_ORIGIN}/api/v1/keys/`, () => HttpResponse.json(keys)),
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
  localStorage.clear();
  Reflect.deleteProperty(navigator, "clipboard");
  vi.restoreAllMocks();
});

describe("API keys page", () => {
  it("shows key metadata without inventing or exposing stored secrets", async () => {
    server.use(
      http.get(`${API_ORIGIN}/api/v1/keys/`, () =>
        HttpResponse.json([{ ...activeKey, key: secret }]),
      ),
    );

    const rendered = renderApiKeys();

    expect(await screen.findByText("Private Bill")).toBeVisible();
    expect(screen.getByText("zpay_exam")).toBeVisible();
    expect(screen.getByText("Active")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(JSON.stringify(rendered.queryClient.getQueryData(["api-keys"]))).not.toContain(secret);
  });

  it("keeps a created secret only in component memory and discards it on dismiss", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    respondWithKeys([]);
    server.use(
      http.post(`${API_ORIGIN}/api/v1/keys/`, async ({ request }) => {
        expect(await request.json()).toEqual({ name: "Checkout" });
        return HttpResponse.json({ ...activeKey, name: "Checkout", key: secret }, { status: 201 });
      }),
    );

    const rendered = renderApiKeys();
    await user.type(await screen.findByLabelText("Key name"), "Checkout");
    const createButton = screen.getByRole("button", { name: "Create API key" });
    await user.click(createButton);

    const dialog = await screen.findByRole("dialog", { name: "Save your new API key" });
    expect(dialog).toHaveTextContent(secret);
    expect(dialog).toHaveTextContent(/cannot be retrieved again/i);
    await user.click(screen.getByRole("button", { name: "Copy API key" }));
    expect(writeText).toHaveBeenCalledWith(secret);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.getItem("zpay.dashboard.token")).toBe("zpay_existing");
    expect(JSON.stringify(rendered.queryClient.getQueryData(["api-keys"]))).not.toContain(secret);
    expect(JSON.stringify(rendered.queryClient.getMutationCache().getAll())).not.toContain(secret);

    await user.click(screen.getByRole("button", { name: "Dismiss secret" }));
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(createButton).toHaveFocus();
    rendered.unmount();
    renderApiKeys();
    expect(await screen.findByText(/No API keys yet/i)).toBeVisible();
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
  });

  it("traps keyboard focus, isolates the background, and restores the create trigger on Escape", async () => {
    const user = userEvent.setup();
    respondWithKeys([]);
    server.use(
      http.post(`${API_ORIGIN}/api/v1/keys/`, () =>
        HttpResponse.json({ ...activeKey, name: "Checkout", key: secret }, { status: 201 }),
      ),
    );

    const rendered = renderApiKeys();
    await user.type(await screen.findByLabelText("Key name"), "Checkout");
    const createButton = screen.getByRole("button", { name: "Create API key" });
    await user.click(createButton);

    const dialog = await screen.findByRole("dialog", { name: "Save your new API key" });
    const copy = within(dialog).getByRole("button", { name: "Copy API key" });
    const dismiss = within(dialog).getByRole("button", { name: "Dismiss secret" });
    expect(copy).toHaveFocus();
    expect(rendered.container).toHaveAttribute("inert");
    expect(rendered.container).toHaveAttribute("aria-hidden", "true");

    await user.tab({ shift: true });
    expect(dismiss).toHaveFocus();
    await user.tab();
    expect(copy).toHaveFocus();
    dismiss.focus();
    await user.tab();
    expect(copy).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Save your new API key" })).not.toBeInTheDocument();
    expect(rendered.container).not.toHaveAttribute("inert");
    expect(rendered.container).not.toHaveAttribute("aria-hidden");
    expect(createButton).toHaveFocus();
  });

  it("validates API key names as 1 to 80 characters before sending", async () => {
    const user = userEvent.setup();
    let postCount = 0;
    respondWithKeys([]);
    server.use(
      http.post(`${API_ORIGIN}/api/v1/keys/`, () => {
        postCount += 1;
        return HttpResponse.json({ ...activeKey, key: secret }, { status: 201 });
      }),
    );

    renderApiKeys();
    const name = await screen.findByLabelText("Key name");
    await user.type(name, "   ");
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    expect(screen.getByText("Enter a key name between 1 and 80 characters.")).toBeVisible();
    await user.clear(name);
    await user.type(name, "x".repeat(81));
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    expect(postCount).toBe(0);
  });

  it("cancels revocation without a request, then refreshes metadata after a 204", async () => {
    const user = userEvent.setup();
    let deleteCount = 0;
    let revoked = false;
    server.use(
      http.get(`${API_ORIGIN}/api/v1/keys/`, () =>
        HttpResponse.json([
          revoked ? { ...activeKey, revoked_at: "2026-09-17T12:00:00Z" } : activeKey,
        ]),
      ),
      http.delete(`${API_ORIGIN}/api/v1/keys/${activeKey.id}/`, () => {
        deleteCount += 1;
        revoked = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );

    renderApiKeys();
    await user.click(await screen.findByRole("button", { name: "Revoke Private Bill" }));
    expect(screen.getByRole("alertdialog", { name: "Revoke API key?" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteCount).toBe(0);

    await user.click(screen.getByRole("button", { name: "Revoke Private Bill" }));
    await user.click(screen.getByRole("button", { name: "Confirm revoke" }));

    await waitFor(() => expect(deleteCount).toBe(1));
    expect(await screen.findByText("Revoked", { selector: "span" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Revoke Private Bill" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your API keys" })).toHaveFocus();
  });

  it("traps revoke-dialog focus, isolates the background, and restores the revoke trigger", async () => {
    const user = userEvent.setup();
    respondWithKeys();

    const rendered = renderApiKeys();
    const revokeButton = await screen.findByRole("button", { name: "Revoke Private Bill" });
    await user.click(revokeButton);

    const dialog = screen.getByRole("alertdialog", { name: "Revoke API key?" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const confirm = within(dialog).getByRole("button", { name: "Confirm revoke" });
    expect(cancel).toHaveFocus();
    expect(rendered.container).toHaveAttribute("inert");
    expect(rendered.container).toHaveAttribute("aria-hidden", "true");

    await user.tab({ shift: true });
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    confirm.focus();
    await user.tab();
    expect(cancel).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog", { name: "Revoke API key?" })).not.toBeInTheDocument();
    expect(rendered.container).not.toHaveAttribute("inert");
    expect(rendered.container).not.toHaveAttribute("aria-hidden");
    expect(revokeButton).toHaveFocus();
  });

  it("keeps revoke failures inside the alert dialog", async () => {
    const user = userEvent.setup();
    respondWithKeys();
    server.use(
      http.delete(`${API_ORIGIN}/api/v1/keys/${activeKey.id}/`, () =>
        HttpResponse.json({ detail: "Revocation service unavailable." }, { status: 503 }),
      ),
    );

    renderApiKeys();
    await user.click(await screen.findByRole("button", { name: "Revoke Private Bill" }));
    const dialog = screen.getByRole("alertdialog", { name: "Revoke API key?" });
    await user.click(within(dialog).getByRole("button", { name: "Confirm revoke" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Revocation service unavailable.",
    );
    expect(screen.getByRole("alertdialog", { name: "Revoke API key?" })).toBeVisible();
  });
});
