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
  const emailError = fieldMessage(error?.fields, "email");
  const passwordError = fieldMessage(error?.fields, "password");

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
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
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
        <p className="eyebrow">ZPay Merchant</p>
        <h1 id="login-title">Sign in</h1>
        <p>Access payments, receipts, and API credentials.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="login-email">Email</label>
          <input
            id="login-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "login-email-error" : undefined}
          />
          {emailError ? <p id="login-email-error" className="field-error">{emailError}</p> : null}

          <label htmlFor="login-password">Password</label>
          <input
            id="login-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? "login-password-error" : undefined}
          />
          {passwordError ? <p id="login-password-error" className="field-error">{passwordError}</p> : null}

          {error ? <p role="alert" className="form-error">{error.detail}</p> : null}
          {cooldown > 0 ? <p role="status">Request throttled; retry in {cooldown} seconds.</p> : null}
          <button type="submit" disabled={pending || cooldown > 0}>
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>
        <p>
          New to ZPay? <Link to="/register">Create an account</Link>
        </p>
      </section>
    </main>
  );
}
