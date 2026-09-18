import { afterEach, expect, it } from "vitest";
import { session } from "./session";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

it("stores dashboard tokens only in session storage", () => {
  session.setToken("zpay_example");

  expect(sessionStorage.getItem("zpay.dashboard.token")).toBe("zpay_example");
  expect(localStorage.getItem("zpay.dashboard.token")).toBeNull();
});

it("clears the dashboard token", () => {
  session.setToken("zpay_example");
  session.clear();

  expect(session.getToken()).toBeNull();
});

it("rejects blank tokens", () => {
  expect(() => session.setToken("   ")).toThrow("Dashboard token cannot be blank");
});
