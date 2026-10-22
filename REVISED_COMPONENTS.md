# Revised components and interfaces

This document describes components and boundaries changed on the audit branch. It is not a claim of production readiness.

## Desktop UI: `src/App.tsx`
- Calls the Tauri `wallet_file_exists` command before opening a wallet. Missing or unreadable wallet files must not be silently replaced.
- Sends exact integer `amountZatoshis` to `send_zec`. The decimal entry is parsed into a `BigInt` first, then converted to a JS number only after range validation. Displays wallet amounts with integer-based formatting.
- Rejects a memo for transparent Zcash recipients, rejects memos longer than 512 UTF-8 bytes, prevents overlapping send submissions and treats empty returned transaction IDs as uncertain.
- Reads transaction history with `get_transaction_history`. The view exposes transaction ID, direction, status, amount, fee, mined height, block time and memo list. Clear stale history when the wallet is absent or cannot be opened.
- **Open risk:** the history SQL projection has not yet been validated against representative Zcash wallet data.

## Rust Tauri boundary: `src-tauri/src/lib.rs`
- Owns secure-storage access to recovery phrases and Tauri command registration.
- `send_zec` delegates signing/broadcast to `wallet::send`; never expose recovery phrases to the frontend except explicit wallet creation/recovery UX.
- `get_transaction_history` delegates to `wallet::history::read_transaction_history`; it is a read-only operation.

## Rust wallet: `src-tauri/src/wallet`
- `send.rs`: validates payment memo and recipient compatibility, creates transactions and broadcasts via lightwalletd. Broadcast outcome unknown must remain distinct from definite failure.
- `storage.rs`: creates, restores, opens and synchronizes the wallet; protects existing wallet files.
- `history.rs`: read-only SQLite history projection using `v_transactions` and `v_tx_outputs`; classifies account balance delta and chain status, decodes textual memos. Verify view schema, fee semantics, memo representation and transaction ID byte order before release.

## Django backend: `backend/payments`
- `auth.py`: bearer credential boundaries and permissions.
- `views.py`: payment endpoints and request orchestration; keep idempotency and auth checks intact.
- `provider.py`: wallet-service interface, including returned transaction ID validation.
- `ledger.py`: payment reconciliation.
- `config/settings.py`: explicit production secret and allowed-host requirements, secure session cookies and API protections.

## Tauri security: `src-tauri/tauri.conf.json`
- Replaces the disabled CSP with a restrictive same-origin script policy and explicit Tauri IPC origins.
- Validate the CSP with a packaged desktop build on supported operating systems before release.

## Testing and deployment
Run all backend, frontend, Rust and wallet service checks; confirm no regressions in a real test wallet, especially shielded memos, sent history and fees. These are outstanding integration and production-verification tasks, not prerequisites to maintaining this interface reference.
