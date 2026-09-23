import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { ApiError } from "../api/client";
import { useApiCooldown } from "../api/liveState";
import { createApiKey, getApiKeys, revokeApiKey } from "../api/queries";
import type { IssuedKey, KeyMetadata } from "../api/types";
import { session } from "../auth/session";
import { ErrorState, LoadingSkeleton } from "../components/AsyncState";
import { CopyButton } from "../components/CopyButton";
import { ModalDialog } from "../components/ModalDialog";

function formatTimestamp(timestamp: string): string {
  if (Number.isNaN(Date.parse(timestamp))) {
    return "Not available";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(timestamp),
  );
}

function errorDetail(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.detail : fallback;
}

interface ActiveOperation {
  controller: AbortController;
  token: string | null;
}

export function ApiKeysPage() {
  const cooldown = useApiCooldown();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [issuedKey, setIssuedKey] = useState<IssuedKey | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<KeyMetadata | null>(null);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState(false);
  const [mutationError, setMutationError] = useState<ApiError | null>(null);
  const mounted = useRef(false);
  const createOperation = useRef<ActiveOperation | null>(null);
  const revokeOperation = useRef<ActiveOperation | null>(null);
  const keyListTitle = useRef<HTMLHeadingElement>(null);
  const restoreKeyListFocus = useRef(false);

  const keysQuery = useQuery({
    queryKey: ["api-keys"],
    queryFn: ({ signal }) => getApiKeys(signal),
  });

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = session.subscribe((nextToken) => {
      for (const operation of [createOperation.current, revokeOperation.current]) {
        if (operation && operation.token !== nextToken) {
          operation.controller.abort();
        }
      }
      setIssuedKey(null);
      setRevokeTarget(null);
    });
    return () => {
      mounted.current = false;
      createOperation.current?.controller.abort();
      revokeOperation.current?.controller.abort();
      createOperation.current = null;
      revokeOperation.current = null;
      unsubscribe();
    };
  }, []);

  useLayoutEffect(() => {
    if (restoreKeyListFocus.current && !revokeTarget) {
      keyListTitle.current?.focus();
      restoreKeyListFocus.current = false;
    }
  }, [revokeTarget]);

  function isCurrent(ref: { current: ActiveOperation | null }, operation: ActiveOperation) {
    return (
      mounted.current &&
      ref.current === operation &&
      !operation.controller.signal.aborted &&
      session.getToken() === operation.token
    );
  }

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cooldown > 0 || pendingCreate) return;
    const normalizedName = name.trim();
    if (normalizedName.length < 1 || normalizedName.length > 80) {
      setNameError("Enter a key name between 1 and 80 characters.");
      return;
    }

    createOperation.current?.controller.abort();
    const operation = { controller: new AbortController(), token: session.getToken() };
    createOperation.current = operation;
    setNameError(null);
    setMutationError(null);
    setPendingCreate(true);
    try {
      const created = await createApiKey(normalizedName, operation.controller.signal);
      if (!isCurrent(createOperation, operation)) return;
      setIssuedKey(created);
      setName("");
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    } catch (error) {
      if (!operation.controller.signal.aborted && isCurrent(createOperation, operation)) {
        setMutationError(error instanceof ApiError
          ? error
          : new ApiError({ status: 0, detail: "Unable to create the API key." }));
      }
    } finally {
      if (createOperation.current === operation) {
        createOperation.current = null;
        if (mounted.current) setPendingCreate(false);
      }
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget || pendingRevoke || cooldown > 0) return;
    revokeOperation.current?.controller.abort();
    const operation = { controller: new AbortController(), token: session.getToken() };
    revokeOperation.current = operation;
    setMutationError(null);
    setPendingRevoke(true);
    try {
      await revokeApiKey(revokeTarget.id, operation.controller.signal);
      if (!isCurrent(revokeOperation, operation)) return;
      await queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      if (isCurrent(revokeOperation, operation)) {
        restoreKeyListFocus.current = true;
        setRevokeTarget(null);
      }
    } catch (error) {
      if (!operation.controller.signal.aborted && isCurrent(revokeOperation, operation)) {
        setMutationError(error instanceof ApiError
          ? error
          : new ApiError({ status: 0, detail: "Unable to revoke the API key." }));
      }
    } finally {
      if (revokeOperation.current === operation) {
        revokeOperation.current = null;
        if (mounted.current) setPendingRevoke(false);
      }
    }
  }

  const listError = keysQuery.error instanceof ApiError
    ? keysQuery.error.detail
    : "Unable to load API keys.";

  return (
    <section className="api-keys-page" aria-labelledby="api-keys-title">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">ZPay Merchant</p>
          <h1 id="api-keys-title">API Keys</h1>
        </div>
      </div>

      <section className="key-create-panel" aria-labelledby="create-key-title">
        <h2 id="create-key-title">Create API key</h2>
        <p>Use API keys for payment integrations. The secret is shown only once.</p>
        <form className="key-form" onSubmit={(event) => void handleCreate(event)} noValidate>
          <label htmlFor="key-name">Key name</label>
          <input
            id="key-name"
            value={name}
            disabled={pendingCreate}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? "key-name-error" : undefined}
            onChange={(event) => {
              setName(event.target.value);
              setNameError(null);
            }}
          />
          {nameError ? <p id="key-name-error" className="field-error">{nameError}</p> : null}
          <button type="submit" disabled={pendingCreate || cooldown > 0}>
            {pendingCreate ? "Creating…" : "Create API key"}
          </button>
        </form>
      </section>

      {mutationError && !revokeTarget ? (
        <ErrorState error={mutationError}>{errorDetail(mutationError, "Unable to update API keys.")}</ErrorState>
      ) : null}

      <section className="key-list-panel" aria-labelledby="key-list-title">
        <h2 id="key-list-title" ref={keyListTitle} tabIndex={-1}>Your API keys</h2>
        {keysQuery.isLoading ? (
          <LoadingSkeleton label="Loading API keys" className="keys-skeleton" />
        ) : null}
        {keysQuery.isError ? (
          <ErrorState error={keysQuery.error}>
            <p>{listError}</p>
            <button type="button" disabled={cooldown > 0} onClick={() => void keysQuery.refetch()}>Retry API keys</button>
          </ErrorState>
        ) : null}
        {keysQuery.data?.length === 0 ? (
          <div className="empty-state"><p>No API keys yet. Create one for your integration.</p></div>
        ) : null}
        {keysQuery.data && keysQuery.data.length > 0 ? (
          <ul className="key-list">
            {keysQuery.data.map((key) => (
              <li className="key-card" key={key.id}>
                <div className="key-card-heading">
                  <div>
                    <h3>{key.name}</h3>
                    <code>{key.prefix}</code>
                  </div>
                  <span className="status-badge">{key.revoked_at ? "Revoked" : "Active"}</span>
                </div>
                <dl className="key-metadata">
                  <div>
                    <dt>Created</dt>
                    <dd>{formatTimestamp(key.created_at)}</dd>
                  </div>
                  <div>
                    <dt>Revoked</dt>
                    <dd>{key.revoked_at ? formatTimestamp(key.revoked_at) : "Not revoked"}</dd>
                  </div>
                </dl>
                {!key.revoked_at ? (
                  <button
                    type="button"
                    className="button-secondary key-revoke-button"
                    aria-label={`Revoke ${key.name}`}
                    onClick={() => {
                      setMutationError(null);
                      setRevokeTarget(key);
                    }}
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {issuedKey ? (
        <ModalDialog labelledBy="issued-key-title" onDismiss={() => setIssuedKey(null)}>
            <h2 id="issued-key-title">Save your new API key</h2>
            <p>This secret cannot be retrieved again after you dismiss it.</p>
            <code className="issued-key-value">{issuedKey.key}</code>
            <div className="dialog-actions">
              <CopyButton label="API key" value={issuedKey.key} />
              <button type="button" onClick={() => setIssuedKey(null)}>Dismiss secret</button>
            </div>
        </ModalDialog>
      ) : null}

      {revokeTarget ? (
        <ModalDialog
          role="alertdialog"
          labelledBy="revoke-key-title"
          describedBy={mutationError && mutationError.status !== 403
            ? "revoke-key-description revoke-key-error"
            : "revoke-key-description"}
          dismissDisabled={pendingRevoke}
          fallbackFocusRef={keyListTitle}
          onDismiss={() => {
            setMutationError(null);
            setRevokeTarget(null);
          }}
        >
            <h2 id="revoke-key-title">Revoke API key?</h2>
            <p id="revoke-key-description">
              {revokeTarget.name} will stop authorizing new requests. This cannot be undone.
            </p>
            {mutationError ? (
              <ErrorState error={mutationError}>
                <p id="revoke-key-error">{errorDetail(mutationError, "Unable to revoke the API key.")}</p>
              </ErrorState>
            ) : null}
            <div className="dialog-actions">
              <button
                type="button"
                className="button-secondary"
                disabled={pendingRevoke}
                onClick={() => {
                  setMutationError(null);
                  setRevokeTarget(null);
                }}
              >
                Cancel
              </button>
              <button type="button" disabled={pendingRevoke || cooldown > 0} onClick={() => void confirmRevoke()}>
                {pendingRevoke ? "Revoking…" : "Confirm revoke"}
              </button>
            </div>
        </ModalDialog>
      ) : null}
    </section>
  );
}
