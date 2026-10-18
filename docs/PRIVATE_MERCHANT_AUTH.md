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
