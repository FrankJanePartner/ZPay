import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useApiCooldown } from "../api/liveState";
import type { ApiErrorFields } from "../api/types";
import { useAuth } from "../auth/AuthProvider";

function fieldMessage(fields: ApiErrorFields | undefined, name: string): string | undefined {
  const value = fields?.[name];
  return Array.isArray(value) ? value.join(" ") : value;
}

export function RegisterPage() {
  const cooldown = useApiCooldown();
  const { register, issuedLoginKey, clearIssuedLoginKey } = useAuth();
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
      const authenticated = await register(
        {
          login_key: "",
        },
        controller.signal,
      );
      if (!authenticated) {
        return;
      }
      // Keep the secret visible until the merchant explicitly confirms saving it.
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
        {issuedLoginKey ? <section aria-label="Your new login secret"><h2>Save your login secret</h2><textarea readOnly rows={3} value={issuedLoginKey} aria-label="One-time login secret" /><button type="button" onClick={() => navigator.clipboard.writeText(issuedLoginKey)}>Copy secret</button><p>We cannot display this secret again. Store it in a password manager.</p><button type="button" onClick={() => { clearIssuedLoginKey(); navigate("/dashboard"); }}>I have saved my secret</button></section> : <form onSubmit={handleSubmit}>
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
