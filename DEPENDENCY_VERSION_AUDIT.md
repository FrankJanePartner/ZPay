# Dependency version inventory and audit

Audit date: 2026-10-22. Reviewed actual dependency declarations in `package.json`, `src-tauri/Cargo.toml`, `wallet-service/Cargo.toml`, and `backend/requirements.txt`. This closes the inventory/version-audit task, **not** vulnerability remediation or a security scan.

## Frontend (npm)

| Dependency | Declared range |
| --- | --- |
| react / react-dom | ^19.1.0 |
| @tauri-apps/api / @tauri-apps/plugin-opener | ^2 |
| @tauri-apps/cli | ^2 |
| vite | ^7.0.4 |
| @vitejs/plugin-react | ^4.6.0 |
| typescript | ~5.8.3 |
| @types/react / @types/react-dom | ^19.1.8 / ^19.1.6 |

**Finding:** Major-version ranges for Tauri packages allow different minor/patch resolutions over time. Verify reproducible installation using the committed lockfile and `npm ci` or the repository's actual package manager.

## Django backend (pip)

| Dependency | Declared constraint |
| --- | --- |
| Django | >=5.2,<5.3 |
| django-cors-headers | >=4.7,<5 |
| djangorestframework | >=3.16,<3.17 |
| dj-database-url | >=2.3,<4 |
| psycopg[binary] | >=3.2,<4 |
| drf-spectacular[sidecar] | ==0.29.0 |
| whitenoise | ==6.12.0 |

**Finding:** Most backend packages are version ranges, so different builds may resolve different patch releases. Use a reproducible dependency lock/constraints process for production.

## Rust desktop and wallet service

Desktop uses `zcash_client_backend 0.24.0`, `zcash_client_sqlite 0.22.0`, `zcash_keys 0.16.1`, `zcash_protocol 0.10.5`, `zcash_proofs 0.30.0`, `zcash_primitives 0.30.1`, `zip321 0.9.0`, `zcash_address 0.13.0`, `rusqlite 0.37.0` and Tauri 2.

Wallet service pins Zcash crate versions with exact `=` constraints and pins `rusqlite =0.37.0`. Both use Rust 2021. Other Rust dependencies have compatible ranges and should be resolved through committed Cargo.lock files.

**Finding:** Zcash crate compatibility is important for transaction history and memo decoding. Verify desktop and wallet-service lockfiles and exercise both against the same wallet schema before any upgrades.

## Remediation / verification queue

1. Run `npm audit --omit=dev` and full `npm audit` with the locked dependency graph; review transitive findings.
2. Run `cargo audit` separately for desktop and wallet-service lockfiles; inspect RustSec advisories.
3. Run `pip-audit -r backend/requirements.txt` against a resolved/locked environment, and record the actual versions.
4. Evaluate high/critical findings by exploitability and affected deployment surface; update versions with integration tests.
5. Re-run security scans after changes and record results in the final Snyk/SonarQube milestone.

**Important:** No advisory feed or vulnerability scanner was executed in this inventory. This report does not claim dependencies are vulnerability-free.

## Checklist accounting

Completed: **08 / Audit dependency versions** (declaration inventory and actionable drift/reproducibility findings).

Not completed: **08 / Remediate identified vulnerabilities**, **08 / Recheck dependency security**, and **16 / Final SonarQube/Snyk rescan and closure**.
