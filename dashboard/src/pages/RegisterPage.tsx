import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useApiCooldown } from "../api/liveState";
import { useAuth } from "../auth/AuthProvider";
import { register as requestRegister } from "../api/queries";

export function RegisterPage() {
  const cooldown = useApiCooldown();
  const { adoptSession } = useAuth();
  const [issuedLoginKey, setIssuedLoginKey] = useState<string | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const operation = useRef<AbortController | null>(null);

  useEffect(() => () => {
    operation.current?.abort();
    operation.current = null;
  }, []);

  async function copySecret() {
    if (!issuedLoginKey) return;
    try {
      await navigator.clipboard.writeText(issuedLoginKey);
      setCopyState("copied");
    } catch {
      setCopyState("error");
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (cooldown > 0 || pending) return;
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    setPending(true);
    setError(null);

    try {
      const result = await requestRegister({ login_key: "" }, controller.signal);
      if (!result.login_key) throw new Error("Registration did not return a login secret.");
      setIssuedLoginKey(result.login_key);
      setPendingToken(result.token);
      setSaved(false);
      setCopyState("idle");
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(caught instanceof ApiError
        ? caught
        : new ApiError({ status: 0, detail: "Unable to create your account. Please try again." }));
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        setPending(false);
      }
    }
  }

  return (
    <main className="auth-layout">
      <section className="auth-card auth-card-register" aria-labelledby="register-title">
        <div className="auth-brand-mark" aria-hidden="true">Z</div>
        <p className="eyebrow">ZOERDWALLET / MERCHANT ACCESS</p>
        <h1 id="register-title">{issuedLoginKey ? "Secure your account" : "Create your account"}</h1>
        <p className="auth-lead">{issuedLoginKey
          ? "Your account is ready. Save the private login secret below before continuing."
          : "No email, name, or password. Your account starts with one private login secret."}</p>

        {issuedLoginKey ? (
          <section className="secret-section" aria-label="Your new login secret">
            <div className="secret-heading">
              <span className="secret-step">01 / YOUR PRIVATE ACCESS</span>
              <span className="secret-once">Shown once</span>
            </div>
            <h2>Save your login secret</h2>
            <p className="secret-help">This is your key to signing in. Store it in a trusted password manager or another secure place.</p>
            <div className="secret-value-wrap">
              <textarea
                className="secret-value"
                readOnly
                rows={3}
                value={issuedLoginKey}
                aria-label="One-time login secret"
                spellCheck={false}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button className="secret-copy-button" type="button" onClick={() => void copySecret()}>
                {copyState === "copied" ? "✓ Copied!" : "Copy secret"}
              </button>
            </div>
            <div className="secret-copy-feedback" role="status" aria-live="polite">
              {copyState === "copied" ? <span className="secret-feedback-success">✓ Secret copied to clipboard</span> : null}
              {copyState === "error" ? <span className="form-error">Could not copy automatically. Select the secret above and copy it manually.</span> : null}
            </div>
            <div className="secret-warning">
              <strong>Keep it private.</strong> We cannot show this secret again. Without a verified recovery email, losing it may mean losing access to this account.
            </div>
            <label className="secret-confirm">
              <input type="checkbox" checked={saved} onChange={(event) => setSaved(event.target.checked)} />
              <span>I have securely saved my login secret.</span>
            </label>
            <button
              className="auth-primary-action"
              type="button"
              disabled={!saved || !pendingToken}
              onClick={() => {
                if (pendingToken) {
                  adoptSession(pendingToken);
                  navigate("/dashboard");
                }
              }}
            >
              Continue to dashboard <span aria-hidden="true">→</span>
            </button>
          </section>
        ) : (
          <form onSubmit={handleSubmit} className="auth-register-form">
            <div className="secret-warning">
              <strong>Before you begin</strong>
              <span>Your login secret will be shown only once. Save it securely to avoid losing access.</span>
            </div>
            {error ? <p role="alert" className="form-error">{error.detail}</p> : null}
            {cooldown > 0 ? <p role="status">Request throttled; retry in {cooldown} seconds.</p> : null}
            <button className="auth-primary-action" type="submit" disabled={pending || cooldown > 0}>
              {pending ? "Creating account…" : "Create account →"}
            </button>
          </form>
        )}
        <p className="auth-footer">Already registered? <Link to="/login">Sign in</Link></p>
      </section>
    </main>
  );
}
