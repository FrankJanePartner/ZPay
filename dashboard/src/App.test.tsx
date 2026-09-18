import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("identifies the merchant dashboard", () => {
  render(<App />);
  expect(
    screen.getByRole("heading", { name: /zpay merchant dashboard/i }),
  ).toBeVisible();
});
