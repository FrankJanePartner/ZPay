import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { getPayments, getRecentTransactions, getWalletBalance } from "../api/queries";
import { useApiCooldown, useClock, useConnectivity, useFinancialRefresh } from "../api/liveState";
import { PaymentCard } from "./PaymentsPage";
import type { DepositOutput, WalletBalance } from "../api/types";
import { ErrorState, LoadingSkeleton } from "../components/AsyncState";
import { CopyButton } from "../components/CopyButton";
import { formatZec } from "../components/Money";

const balanceItems: Array<{
  key: keyof Pick<WalletBalance, "total_zatoshis" | "spendable_zatoshis" | "pending_zatoshis" | "confirmed_received_zatoshis">;
  label: string;
  description?: string;
}> = [
  { key: "total_zatoshis", label: "Total wallet balance" },
  { key: "spendable_zatoshis", label: "Spendable balance" },
  { key: "pending_zatoshis", label: "Pending balance" },
  {
    key: "confirmed_received_zatoshis",
    label: "Cumulative received",
    description: "Lifetime confirmed receipts; this is not a spendable balance.",
  },
];

function isOffline(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 0;
}

function amountLabel(amount: string | null): string {
  return amount === null ? "Not synced" : `${formatZec(amount)} ZEC`;
}

function formattedTimestamp(timestamp: string | null): string {
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) {
    return "Not synced";
  }

  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(timestamp),
  );
}

function shortValue(value: string): string {
  return value.length <= 18 ? value : `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function RecentOutput({ output }: { output: DepositOutput }) {
  return (
    <li className="recent-output">
      <div>
        <strong>{amountLabel(output.amount_zatoshis)}</strong>
        <span>{formattedTimestamp(output.block_time)}</span>
      </div>
      <div className="recent-output-meta">
        <span className={`output-status ${output.status}`}> {output.status === "confirmed" ? "Confirmed" : "Reversed"}</span>
        <span title={output.txid}>Transaction {shortValue(output.txid)}</span>
        <CopyButton label="transaction ID" value={output.txid} />
        {output.address ? (
          <>
            <span title={output.address}>Address {shortValue(output.address)}</span>
            <CopyButton label="address" value={output.address} />
          </>
        ) : null}
        {output.payment_request ? (
          <>
            <span title={output.payment_request}>Payment {shortValue(output.payment_request)}</span>
            <CopyButton label="payment ID" value={output.payment_request} />
          </>
        ) : null}
      </div>
    </li>
  );
}

export function DashboardPage() {
  const refresh = useFinancialRefresh();
  const online = useConnectivity();
  const now = useClock();
  const cooldown = useApiCooldown();
  const balanceQuery = useQuery({ ...refresh, queryKey: ["wallet-balance"], queryFn: ({ signal }) => getWalletBalance(signal) });
  const transactionsQuery = useQuery({
    ...refresh,
    queryKey: ["recent-transactions"],
    queryFn: ({ signal }) => getRecentTransactions(signal),
  });
  const paymentsQuery = useQuery({
    ...refresh,
    queryKey: ["payments", "recent"],
    queryFn: ({ signal }) => getPayments(undefined, signal),
  });
  const balance = balanceQuery.data;
  const transactions = transactionsQuery.data;
  const retainedError =
    (balanceQuery.isError && balance !== undefined) ||
    (transactionsQuery.isError && transactions !== undefined) ||
    (paymentsQuery.isError && paymentsQuery.data !== undefined);
  const offline =
    (balanceQuery.isError && balance !== undefined && isOffline(balanceQuery.error)) ||
    (transactionsQuery.isError && transactions !== undefined && isOffline(transactionsQuery.error));
  const syncedAt = balance?.synced_at ? Date.parse(balance.synced_at) : Number.NaN;
  const stale = balance !== undefined && (balance.stale || !!balance.sync_error || !Number.isFinite(syncedAt) || now - syncedAt > 120_000);

  return (
    <section className="dashboard-page" aria-labelledby="dashboard-title">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">ZPay Merchant</p>
          <h1 id="dashboard-title">Overview</h1>
        </div>
        {balance ? (
          <p className="sync-timestamp">Last synced: {formattedTimestamp(balance.synced_at)}</p>
        ) : null}
      </div>

      {online && offline ? <ErrorState>Offline: showing the most recently available values.</ErrorState> : null}
      {online && !offline && retainedError ? <ErrorState>Some dashboard data could not be refreshed. Showing the most recently available values.</ErrorState> : null}
      {online && !offline && !retainedError && stale ? <ErrorState>Wallet information may be out of date.</ErrorState> : null}

      <section aria-labelledby="wallet-summary-title">
        <div className="section-heading">
          <h2 id="wallet-summary-title">Wallet summary</h2>
          {balance?.settlement_enabled === false ? <span className="status-badge">Settlement disabled</span> : null}
        </div>
        {balanceQuery.isLoading && !balance ? (
          <LoadingSkeleton label="Loading wallet balance" className="balance-skeleton" />
        ) : null}
        {balanceQuery.isError && !balance ? (
          <ErrorState error={balanceQuery.error}>
            <p>Unable to load wallet balance.</p>
            <button type="button" disabled={cooldown > 0 || !online} onClick={() => void balanceQuery.refetch()}>Retry wallet balance</button>
          </ErrorState>
        ) : null}
        {balance ? (
          <dl className="balance-grid">
            {balanceItems.map(({ key, label, description }) => (
              <div key={key} className="balance-card">
                <dt>
                  <span>{label}</span>
                  {description ? <span className="balance-context">{description}</span> : null}
                </dt>
                <dd>{amountLabel(balance[key])}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </section>

      <section className="recent-section" aria-labelledby="recent-payments-title">
        <div className="section-heading">
          <h2 id="recent-payments-title">Recent payment requests</h2>
          <Link to="/payments">View all payments</Link>
        </div>
        {paymentsQuery.isLoading ? <LoadingSkeleton label="Loading recent payments" /> : null}
        {paymentsQuery.isError ? <ErrorState error={paymentsQuery.error}>
          <p>Unable to refresh recent payments. Retained requests may be out of date.</p>
          <button type="button" disabled={cooldown > 0 || !online} onClick={() => void paymentsQuery.refetch()}>Retry recent payments</button>
        </ErrorState> : null}
        {paymentsQuery.data?.results.length === 0 ? <p>No payment requests yet. Open Payments to create one.</p> : null}
        {paymentsQuery.data && paymentsQuery.data.results.length > 0 ? <ul className="payment-list">
          {paymentsQuery.data.results.slice(0, 5).map((payment) => <PaymentCard key={payment.id} payment={payment} />)}
        </ul> : null}
      </section>

      <section className="recent-section" aria-labelledby="recent-outputs-title">
        <div className="section-heading">
          <h2 id="recent-outputs-title">Recent received outputs</h2>
          <Link to="/transactions">View all transactions</Link>
        </div>
        {transactionsQuery.isLoading && !transactions ? (
          <LoadingSkeleton label="Loading recent outputs" className="recent-skeleton" />
        ) : null}
        {transactionsQuery.isError && !transactions ? (
          <ErrorState error={transactionsQuery.error}>
            <p>Unable to load recent outputs.</p>
            <button type="button" disabled={cooldown > 0 || !online} onClick={() => void transactionsQuery.refetch()}>Retry recent outputs</button>
          </ErrorState>
        ) : null}
        {transactions?.results.length === 0 ? (
          <div className="empty-state">
            <p>No received outputs yet.</p>
            <Link className="button-link" to="/payments">Create payment request</Link>
          </div>
        ) : null}
        {transactions && transactions.results.length > 0 ? (
          <ul className="recent-outputs">
            {transactions.results.slice(0, 5).map((output) => <RecentOutput key={output.id} output={output} />)}
          </ul>
        ) : null}
      </section>
    </section>
  );
}
