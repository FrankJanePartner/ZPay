import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useApiCooldown, useFinancialRefresh } from "../api/liveState";
import { createPayment, getPayments } from "../api/queries";
import type { ApiErrorFields, PaymentRequest } from "../api/types";
import { session } from "../auth/session";
import { ErrorState, LoadingSkeleton } from "../components/AsyncState";
import { formatZec } from "../components/Money";
import {
  createPaymentAttempt,
  type CreatePaymentPayload,
  type PaymentAttempt,
} from "../payments/idempotency";

const windowLabels: Record<PaymentRequest["status"], string> = {
  provisioning: "Provisioning",
  awaiting_payment: "Awaiting payment",
  expired: "Expired",
};

const fundingLabels: Record<PaymentRequest["funding_status"], string> = {
  unpaid: "Unpaid",
  partially_paid: "Partially paid",
  paid: "Paid",
  overpaid: "Overpaid",
};

const MAX_ZATOSHI_AMOUNT = 2_100_000_000_000_000n;
const INTEGER_AMOUNT_PATTERN = /^[1-9][0-9]{0,15}$/;
const MAX_AMOUNT_ERROR = "Amount must be no more than 2100000000000000 zatoshis.";

interface PaymentOperation {
  readonly attempt: PaymentAttempt;
  readonly controller: AbortController;
  readonly sessionToken: string | null;
}

function fieldMessage(fields: ApiErrorFields | undefined, name: string): string | undefined {
  const value = fields?.[name];
  return Array.isArray(value) ? value.join(" ") : value;
}

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    return "Not available";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(timestamp),
  );
}

function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

export function PaymentCard({ payment }: { payment: PaymentRequest }) {
  return (
    <li className="payment-card">
      <div className="payment-card-heading">
        <h3>{payment.reference}</h3>
        <Link to={`/payments/${payment.id}`} aria-label={`View ${payment.reference} details`}>
          View details
        </Link>
      </div>
      <div className="payment-statuses">
        <span className={`status-badge payment-window-${payment.status}`}>
          Window: {windowLabels[payment.status]}
        </span>
        <span className={`status-badge payment-funding-${payment.funding_status}`}>
          Funding: {fundingLabels[payment.funding_status]}
        </span>
      </div>
      <dl className="payment-summary">
        <div>
          <dt>Requested</dt>
          <dd>Requested {formatZec(payment.amount_zatoshis)} ZEC</dd>
        </div>
        <div>
          <dt>Received</dt>
          <dd>Received {formatZec(payment.received_zatoshis)} ZEC</dd>
        </div>
        <div>
          <dt>Expiry</dt>
          <dd>Expires: {formatTimestamp(payment.expires_at)}</dd>
        </div>
      </dl>
    </li>
  );
}

function CreationError({
  error,
  retry,
  startNew,
  cooldown,
}: {
  error: unknown;
  retry: () => void;
  startNew: () => void;
  cooldown: number;
}) {
  const apiError = error instanceof ApiError ? error : undefined;

  if (apiError?.status === 409) {
    return (
      <ErrorState>
        <p>The idempotency key conflicts with a changed payload. Start a new payment.</p>
        <button type="button" onClick={startNew}>Start new payment</button>
      </ErrorState>
    );
  }

  if (apiError?.status === 503) {
    return (
      <ErrorState>
        <p>The wallet service is temporarily unavailable. A safe retry keeps the same request.</p>
        <button type="button" onClick={retry} disabled={cooldown > 0}>Retry safely</button>
      </ErrorState>
    );
  }

  if (apiError?.status === 429) {
    const delay = apiError.retryAfterSeconds;
    return (
      <ErrorState>
        Request throttled{delay === undefined ? "." : `; retry in ${delay} seconds.`}
      </ErrorState>
    );
  }

  return <ErrorState error={error}>{apiError?.detail ?? "Unable to create the payment request."}</ErrorState>;
}

export function PaymentsPage() {
  const refresh = useFinancialRefresh();
  const cooldown = useApiCooldown();
  const firstPageUrl = "/api/v1/payment-requests/";
  const [pageUrl, setPageUrl] = useState(firstPageUrl);
  const [pageHistory, setPageHistory] = useState<string[]>([]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [ttl, setTtl] = useState("1800");
  const [attempt, setAttempt] = useState<PaymentAttempt | null>(null);
  const [clientAmountError, setClientAmountError] = useState<string | null>(null);
  const mounted = useRef(false);
  const activeOperation = useRef<PaymentOperation | null>(null);

  const paymentsQuery = useQuery({
    ...refresh,
    queryKey: ["payments", "list", pageUrl],
    queryFn: ({ signal }) => getPayments(pageUrl, signal),
  });

  function navigateToPage(nextPageUrl: string) {
    setPageHistory((history) => [...history, pageUrl]);
    setPageUrl(nextPageUrl);
  }

  function returnToPreviousPage() {
    const previous = pageHistory[pageHistory.length - 1];
    if (!previous) return;
    setPageHistory((history) => history.slice(0, -1));
    setPageUrl(previous);
  }
  const creation = useMutation({
    mutationFn: ({ attempt: activeAttempt, controller }: PaymentOperation) =>
      createPayment(activeAttempt.payload, activeAttempt.idempotencyKey, controller.signal),
    onError(error, operation) {
      if (!isCurrentOperation(operation)) {
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        setAttempt(null);
      }
    },
    async onSuccess(payment, operation) {
      if (!isCurrentOperation(operation)) {
        return;
      }
      setAttempt(null);
      for (const queryKey of [["payments"], ["wallet-balance"], ["recent-transactions"]]) {
        if (!isCurrentOperation(operation)) {
          return;
        }
        await queryClient.invalidateQueries({ queryKey });
      }
      if (isCurrentOperation(operation)) {
        navigate(`/payments/${payment.id}`);
      }
    },
    onSettled(_data, _error, operation) {
      if (activeOperation.current === operation) {
        activeOperation.current = null;
      }
    },
  });

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = session.subscribe((nextToken) => {
      const operation = activeOperation.current;
      if (operation && operation.sessionToken !== nextToken) {
        activeOperation.current = null;
        operation.controller.abort();
      }
    });

    return () => {
      mounted.current = false;
      activeOperation.current?.controller.abort();
      activeOperation.current = null;
      unsubscribe();
    };
  }, []);

  function isCurrentOperation(operation: PaymentOperation): boolean {
    return (
      mounted.current &&
      activeOperation.current === operation &&
      !operation.controller.signal.aborted &&
      session.getToken() === operation.sessionToken
    );
  }

  function currentPayload(): CreatePaymentPayload {
    return {
      reference,
      amount_zatoshis: amount,
      ttl_seconds: Number(ttl),
    };
  }

  function submitAttempt(nextAttempt: PaymentAttempt) {
    if (creation.isPending || cooldown > 0) {
      return;
    }
    activeOperation.current?.controller.abort();
    const operation = {
      attempt: nextAttempt,
      controller: new AbortController(),
      sessionToken: session.getToken(),
    };
    activeOperation.current = operation;
    setAttempt(nextAttempt);
    creation.mutate(operation);
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = currentPayload();
    if (
      INTEGER_AMOUNT_PATTERN.test(payload.amount_zatoshis) &&
      BigInt(payload.amount_zatoshis) > MAX_ZATOSHI_AMOUNT
    ) {
      activeOperation.current?.controller.abort();
      activeOperation.current = null;
      setAttempt(null);
      creation.reset();
      setClientAmountError(MAX_AMOUNT_ERROR);
      return;
    }
    setClientAmountError(null);
    submitAttempt(attempt ?? createPaymentAttempt(payload));
  }

  function editPayload(setValue: (value: string) => void, value: string) {
    activeOperation.current?.controller.abort();
    activeOperation.current = null;
    setValue(value);
    setAttempt(null);
    setClientAmountError(null);
    creation.reset();
  }

  function startNewPayment() {
    creation.reset();
    submitAttempt(createPaymentAttempt(currentPayload()));
  }

  const payments = paymentsQuery.data;
  const retainedListError = paymentsQuery.isError && payments !== undefined;
  const creationApiError = creation.error instanceof ApiError ? creation.error : undefined;
  const referenceError = fieldMessage(creationApiError?.fields, "reference");
  const amountError =
    clientAmountError ?? fieldMessage(creationApiError?.fields, "amount_zatoshis");
  const ttlError = fieldMessage(creationApiError?.fields, "ttl_seconds");

  return (
    <section className="payments-page" aria-labelledby="payments-title">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">ZPay Merchant</p>
          <h1 id="payments-title">Payments</h1>
        </div>
      </div>

      <section className="payment-create-panel" aria-labelledby="create-payment-title">
        <h2 id="create-payment-title">Create payment request</h2>
        <form className="payment-form" onSubmit={submit}>
          <label htmlFor="payment-reference">Reference</label>
          <input
            id="payment-reference"
            value={reference}
            required
            maxLength={128}
            disabled={creation.isPending}
            aria-invalid={referenceError ? true : undefined}
            aria-describedby={referenceError ? "payment-reference-error" : undefined}
            onChange={(event) => editPayload(setReference, event.target.value)}
          />
          {referenceError ? (
            <p id="payment-reference-error" className="field-error">{referenceError}</p>
          ) : null}

          <label htmlFor="payment-amount">Amount (zatoshis)</label>
          <input
            id="payment-amount"
            value={amount}
            required
            inputMode="numeric"
            pattern="[1-9][0-9]{0,15}"
            disabled={creation.isPending}
            aria-invalid={amountError ? true : undefined}
            aria-describedby={amountError ? "payment-amount-error" : undefined}
            onChange={(event) => editPayload(setAmount, event.target.value)}
          />
          {amountError ? (
            <p id="payment-amount-error" className="field-error">{amountError}</p>
          ) : null}

          <label htmlFor="payment-ttl">Expiry (seconds)</label>
          <input
            id="payment-ttl"
            type="number"
            value={ttl}
            required
            min={60}
            max={1800}
            step={1}
            disabled={creation.isPending}
            aria-invalid={ttlError ? true : undefined}
            aria-describedby={
              ttlError ? "payment-ttl-hint payment-ttl-error" : "payment-ttl-hint"
            }
            onChange={(event) => editPayload(setTtl, event.target.value)}
          />
          <p id="payment-ttl-hint" className="field-hint">
            Choose 60–1800 seconds. Default: 1800.
          </p>
          {ttlError ? (
            <p id="payment-ttl-error" className="field-error">{ttlError}</p>
          ) : null}

          <button type="submit" disabled={creation.isPending || cooldown > 0}>
            {creation.isPending ? "Creating payment request" : "Create payment request"}
          </button>
        </form>
        {creation.isError ? (
          <CreationError
            error={creation.error}
            retry={() => attempt && submitAttempt(attempt.nextRetry())}
            startNew={startNewPayment}
            cooldown={cooldown}
          />
        ) : null}
      </section>

      <section className="payment-list-panel" aria-labelledby="payment-list-title">
        <div className="section-heading">
          <h2 id="payment-list-title">Payment requests</h2>
        </div>
        {paymentsQuery.isLoading && !payments ? (
          <LoadingSkeleton label="Loading payment requests" className="recent-skeleton" />
        ) : null}
        {paymentsQuery.isError && !payments ? (
          <ErrorState error={paymentsQuery.error}>
            <p>Unable to load payment requests.</p>
            {paymentsQuery.error instanceof ApiError && paymentsQuery.error.detail === "Invalid pagination URL." ? <p>{paymentsQuery.error.detail}</p> : null}
            <button type="button" disabled={cooldown > 0 || paymentsQuery.isFetching} onClick={() => void paymentsQuery.refetch()}>
              Retry payment requests
            </button>
            {pageHistory.length > 0 ? <button type="button" onClick={returnToPreviousPage}>Back to previous page</button> : null}
            {pageUrl !== firstPageUrl ? <button type="button" onClick={() => { setPageHistory([]); setPageUrl(firstPageUrl); }}>Back to first page</button> : null}
          </ErrorState>
        ) : null}
        {retainedListError ? (
          <ErrorState error={paymentsQuery.error}>
            <p>
              {isOffline(paymentsQuery.error)
                ? "Offline: showing the most recently available payment requests."
                : "Payment requests could not be refreshed. Showing the most recently available snapshot."}
            </p>
            <button type="button" disabled={cooldown > 0 || paymentsQuery.isFetching} onClick={() => void paymentsQuery.refetch()}>
              Retry payment requests
            </button>
          </ErrorState>
        ) : null}
        {payments?.results.length === 0 ? (
          <div className="empty-state">No payment requests yet. Create one above.</div>
        ) : null}
        {payments && payments.results.length > 0 ? (
          <ul className="payment-list">
            {payments.results.map((payment) => <PaymentCard key={payment.id} payment={payment} />)}
          </ul>
        ) : null}
        {payments && (payments.previous || payments.next) ? (
          <nav className="pagination-actions" aria-label="Payment pages">
            <button type="button" disabled={!payments.previous || paymentsQuery.isFetching || cooldown > 0}
              onClick={() => payments.previous && navigateToPage(payments.previous)}>Previous page</button>
            <button type="button" disabled={!payments.next || paymentsQuery.isFetching || cooldown > 0}
              onClick={() => payments.next && navigateToPage(payments.next)}>Next page</button>
          </nav>
        ) : null}
      </section>
    </section>
  );
}
