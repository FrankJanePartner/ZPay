import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { getPayment } from "../api/queries";
import { useApiCooldown, useFinancialRefresh } from "../api/liveState";
import type { PaymentRequest } from "../api/types";
import { ErrorState, LoadingSkeleton } from "../components/AsyncState";
import { CopyButton } from "../components/CopyButton";
import { formatZec } from "../components/Money";

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

function formatTimestamp(timestamp: string | null): string {
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    return "Not available";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(timestamp),
  );
}

function useExpiryClock(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!expiresAt) {
      return;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return now;
}

function ExpiryCountdownValue({ expiresAt, now }: { expiresAt: string | null; now: number }) {
  if (!expiresAt) {
    return <span>Starts after address provisioning</span>;
  }

  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) {
    return <span>Not available</span>;
  }

  const seconds = Math.max(0, Math.ceil((expiry - now) / 1000));
  if (seconds === 0) {
    return <span>Expired</span>;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  const minutePart = minutes > 0 ? `${minutes} ${minutes === 1 ? "minute" : "minutes"} ` : "";
  return <span>Expires in {minutePart}{remainder} {remainder === 1 ? "second" : "seconds"}</span>;
}

export function ExpiryCountdown({ expiresAt }: { expiresAt: string | null }) {
  return <ExpiryCountdownValue expiresAt={expiresAt} now={useExpiryClock(expiresAt)} />;
}

function PaymentDetails({ payment }: { payment: PaymentRequest }) {
  const hasReceivedFunds = payment.funding_status !== "unpaid";
  const now = useExpiryClock(payment.status === "awaiting_payment" ? payment.expires_at : null);
  const expiry = payment.expires_at ? Date.parse(payment.expires_at) : Number.NaN;
  const windowStatus = payment.status === "awaiting_payment" && !Number.isNaN(expiry) && expiry <= now
    ? "expired"
    : payment.status;

  return (
    <>
      <div className="payment-detail-heading">
        <div>
          <p className="eyebrow">Payment request</p>
          <h1 id="payment-detail-title">{payment.reference}</h1>
        </div>
        <Link to="/payments">Back to payments</Link>
      </div>

      <div className="payment-statuses" aria-label="Payment statuses">
        <span className={`status-badge payment-window-${windowStatus}`}>
          Payment window: {windowLabels[windowStatus]}
        </span>
        <span className={`status-badge payment-funding-${payment.funding_status}`}>
          Funding status: {fundingLabels[payment.funding_status]}
        </span>
      </div>

      {windowStatus === "expired" ? (
        <div className="payment-expiry-notice" role="note">
          Payment window expired. {hasReceivedFunds
            ? "Received funds remain recorded."
            : "The address remains recorded and any observed funds will still be shown."}
        </div>
      ) : null}

      <dl className="payment-detail-grid">
        <div>
          <dt>Requested amount</dt>
          <dd>Requested {formatZec(payment.amount_zatoshis)} ZEC</dd>
        </div>
        <div>
          <dt>Received amount</dt>
          <dd>Received {formatZec(payment.received_zatoshis)} ZEC</dd>
        </div>
        <div>
          <dt>Time remaining</dt>
          <dd><ExpiryCountdownValue expiresAt={payment.expires_at} now={now} /></dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{formatTimestamp(payment.created_at)}</dd>
        </div>
        <div>
          <dt>Expires</dt>
          <dd>{formatTimestamp(payment.expires_at)}</dd>
        </div>
      </dl>

      <section className="payment-identifiers" aria-labelledby="payment-identifiers-title">
        <h2 id="payment-identifiers-title">Payment identifiers</h2>
        <div className="identifier-row">
          <div>
            <span className="identifier-label">Payment UUID</span>
            <code>{payment.id}</code>
          </div>
          <CopyButton label="payment ID" value={payment.id} />
        </div>
        <div className="identifier-row">
          <div>
            <span className="identifier-label">Payment address</span>
            {payment.address ? (
              <code>{payment.address}</code>
            ) : (
              <span>The address is still being provisioned.</span>
            )}
          </div>
          {payment.address ? <CopyButton label="address" value={payment.address} /> : null}
        </div>
      </section>
    </>
  );
}

export function PaymentDetailPage() {
  const refresh = useFinancialRefresh();
  const cooldown = useApiCooldown();
  const { id = "" } = useParams();
  const paymentQuery = useQuery({
    ...refresh,
    queryKey: ["payments", id],
    queryFn: ({ signal }) => getPayment(id, signal),
    enabled: id.length > 0 && refresh.enabled,
  });

  return (
    <section className="payment-detail-page" aria-labelledby="payment-detail-title">
      {paymentQuery.isLoading ? (
        <LoadingSkeleton label="Loading payment request" className="payment-detail-skeleton" />
      ) : null}
      {paymentQuery.isError ? (
        <ErrorState error={paymentQuery.error}>
          <p>Unable to load this payment request.</p>
          {paymentQuery.data ? <p>Showing the last available request; funding status may be out of date.</p> : null}
          <button type="button" disabled={cooldown > 0} onClick={() => void paymentQuery.refetch()}>
            Retry payment request
          </button>
          <Link to="/payments">Back to payments</Link>
        </ErrorState>
      ) : null}
      {paymentQuery.data ? <PaymentDetails payment={paymentQuery.data} /> : null}
    </section>
  );
}
