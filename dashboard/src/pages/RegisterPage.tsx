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
  const { register } = useAuth();
  const navigate = useNavigate();
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
      const authenticated = await register(
        {
          email: String(form.get("email") ?? ""),
          password: String(form.get("password") ?? ""),
        },
        controller.signal,
      );
      if (!authenticated) {
        return;
      }
      navigate("/dashboard", { replace: true });
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
        <p className="eyebrow">ZPay Merchant</p>
        <h1 id="register-title">Create account</h1>
        <p>Use a strong password with at least 12 characters.</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="register-email">Email</label>
          <input
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            required
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "register-email-error" : undefined}
          />
          {emailError ? <p id="register-email-error" className="field-error">{emailError}</p> : null}

          <label htmlFor="register-password">Password</label>
          <input
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
            aria-invalid={passwordError ? true : undefined}
            aria-describedby={passwordError ? "register-password-error" : undefined}
          />
          {passwordError ? <p id="register-password-error" className="field-error">{passwordError}</p> : null}

          {error ? <p role="alert" className="form-error">{error.detail}</p> : null}
          {cooldown > 0 ? <p role="status">Request throttled; retry in {cooldown} seconds.</p> : null}
          <button type="submit" disabled={pending || cooldown > 0}>
            {pending ? "Creating account…" : "Create account"}
          </button>
        </form>
        <p>
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
