import { expect, it } from "vitest";
import { formatZec } from "./Money";

it.each([
  ["0", "0.00000000"],
  ["1", "0.00000001"],
  ["100000000", "1.00000000"],
  ["2100000000000000", "21000000.00000000"],
])("formats %s zatoshi exactly as %s", (zatoshi, expected) => {
  expect(formatZec(zatoshi)).toBe(expected);
});

it("rejects fractional zatoshi amounts", () => {
  expect(() => formatZec("1.5")).toThrow("Invalid zatoshi amount");
});
