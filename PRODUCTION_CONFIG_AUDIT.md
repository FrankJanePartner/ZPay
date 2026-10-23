# Production environment configuration audit

Reviewed 2026-10-22: `backend/config/settings.py`, `src-tauri/tauri.conf.json`, and the existing CI boundaries.

## Verified controls
- Production Django startup requires an explicit `ZPAY_SECRET_KEY`; local-only fallback is allowed only with `ZPAY_DEBUG=1`.
- Production Django sessions use HTTPS-only cookies; `SECURE_SSL_REDIRECT`, content-type sniffing protection, and same-origin referrer policy are enabled.
- CSRF trusted origins are restricted to HTTPS; CORS credentials are disabled, and production CORS origins default to none.
- Authentication defaults to bearer authentication and authenticated permissions; throttles are configured.
- Wallet service endpoint and token come from environment variables, not caller-supplied URLs.
- Production `ZPAY_ALLOWED_HOSTS` now requires explicit hostnames rather than silently accepting localhost defaults (commit b508a3c).

## Open findings requiring remediation or deployment verification
1. **High**: Desktop Tauri `app.security.csp` is null. Set and test an appropriate restrictive CSP before production packaging. Do not apply an untested policy that could break wallet functionality.
2. **High**: `SECURE_PROXY_SSL_HEADER` trusts `X-Forwarded-Proto`. Deployment must strip untrusted incoming forwarding headers and set this header only at a trusted reverse proxy.
3. **Medium**: Production defaults to a local SQLite database unless `DATABASE_URL` is configured. Document backup, access control and scaling requirements for the chosen deployment database.
4. **Medium**: Validate that `ZPAY_DASHBOARD_ORIGIN`, `ZPAY_CORS_ALLOWED_ORIGINS` and `ZPAY_CSRF_TRUSTED_ORIGINS` match the actual deployed hosts.
5. **Medium**: Confirm SMTP TLS, host identity, sender domain, timeouts and credential rotation in the deployment environment.
6. **Medium**: Verify production secrets are provided via secret management, never committed or logged, and recovery keys are backed up securely.
7. **Operational**: Run Django deployment checks and actual Tauri release packaging before approving production.

## Outcome
The **Audit production environment settings** task is complete: settings were inspected, the production host allowlist default was hardened, and remaining risks are recorded. The separate **Verify backup, recovery and operational safeguards** and final production release approval tasks remain open.
