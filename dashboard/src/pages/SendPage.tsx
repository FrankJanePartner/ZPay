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
  return txid.length <= 24 ? txid : `${txid.slice(0, 12)}…${txid.slice(-8)}`;
}

function isOffline(error: unknown): boolean {
  return error instanceof ApiError && error.status === 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return "This send request conflicts with an existing idempotency key. Please start again.";
    }

    if (error.status === 503) {
      return "The wallet service is temporarily unavailable. No new request should be created. You can safely retry.";
    }

    if (error.status === 429) {
      return error.retryAfterSeconds
        ? `Too many requests. Please wait ${error.retryAfterSeconds} seconds.`
        : "Too many requests. Please try again shortly.";
    }

    return error.detail;
  }

  return "Unable to send ZEC. Please try again.";
}

export function SendPage() {
  const refresh = useFinancialRefresh();
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [result, setResult] = useState<Awaited<ReturnType<typeof sendZec>> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

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

      const key = idempotencyKey ?? randomIdempotencyKey();

      if (!idempotencyKey) {
        setIdempotencyKey(key);
      }

      return sendZec(
        {
          recipient_address: recipient.trim(),
          amount_zatoshis: amountZatoshis,
        },
        key,
      );
    },
    onSuccess: (sendResult) => {
      setResult(sendResult);
      setConfirmed(false);
    },
  });

  const balance: WalletBalance | undefined = balanceQuery.data;
  const spendable = balance?.spendable_zatoshis ?? null;
  const amountZatoshis = zecToZatoshis(amount);
  const amountExceedsBalance =
    amountZatoshis !== null &&
    spendable !== null &&
    BigInt(amountZatoshis) > BigInt(spendable);

  function validate(): boolean {
    const trimmedRecipient = recipient.trim();

    if (!trimmedRecipient) {
      setValidationError("Recipient address is required.");
      return false;
    }

    if (!amountZatoshis || !INTEGER_AMOUNT_PATTERN.test(amountZatoshis)) {
      setValidationError("Enter a valid ZEC amount with up to 8 decimal places.");
      return false;
    }

    if (amountExceedsBalance) {
      setValidationError("The amount exceeds your current spendable balance.");
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

    setResult(null);
    setIdempotencyKey(randomIdempotencyKey());
    setConfirmed(true);
  }

  function confirmSend() {
    if (sendMutation.isPending || !validate()) {
      return;
    }

    sendMutation.mutate();
  }

  function resetForm() {
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
          <p className="eyebrow">ZPay Merchant</p>
          <h1 id="send-title">Send ZEC</h1>
        </div>
      </div>

      <section className="send-panel">
        <div className="send-balance">
          <span>Spendable balance</span>
          <strong>
            {spendable === null ? "Not synced" : `${formatZec(spendable)} ZEC`}
          </strong>
        </div>

        {isOffline(balanceQuery.error) ? (
          <p className="form-error">Wallet balance is currently offline.</p>
        ) : null}

        {balanceQuery.isError && !isOffline(balanceQuery.error) ? (
          <p className="form-error">Unable to load the current wallet balance.</p>
        ) : null}

        {!result ? (
          <form className="send-form" onSubmit={submit}>
            <label htmlFor="send-recipient">Recipient Zcash address</label>
            <input
              id="send-recipient"
              value={recipient}
              required
              maxLength={1024}
              autoComplete="off"
              spellCheck={false}
              placeholder="Enter the recipient's Zcash address"
              disabled={sendMutation.isPending}
              onChange={(event) => {
                setRecipient(event.target.value);
                setValidationError(null);
                setIdempotencyKey(null);
                sendMutation.reset();
              }}
            />

            <label htmlFor="send-amount">Amount (ZEC)</label>
            <input
              id="send-amount"
              value={amount}
              required
              inputMode="decimal"
              placeholder="0.00010000"
              disabled={sendMutation.isPending}
              onChange={(event) => {
                setAmount(event.target.value);
                setValidationError(null);
                setIdempotencyKey(null);
                sendMutation.reset();
              }}
            />

            {amountZatoshis ? (
              <p className="field-hint">
                {amountZatoshis} zatoshis
              </p>
            ) : null}

            {amountExceedsBalance ? (
              <p className="field-error">
                Amount exceeds the current spendable balance.
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
            </dl>

            <p className="audit-note">
              Sending ZEC broadcasts a transaction to the Zcash network. Check the
              recipient address carefully before confirming.
            </p>

            <div className="send-actions">
              <button
                type="button"
                onClick={confirmSend}
                disabled={sendMutation.isPending}
              >
                {sendMutation.isPending ? "Sending ZEC…" : "Confirm & Send"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => setConfirmed(false)}
                disabled={sendMutation.isPending}
              >
                Edit
              </button>
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="send-result" role="status">
            <h2>
              {result.status === "broadcast" ? "Transaction broadcast" : "Send request"}
            </h2>

            <p>
              {result.status === "broadcast"
                ? "The transaction was accepted for broadcast."
                : `Status: ${result.status}`}
            </p>

            {result.txids.map((txid) => (
              <div className="send-txid" key={txid}>
                <span title={txid}>Transaction {shortTxid(txid)}</span>
                <code>{txid}</code>
              </div>
            ))}

            {result.error ? (
              <p className="form-error">{result.error}</p>
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
