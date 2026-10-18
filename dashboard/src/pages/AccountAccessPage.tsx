import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError } from "../api/client";
import { completeRecovery, migrateLegacy, requestRecovery, setRecoveryEmail, verifyRecoveryEmail } from "../api/queries";
import { useAuth } from "../auth/AuthProvider";

export function AccountAccessPage({ mode }: {mode: "migrate" | "recover" | "verify" | "settings"}) {
  const [params] = useSearchParams();
  const { adoptSession } = useAuth();
  const [secret, setSecret] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    setMessage("");
    try {
      if (mode === "migrate") {
        const result = await migrateLegacy(String(data.get("email")), String(data.get("password")));
        setSecret(result.login_key ?? null);
        // Session is adopted only after the merchant confirms the secret is saved.
        setNewToken(result.token);
      } else if (mode === "settings") {
        await setRecoveryEmail(String(data.get("email")));
        setMessage("Verification link sent. Check your inbox and verify your address.");
      } else if (mode === "verify") {
        await verifyRecoveryEmail(params.get("token") ?? "");
        setMessage("Recovery email verified. You can now use it if you lose your login secret.");
        window.history.replaceState(null, "", "/verify-email");
      } else if (params.has("uid") && params.has("token")) {
        const result = await completeRecovery(params.get("uid") ?? "", params.get("token") ?? "");
        setSecret(result.login_key ?? null);
        setNewToken(result.token);
        window.history.replaceState(null, "", "/recover");
      } else {
        await requestRecovery(String(data.get("email")));
        setMessage("If your email is verified, you will receive a recovery link.");
      }
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.detail : "Unable to complete request. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const recoveryLink = mode === "recover" && params.has("uid") && params.has("token");
  const title = mode === "migrate" ? "Migrate existing account" : mode === "settings" ? "Optional recovery email" : mode === "verify" ? "Verify recovery email" : recoveryLink ? "Reset login secret" : "Recover access";
  return <main className="auth-layout"><section className="auth-card">
    <p className="eyebrow">ZOERDWALLET Merchant</p>
    <h1>{title}</h1>
    {secret ? <section aria-label="New login secret">
      <p><strong>Save this secret now.</strong> It will not be displayed again. Do not share it.</p>
      <textarea readOnly rows={3} value={secret} aria-label="New merchant login secret"/>
      <button type="button" onClick={() => navigator.clipboard.writeText(secret)}>Copy secret</button>
      <label><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)}/> I have securely saved my secret</label>
      {saved && newToken ? <button type="button" onClick={() => adoptSession(newToken)}>Continue to dashboard</button> : null}
    </section> : <form onSubmit={submit}>
      {mode === "migrate" ? <p>Sign in once with your existing email and password. Your merchant ID, wallet history and API keys remain unchanged. This disables password login for that account.</p> : null}
      {mode === "settings" ? <p>Recovery is optional. We will send a verification link. Until verified, this email cannot recover your account.</p> : null}
      {mode === "recover" && !recoveryLink ? <p>Only previously verified recovery emails can reset a login secret. The original secret cannot be retrieved.</p> : null}
      {mode === "migrate" || mode === "settings" || (mode === "recover" && !recoveryLink) ? <>
        <label htmlFor="access-email">Email</label><input id="access-email" name="email" type="email" autoComplete="email" required />
      </> : null}
      {mode === "migrate" ? <><label htmlFor="access-password">Existing password</label><input id="access-password" name="password" type="password" autoComplete="current-password" required /></> : null}
      {error ? <p role="alert" className="form-error">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <button type="submit" disabled={pending}>{pending ? "Please wait…" : mode === "verify" ? "Verify email" : recoveryLink ? "Generate replacement secret" : mode === "migrate" ? "Migrate account" : mode === "settings" ? "Send verification link" : "Send recovery link"}</button>
    </form>}
    <p><Link to="/login">Sign in</Link></p>
  </section></main>;
}
