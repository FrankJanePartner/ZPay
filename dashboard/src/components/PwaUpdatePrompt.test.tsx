import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { PwaUpdatePrompt } from "./PwaUpdatePrompt";

const registration = vi.hoisted(() => ({ ready: () => {}, update: vi.fn<() => Promise<void>>() }));
vi.mock("virtual:pwa-register", () => ({
  registerSW: (options: { onNeedRefresh: () => void }) => {
    registration.ready = options.onNeedRefresh;
    return registration.update;
  },
}));
afterEach(() => registration.update.mockReset());

it("announces a ready update and applies it only after explicit reload", async () => {
  registration.update.mockResolvedValue();
  const user = userEvent.setup();
  render(<PwaUpdatePrompt />);
  expect(screen.queryByRole("button", { name: "Reload to update" })).not.toBeInTheDocument();
  act(() => registration.ready());
  expect(screen.getByRole("status")).toHaveTextContent(/new version.*ready/i);
  expect(registration.update).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Reload to update" }));
  expect(registration.update).toHaveBeenCalledWith(true);
});

it("lets the user defer an update without reloading or losing their work", async () => {
  render(<PwaUpdatePrompt />);
  act(() => registration.ready());
  await userEvent.setup().click(screen.getByRole("button", { name: "Later" }));
  expect(screen.queryByRole("button", { name: "Reload to update" })).not.toBeInTheDocument();
  expect(registration.update).not.toHaveBeenCalled();
});

it("offers retry after an update failure without exposing raw exceptions", async () => {
  registration.update.mockRejectedValue(new Error("secret internal stack"));
  render(<PwaUpdatePrompt />);
  act(() => registration.ready());
  await userEvent.setup().click(screen.getByRole("button", { name: "Reload to update" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(/update could not be applied/i);
  expect(document.body).not.toHaveTextContent("secret internal stack");
  expect(screen.getByRole("button", { name: "Reload to update" })).toBeEnabled();
});
