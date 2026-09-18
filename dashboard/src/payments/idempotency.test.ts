import { describe, expect, it } from "vitest";
import { createPaymentAttempt } from "./idempotency";

describe("createPaymentAttempt", () => {
  const payload = {
    reference: "order-1042",
    amount_zatoshis: "100000",
    ttl_seconds: 1800,
  };

  it("retains one key and immutable body for a safe retry", () => {
    const editablePayload = { ...payload };
    const attempt = createPaymentAttempt(editablePayload);

    editablePayload.reference = "edited-order";
    editablePayload.amount_zatoshis = "200000";
    editablePayload.ttl_seconds = 60;

    const retry = attempt.nextRetry();
    expect(retry.idempotencyKey).toBe(attempt.idempotencyKey);
    expect(retry.payload).toEqual(payload);
    expect(Object.isFrozen(retry.payload)).toBe(true);
    expect(() => {
      Object.assign(retry.payload, { reference: "mutated" });
    }).toThrow();
  });

  it("gives each new operation a fresh key", () => {
    const attempt = createPaymentAttempt(payload);

    expect(createPaymentAttempt(payload).idempotencyKey).not.toBe(attempt.idempotencyKey);
    expect(
      createPaymentAttempt({ ...payload, amount_zatoshis: "200000" }).idempotencyKey,
    ).not.toBe(attempt.idempotencyKey);
  });
});
