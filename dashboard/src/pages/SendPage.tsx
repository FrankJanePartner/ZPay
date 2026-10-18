
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";

import { ApiError } from "../api/client";
import { getWalletBalance, sendZec } from "../api/queries";
import type { WalletBalance } from "../api/types";
import { useFinancialRefresh } from "../api/liveState";
import { formatZec } from "../components/Money";

const MAX_ZATOSHIS = 2_100_000_000_000_000n;
const ZATOSHIS_PER_ZEC = 100_000_000n;
const INTEGER_AMOUNT_PATTERN = /^[1-9][0-9]{0,15}$/;

function zecToZatoshis(value: string): string | null {
  const normalized = value.trim();

  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,8})?$/.test(normalized)) {
    return null;
  }

  const [whole, fraction = ""] = normalized.split(".");
  const wholePart = BigInt(whole);
  const fractionPart = BigInt((fraction + "00000000").slice(0, 8));
  const amount = wholePart * ZATOSHIS_PER_ZEC + fractionPart;

  if (amount < 1n || amount > MAX_ZATOSHIS) {
    return null;
  }

  return amount.toString();
}

function randomIdempotencyKey(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `send-${crypto.randomUUID()}`;
  }

  return `send-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function shortTxid(txid: string): string {
  return txid.length <= 24
    ? txid
    : `${txid.slice(0, 12)}…${txid.slice(-8)}`;
}

function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

function isUncertainOutcome(error: unknown): boolean {
  if (!(error instanceof ApiError)) {
    return true;
  }

  if (error.status === 503 || error.status === 0) {
    return true;
  }

  if (error.status === 409) {
    return error.detail.toLowerCase().includes("uncertain");
  }

  return error.status >= 500;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 422) {
      return (
        error.detail ||
        "Insufficient ZEC balance to cover the transfer amount and network fee."
      );
    }

    if (error.status === 409) {
      if (isUncertainOutcome(error)) {
        return (
          "This transaction's outcome is uncertain. " +
          "Check transaction history and contact support before attempting another send."
        );
      }

      return (
        error.detail ||
        "This send request conflicts with an existing request. Review the transaction before proceeding."
      );
    }

    if (error.status === 503 || error.status === 0) {
      return (
        "The transaction outcome could not be confirmed. " +
        "Do not send again until you have checked transaction history and confirmed what happened."
      );
    }

    if (error.status === 429) {
      return error.retryAfterSeconds
        ? `Too many requests. Please wait ${error.retryAfterSeconds} seconds.`
        : "Too many requests. Please try again shortly.";
    }

    if (error.status >= 500) {
      return (
        "The transaction outcome could not be confirmed. " +
        "Check transaction history before attempting another send."
      );
    }

    return error.detail || "Unable to send ZEC.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return (
    "The transaction outcome could not be confirmed. " +
    "Check transaction history before attempting another send."
  );
}

export function SendPage() {
  const refresh = useFinancialRefresh();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<
    Awaited<ReturnType<typeof sendZec>> | null
  >(null);
  const [confirmed, setConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [outcomeUncertain, setOutcomeUncertain] = useState(false);

  const balanceQuery = useQuery({
    ...refresh,
    queryKey: ["wallet-balance"],
    queryFn: ({ signal }) => getWalletBalance(signal),
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const amountZatoshis = zecToZatoshis(amount);

      if (!amountZatoshis) {
        throw new Error("Enter a valid ZEC amount.");
      }

      if (!idempotencyKey) {
        throw new Error("Send request is not ready. Review the transaction again.");
      }

      return sendZec(
        {
          recipient_address: recipient.trim(),
          amount_zatoshis: amountZatoshis,
          ...(memo.trim() ? { memo: memo.trim() } : {}),
        },
        idempotencyKey,
      );
    },
    onSuccess: (sendResult) => {
      setResult(sendResult);
      setConfirmed(false);
      setOutcomeUncertain(false);
    },
    onError: (error) => {
      if (isUncertainOutcome(error)) {
        setOutcomeUncertain(true);
      }
    },
  });

  const balance: WalletBalance | undefined = balanceQuery.data;
  const spendable = balance?.spendable_zatoshis ?? null;
  const amountZatoshis = zecToZatoshis(amount);

  const amountExceedsBalance =
    amountZatoshis !== null &&
    spendable !== null &&
    BigInt(amountZatoshis) > BigInt(spendable);

  const amountUsesFullBalance =
    amountZatoshis !== null &&
    spendable !== null &&
    BigInt(amountZatoshis) === BigInt(spendable);

  const memoBytes = new TextEncoder().encode(memo).length;

  function validate(): boolean {
    if (outcomeUncertain) {
      setValidationError(
        "This transaction's outcome is uncertain. Check transaction history before attempting another send.",
      );
      return false;
    }

    if (!recipient.trim()) {
      setValidationError("Recipient address is required.");
      return false;
    }

    if (!amountZatoshis || !INTEGER_AMOUNT_PATTERN.test(amountZatoshis)) {
      setValidationError(
        "Enter a valid ZEC amount with up to 8 decimal places.",
      );
      return false;
    }

    if (memoBytes > 512) {
      setValidationError("Memo must not exceed 512 UTF-8 bytes.");
      return false;
    }

    if (amountExceedsBalance) {
      setValidationError(
        "The amount exceeds your current spendable balance.",
      );
      return false;
    }

    if (amountUsesFullBalance) {
      setValidationError(
        "You cannot send your entire spendable balance because a network fee is also required. Reduce the amount.",
      );
      return false;
    }

    setValidationError(null);
    return true;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validate()) {
      return;
    }

    sendMutation.reset();
    setResult(null);
    setIdempotencyKey(randomIdempotencyKey());
    setConfirmed(true);
  }

  function confirmSend() {
    if (
      sendMutation.isPending ||
      outcomeUncertain ||
      !idempotencyKey ||
      !validate()
    ) {
      return;
    }

    sendMutation.mutate();
  }

  function handleFieldChange() {
    setValidationError(null);

    if (!outcomeUncertain) {
      setIdempotencyKey(null);
      sendMutation.reset();
    }
  }

  function resetForm() {
    if (outcomeUncertain) {
      return;
    }

    sendMutation.reset();
    setResult(null);
    setConfirmed(false);
    setValidationError(null);
    setIdempotencyKey(null);
  }

  return (
    <section className="send-page" aria-labelledby="send-title">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">ZOERDWALLET Merchant</p>
          <h1 id="send-title">Send ZEC</h1>
        </div>
      </div>

      <section className="send-panel">
        <div className="send-balance">
          <span>Spendable balance</span>
          <strong>
            {spendable === null
              ? "Not synced"
              : `${formatZec(spendable)} ZEC`}
          </strong>
        </div>

        {isOffline(balanceQuery.error) ? (
          <p className="form-error">
            Wallet balance is currently offline.
          </p>
        ) : null}

        {balanceQuery.isError && !isOffline(balanceQuery.error) ? (
          <p className="form-error">
            Unable to load the current wallet balance.
          </p>
        ) : null}

        {!result ? (
          <form className="send-form" onSubmit={submit}>
            <label htmlFor="send-recipient">
              Recipient Zcash address
            </label>
            <input
              id="send-recipient"
              value={recipient}
              required
              maxLength={1024}
              autoComplete="off"
              spellCheck={false}
              placeholder="Enter the recipient's Zcash address"
              disabled={sendMutation.isPending || outcomeUncertain}
              onChange={(event) => {
                setRecipient(event.target.value);
                handleFieldChange();
              }}
            />

            <label htmlFor="send-amount">Amount (ZEC)</label>
            <input
              id="send-amount"
              value={amount}
              required
              inputMode="decimal"
              placeholder="0.00010000"
              disabled={sendMutation.isPending || outcomeUncertain}
              onChange={(event) => {
                setAmount(event.target.value);
                handleFieldChange();
              }}
            />

            <label htmlFor="send-memo">
              Memo / Message (optional)
            </label>
            <textarea
              id="send-memo"
              value={memo}
              maxLength={512}
              rows={3}
              placeholder="Optional message to include with the Zcash transaction"
              disabled={sendMutation.isPending || outcomeUncertain}
              onChange={(event) => {
                setMemo(event.target.value);
                handleFieldChange();
              }}
            />

            <p className="field-hint">
              {memoBytes}/512 bytes
            </p>

            {amountZatoshis ? (
              <p className="field-hint">
                {amountZatoshis} zatoshis
              </p>
            ) : null}

            <p className="field-hint">
              Zcash network fees are charged in addition to the
              transfer amount. The final fee is determined by the
              wallet when preparing the transaction.
            </p>

            {amountExceedsBalance ? (
              <p className="field-error">
                Amount exceeds the current spendable balance.
              </p>
            ) : null}

            {amountUsesFullBalance ? (
              <p className="field-error">
                Reduce the amount to leave enough ZEC for the network fee.
              </p>
            ) : null}

            {validationError ? (
              <p className="form-error" role="alert">
                {validationError}
              </p>
            ) : null}

            {sendMutation.isError ? (
              <p className="form-error" role="alert">
                {errorMessage(sendMutation.error)}
              </p>
            ) : null}

            {outcomeUncertain ? (
              <p className="audit-note" role="alert">
                Sending is paused for this request because its
                outcome could not be confirmed. Check transaction
                history and contact support before attempting
                another transfer.
              </p>
            ) : null}

            {!confirmed && !outcomeUncertain ? (
              <button
                type="submit"
                disabled={
                  sendMutation.isPending ||
                  balanceQuery.isLoading ||
                  spendable === null
                }
              >
                Review send
              </button>
            ) : null}
          </form>
        ) : null}

        {confirmed && !result ? (
          <div className="send-confirmation" role="alert">
            <h2>Confirm transaction</h2>

            <dl className="send-summary">
              <div>
                <dt>Recipient</dt>
                <dd>{recipient.trim()}</dd>
              </div>

              <div>
                <dt>Amount</dt>
                <dd>{amount} ZEC</dd>
              </div>

              <div>
                <dt>Amount in zatoshis</dt>
                <dd>{amountZatoshis}</dd>
              </div>

              <div>
                <dt>Network fee</dt>
                <dd>
                  Additional fee, determined by the wallet
                </dd>
              </div>

              {memo.trim() ? (
                <div>
                  <dt>Memo / Message</dt>
                  <dd>{memo.trim()}</dd>
                </div>
              ) : null}
            </dl>

            <p className="audit-note">
              Sending ZEC broadcasts a transaction to the Zcash
              network. Check the recipient address and amount
              carefully before confirming. Your balance must
              cover both the transfer amount and network fee.
            </p>

            {sendMutation.isError ? (
              <p className="form-error" role="alert">
                {errorMessage(sendMutation.error)}
              </p>
            ) : null}

            {outcomeUncertain ? (
              <p className="audit-note" role="alert">
                The outcome of this send could not be confirmed.
                Do not submit another transaction until you
                have checked its status.
              </p>
            ) : null}

            {validationError ? (
              <p className="form-error" role="alert">
                {validationError}
              </p>
            ) : null}

            {!outcomeUncertain ? (
              <div className="send-actions">
                <button
                  type="button"
                  onClick={confirmSend}
                  disabled={
                    sendMutation.isPending ||
                    sendMutation.isError
                  }
                >
                  {sendMutation.isPending
                    ? "Sending ZEC…"
                    : "Confirm & Send"}
                </button>

                <button
                  type="button"
                  className="button-secondary"
                  onClick={() => {
                    sendMutation.reset();
                    setConfirmed(false);
                    setIdempotencyKey(null);
                  }}
                  disabled={sendMutation.isPending}
                >
                  Edit
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {result ? (
          <div className="send-result" role="status">
            <h2>
              {result.status === "broadcast"
                ? "Transaction broadcast"
                : "Send request"}
            </h2>

            <p>
              {result.status === "broadcast"
                ? "The transaction was accepted for broadcast."
                : `Status: ${result.status}`}
            </p>

            {result.txids.map((txid) => (
              <div className="send-txid" key={txid}>
                <span title={txid}>
                  Transaction {shortTxid(txid)}
                </span>
                <code>{txid}</code>
              </div>
            ))}

            {result.error ? (
              <p className="form-error">
                {result.error}
              </p>
            ) : null}

            <button type="button" onClick={resetForm}>
              Send another transaction
            </button>
          </div>
        ) : null}
      </section>
    </section>
  );
}
