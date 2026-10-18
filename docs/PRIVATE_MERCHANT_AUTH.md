# ZOERDWALLET private merchant authentication

## New accounts
- POST `/api/v1/auth/register/` with `{}`: creates an email-free account and returns a 12-hour dashboard session plus a **one-time** `login_key`.
- POST `/api/v1/auth/login/` with `{"login_key":"..."}`: returns a new dashboard session.
- The login secret is generated with a cryptographic random generator and only its SHA-256 digest is stored in the database. It is distinct from merchant API keys and wallet recovery phrases.
- If a merchant loses their secret without a previously verified recovery email, access may be permanently lost.

## Existing account migration
- The dashboard `/migrate` page accepts the existing email/password once.
- `/api/v1/auth/migrate/` issues a secret without disabling the existing password, so a lost HTTP response can be retried.
- After saving the secret, `/api/v1/auth/confirm-migrate/` confirms it and disables password login. It revokes existing dashboard sessions, **not API credentials**.
- The same Django user primary key is retained, preserving associated payment requests, sends, deposits and API keys.

## Optional email recovery
- From the dashboard, open **Recovery email** and confirm the login secret.
- A verification link is sent to the address. Only verified addresses can recover an account.
- A recovery request sends a short-lived reset link; successful reset issues a **new** login secret, invalidates the old login secret, and revokes prior dashboard sessions.
- No original login secret is retrievable from the database.

## Required production configuration
Set `ZPAY_DASHBOARD_ORIGIN=https://wallet.zoerd.com` (adjust to the real frontend origin), `ZPAY_SMTP_HOST`, `ZPAY_SMTP_PORT`, `ZPAY_SMTP_USER`, `ZPAY_SMTP_PASSWORD`, `ZPAY_SMTP_TLS`, and `ZPAY_FROM_EMAIL` in the **backend** environment. Do not commit secrets. Verify SMTP and DNS email authentication before offering recovery. A distributed rate-limit cache is recommended for multi-worker deployment.

## Deployment gates
1. Back up the Django database, wallet data, and legacy transaction journals.
2. `python manage.py check`, `python manage.py makemigrations --check --dry-run`, `python manage.py migrate --plan`, and `python manage.py test payments --noinput`.
3. `npm run build` in `dashboard`.
4. Test new registration, save-confirmation, login, existing account migration, email verification, recovery, session revocation and existing API keys in a non-production environment.
5. Apply migrations and deploy backend and dashboard together. Do not restart the Rust wallet service as part of this auth-only rollout. Do not use real ZEC to test authentication.

**Security note:** Key-only authentication reduces personal data collection but does not itself make blockchain activity anonymous or provide end-to-end encrypted merchant data.


## Resend SMTP setup (production)
ZOERDWALLET uses Django's SMTP backend; no Resend SDK or merchant-domain allowlist is required. In Resend, verify the sending domain (SPF and DKIM) and create a **sending-only** API key scoped to that domain. Store the key exclusively in the backend runtime secret environment, not Git, dashboard Vite variables, browser storage, or terminal output.

Recommended Resend configuration (SMTPS):
```dotenv
ZPAY_DASHBOARD_ORIGIN=https://YOUR-ACTUAL-DASHBOARD-HOST
ZPAY_EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend
ZPAY_SMTP_HOST=smtp.resend.com
ZPAY_SMTP_PORT=465
ZPAY_SMTP_USER=resend
ZPAY_SMTP_PASSWORD=YOUR_RESEND_SENDING_ONLY_API_KEY
ZPAY_SMTP_TLS=0
ZPAY_SMTP_SSL=1
ZPAY_FROM_EMAIL=ZOERDWALLET <no-reply@YOUR-VERIFIED-DOMAIN>
```
Alternative STARTTLS configuration: port 587, `ZPAY_SMTP_TLS=1`, `ZPAY_SMTP_SSL=0`. Do not enable both TLS and SSL. Set the actual public HTTPS dashboard origin or verification/recovery links will be incorrect. The email sender domain must be verified in Resend.

After configuring the runtime environment, reload/redeploy the backend using the actual service manager so its workers inherit the new environment. A Gunicorn HUP alone does **not** import changed environment variables from your shell. Confirm production `DASHBOARD_ORIGIN` and email settings without printing credentials, then send a verification email from `/recovery-settings` using a dedicated test account. Confirm the verification link opens the dashboard and completes successfully; test recovery in a separate signed-out browser session, save the replacement secret, and verify the old secret no longer works. Never put login secrets, reset URLs or Resend API keys into logs, tickets or screenshots.

Do not configure recovery using an HTTP origin in production. Use rate limits and monitoring for email abuse, and do not treat successful SMTP acceptance as proof of delivery. For multi-worker deployment, use a shared cache for throttling.
