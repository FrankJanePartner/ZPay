import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useApiCooldown } from "../api/liveState";
import type { ApiErrorFields } from "../api/types";
import { useAuth } from "../auth/AuthProvider";
import { register as requestRegister } from "../api/queries";

function fieldMessage(fields: ApiErrorFields | undefined, name: string): string | undefined {
  const value = fields?.[name];
  return Array.isArray(value) ? value.join(" ") : value;
}

export function RegisterPage() {
  const cooldown = useApiCooldown();
  const { adoptSession } = useAuth();
  const [issuedLoginKey, setIssuedLoginKey] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const operation = useRef<AbortController | null>(null);


  useEffect(
    () => () => {
      operation.current?.abort();
      operation.current = null;
    },
    [],
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cooldown > 0 || pending) return;
    const form = new FormData(event.currentTarget);
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);

    try {
      const result = await requestRegister(
        {
          login_key: "",
        },
        controller.signal,
      );
      if (!result.login_key) throw new Error("Registration did not return a login secret.");
      setIssuedLoginKey(result.login_key);
      setPendingToken(result.token);
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, detail: "Unable to create your account. Please try again." }),
      );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setPending(false);
      }
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card" aria-labelledby="register-title">
        <p className="eyebrow">ZOERDWALLET Merchant</p>
        <h1 id="register-title">Create account</h1>
        <p>No email, name or password required. Your private login secret is generated automatically.</p>
        {issuedLoginKey ? <section aria-label="Your new login secret"><h2>Save your login secret</h2><textarea readOnly rows={3} value={issuedLoginKey} aria-label="One-time login secret" /><button type="button" onClick={() => navigator.clipboard.writeText(issuedLoginKey)}>Copy secret</button><p>We cannot display this secret again. Store it in a password manager.</p><label><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} /> I have saved my secret securely</label><button type="button" disabled={!saved || !pendingToken} onClick={() => { if (pendingToken) { adoptSession(pendingToken); navigate("/dashboard"); } }}>Continue to dashboard</button></section> : <form onSubmit={handleSubmit}>
          <p><strong>Important:</strong> Save your login secret offline. If you lose it without verifying a recovery email, your dashboard may be permanently inaccessible.</p>

          {error ? <p role="alert" className="form-error">{error.detail}</p> : null}
          {cooldown > 0 ? <p role="status">Request throttled; retry in {cooldown} seconds.</p> : null}
          <button type="submit" disabled={pending || cooldown > 0}>
            {pending ? "Creating account…" : "Create account"}
          </button>
        </form>}
        <p>
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
