import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../api/client";
import { useApiCooldown, useFinancialRefresh } from "../api/liveState";
import { getTransactions } from "../api/queries";
import type { DepositOutput } from "../api/types";
import { ErrorState, LoadingSkeleton } from "../components/AsyncState";
import { CopyButton } from "../components/CopyButton";
import { formatZec } from "../components/Money";

function formatTimestamp(timestamp: string): string {
  if (Number.isNaN(Date.parse(timestamp))) {
    return "Not available";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(timestamp),
  );
}

function shortTransactionId(txid: string): string {
  return txid.length <= 20 ? txid : `${txid.slice(0, 12)}…${txid.slice(-8)}`;
}

function confirmationLabel(confirmations: number): string {
  return `${confirmations} ${confirmations === 1 ? "confirmation" : "confirmations"}`;
}

function TransactionRow({ output }: { output: DepositOutput }) {
  return (
    <tr>
      <td data-label="Amount">
        <strong>{formatZec(output.amount_zatoshis)} ZEC</strong>
        <span className="transaction-subvalue">{formatTimestamp(output.block_time)}</span>
      </td>
      <td data-label="Location">
        <span>Pool {output.pool}</span>
        <span className="transaction-subvalue">Output {output.output_index}</span>
      </td>
      <td data-label="Transaction">
        <code title={output.txid}>{shortTransactionId(output.txid)}</code>
        <CopyButton label="transaction ID" value={output.txid} />
      </td>
      <td data-label="Status">
        <span className={`status-badge output-status-${output.status}`}>
          {output.status === "confirmed" ? "Confirmed" : "Reversed"}
        </span>
        <span className="transaction-subvalue">{confirmationLabel(output.confirmations)}</span>
        {output.late === true ? <span className="transaction-flag">Late payment</span> : null}
      </td>
      <td data-label="Payment request">
        {output.payment_request ? (
          <Link
            className="transaction-payment-link"
            to={`/payments/${output.payment_request}`}
            aria-label="View linked payment request"
          >
            View request
          </Link>
        ) : (
          <span className="transaction-flag">Unmatched output</span>
        )}
      </td>
    </tr>
  );
}

export function TransactionsPage() {
  const refresh = useFinancialRefresh();
  const cooldown = useApiCooldown();
  const firstPageUrl = "/api/v1/transactions/";
  const [pageUrl, setPageUrl] = useState(firstPageUrl);
  const [pageHistory, setPageHistory] = useState<string[]>([]);
  const transactionsQuery = useQuery({
    ...refresh,
    queryKey: ["transactions", pageUrl],
    queryFn: ({ signal }) => getTransactions(pageUrl, signal),
  });
  const page = transactionsQuery.data;
  const error = transactionsQuery.error instanceof ApiError ? transactionsQuery.error.detail : null;

  function navigateToPage(nextPageUrl: string) {
    setPageHistory((history) => [...history, pageUrl]);
    setPageUrl(nextPageUrl);
  }

  function returnToPreviousPage() {
    const previousPageUrl = pageHistory[pageHistory.length - 1];
    if (!previousPageUrl) return;
    setPageHistory((history) => history.slice(0, -1));
    setPageUrl(previousPageUrl);
  }

  function returnToFirstPage() {
    setPageHistory([]);
    setPageUrl(firstPageUrl);
  }

  return (
    <section className="transactions-page" aria-labelledby="transactions-title">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">ZPay Merchant</p>
          <h1 id="transactions-title">Transactions</h1>
        </div>
      </div>

      <p className="audit-note">
        Reversed outputs remain visible for audit and are excluded from active received totals.
      </p>

      {transactionsQuery.isLoading ? (
        <LoadingSkeleton label="Loading transactions" className="transactions-skeleton" />
      ) : null}
      {transactionsQuery.isError ? (
        <ErrorState error={transactionsQuery.error}>
          <p>{error ?? "Unable to load received outputs."}</p>
          {page ? <p>Showing the last available outputs; confirmations may be out of date.</p> : null}
          <div className="error-actions">
            <button
              type="button"
              disabled={transactionsQuery.isFetching || cooldown > 0}
              onClick={() => void transactionsQuery.refetch()}
            >
              Retry page
            </button>
            {pageHistory.length > 0 ? (
              <button type="button" className="button-secondary" onClick={returnToPreviousPage}>
                Back to previous page
              </button>
            ) : null}
            {pageUrl !== firstPageUrl ? (
              <button type="button" className="button-secondary" onClick={returnToFirstPage}>
                Back to first page
              </button>
            ) : null}
          </div>
        </ErrorState>
      ) : null}
      {page?.results.length === 0 ? (
        <div className="empty-state transaction-empty-state">
          <p>No received outputs yet.</p>
          <Link className="button-link" to="/payments">Create payment request</Link>
        </div>
      ) : null}
      {page && page.results.length > 0 ? (
        <div className="transactions-table-wrap">
          <table className="transactions-table">
            <thead>
              <tr>
                <th scope="col">Amount and block time</th>
                <th scope="col">Pool and output</th>
                <th scope="col">Transaction ID</th>
                <th scope="col">Status</th>
                <th scope="col">Payment request</th>
              </tr>
            </thead>
            <tbody>
              {page.results.map((output) => <TransactionRow key={output.id} output={output} />)}
            </tbody>
          </table>
        </div>
      ) : null}
      {page && (page.previous || page.next) ? (
        <nav className="pagination-actions" aria-label="Transaction pages">
          <button
            type="button"
            className="button-secondary"
            disabled={!page.previous || transactionsQuery.isFetching}
            onClick={() => page.previous && navigateToPage(page.previous)}
          >
            Previous page
          </button>
          <button
            type="button"
            className="button-secondary"
            disabled={!page.next || transactionsQuery.isFetching}
            onClick={() => page.next && navigateToPage(page.next)}
          >
            Next page
          </button>
        </nav>
      ) : null}
    </section>
  );
}
