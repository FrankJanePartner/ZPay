# Module boundary audit (milestone 05)

Scope: current ZPay audit branch, inspected 2026-10-22. This is an audit of ownership and coupling, not a completed refactor.

## Current boundaries
- `src/App.tsx`: React/Tauri desktop UI. It currently owns presentation, wallet orchestration, input parsing, and error messaging. This is a coupling hotspot.
- `src-tauri/src/lib.rs`: Tauri command and secure-storage adapter. Commands delegate wallet creation, restoration, sync, status, addresses and sending to Rust wallet modules. Keep recovery phrases inside the secure-storage/Rust boundary.
- `src-tauri/src/wallet/mod.rs`: explicit module exports: `cache`, `core`, `network`, `storage`, `send`, `history`.
- `src-tauri/src/wallet/storage.rs`: local wallet database, account status and synchronization.
- `src-tauri/src/wallet/send.rs`: payment construction, signing and broadcast. Broadcast uncertainty must not be represented as confirmed failure.
- `src-tauri/src/wallet/history.rs`: read-only transaction-history projection, currently under active verification.
- `backend/payments/views.py`: Django REST endpoints and orchestration, including auth/recovery, payment requests and send requests; this is a large module (~22 KB).
- `backend/payments/provider.py`: wallet provider boundary and transaction ID validation.
- `backend/payments/serializers.py`: REST input/output representation.
- `backend/payments/ledger.py`: deposit reconciliation/ledger boundary.

## Findings and priorities
1. HIGH: Keep send, storage and history logic out of Tauri command handlers; maintain strict read-only access for history. Verify history SQL against the actual zcash_client_sqlite 0.22 schema before relying on it.
2. HIGH: Separate UI rendering from wallet orchestration and exact amount parsing in `src/App.tsx`. Avoid component-wide state changes that can confuse wallet identity and stale transaction history.
3. MEDIUM: Split `backend/payments/views.py` by responsibility (authentication, payment requests, send requests) with stable URL imports and regression coverage.
4. MEDIUM: Define an explicit typed DTO boundary between Rust and React for wallet status, send results and transaction history; avoid floating-point conversions for values used in transactions.
5. MEDIUM: Preserve provider abstraction for backend payments; do not allow view code to bypass ledger or send-idempotency handling.
6. TESTING: Add integration tests at Tauri command/SQLite and DRF provider/ledger boundaries before refactoring internals.

## Dependency direction
React UI -> Tauri command adapter -> Rust wallet services -> Zcash library/SQLite/lightwalletd.
Django REST views -> serializers/auth/provider/ledger -> backend database and external wallet service.
No direct React access to wallet DB or secrets; no direct Django view access to desktop secure storage.

## Exit criterion
This document completes **Audit module boundaries** only. **Refactor tightly coupled components** and **Verify extensibility and scaling** remain open.
