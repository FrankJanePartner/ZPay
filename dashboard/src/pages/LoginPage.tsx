import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useApiCooldown } from "../api/liveState";
import type { ApiErrorFields } from "../api/types";
import { useAuth } from "../auth/AuthProvider";

function fieldMessage(fields: ApiErrorFields | undefined, name: string): string | undefined {
  const value = fields?.[name];
  return Array.isArray(value) ? value.join(" ") : value;
}

export function LoginPage() {
  const cooldown = useApiCooldown();
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const operation = useRef<AbortController | null>(null);
  const keyError = fieldMessage(error?.fields, "login_key");

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
      const authenticated = await login(
        {
          login_key: String(form.get("login_key") ?? ""),
        },
        controller.signal,
      );
      if (!authenticated) {
        return;
      }
      const state = location.state as {
        from?: { pathname?: string; search?: string; hash?: string };
      } | null;
      const from = state?.from;
      navigate(
        from
          ? {
              pathname: from.pathname ?? "/dashboard",
              search: from.search ?? "",
              hash: from.hash ?? "",
            }
          : "/dashboard",
        { replace: true },
      );
    } catch (caught) {
      if (controller.signal.aborted) {
        return;
      }
      setError(
        caught instanceof ApiError
          ? caught
          : new ApiError({ status: 0, detail: "Unable to sign in. Please try again." }),
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
      <section className="auth-card" aria-labelledby="login-title">
        <p className="eyebrow">ZOERDWALLET Merchant</p>
        <h1 id="login-title">Sign in</h1>
        <p>Access your private merchant dashboard with your unique login secret.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="login-key">Merchant login secret</label>
          <input id="login-key" name="login_key" type="password" autoComplete="off" required
            aria-invalid={keyError ? true : undefined} />
          {keyError ? <p className="field-error">{keyError}</p> : null}
          <p>Keep your secret safe. Without a verified recovery email, losing it may permanently lock you out.</p>

          {error ? <p role="alert" className="form-error">{error.detail}</p> : null}
          {cooldown > 0 ? <p role="status">Request throttled; retry in {cooldown} seconds.</p> : null}
          <button type="submit" disabled={pending || cooldown > 0}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p><Link to="/recover">Lost your login secret?</Link> · <Link to="/migrate">Migrate an existing email account</Link></p>
        <p>
          New to ZOERDWALLET? <Link to="/register">Create an account</Link>
        </p>
      </section>
    </main>
  );
}
