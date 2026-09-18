import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { API_ORIGIN } from "../api/client";
import { AuthProvider } from "../auth/AuthProvider";
import { session } from "../auth/session";
import { appRoutes } from "../router";
import { renderWithProviders } from "../test/render";

function setViewport(narrow: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query === "(max-width: 767px)" ? narrow : !narrow,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function renderAt(path = "/dashboard") {
  session.setToken("zpay_existing");
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  return renderWithProviders(
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>,
  );
}

function expectMerchantLinks(navigation: HTMLElement) {
  expect(navigation).toHaveTextContent("Overview");
  expect(navigation).toHaveTextContent("Payments");
  expect(navigation).toHaveTextContent("Transactions");
  expect(navigation).toHaveTextContent("API Keys");
}

afterEach(() => {
  session.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("responsive application shell", () => {
  it("shows primary navigation on wide screens", () => {
    setViewport(false);
    renderAt();

    const navigation = screen.getByRole("navigation", { name: "Primary navigation" });
    expectMerchantLinks(navigation);
    expect(screen.queryByRole("navigation", { name: "Mobile navigation" })).not.toBeInTheDocument();
  });

  it("shows mobile navigation on narrow screens", () => {
    setViewport(true);
    renderAt();

    const navigation = screen.getByRole("navigation", { name: "Mobile navigation" });
    expectMerchantLinks(navigation);
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).not.toBeInTheDocument();
  });

  it("opens API documentation only after the user chooses to", async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    setViewport(false);
    renderAt("/docs");

    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /open api docs/i }));

    expect(open).toHaveBeenCalledOnce();
    expect(open).toHaveBeenCalledWith(`${API_ORIGIN}/`, "_blank", "noopener,noreferrer");
  });
});
