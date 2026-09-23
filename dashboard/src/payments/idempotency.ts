export interface CreatePaymentPayload {
  reference: string;
  amount_zatoshis: string;
  ttl_seconds: number;
}

export interface PaymentAttempt {
  readonly idempotencyKey: string;
  readonly payload: Readonly<CreatePaymentPayload>;
  nextRetry(): PaymentAttempt;
}

export function createPaymentAttempt(payload: CreatePaymentPayload): PaymentAttempt {
  const immutablePayload = Object.freeze({ ...payload });
  const idempotencyKey = crypto.randomUUID();
  let attempt: PaymentAttempt;

  attempt = Object.freeze({
    idempotencyKey,
    payload: immutablePayload,
    nextRetry: () => attempt,
  });

  return attempt;
}
