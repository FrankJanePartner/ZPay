# Maintainability and duplication review

Reviewed on 2026-10-22 against the audit branch. Scope: frontend desktop, Rust wallet and Django payments API. This closes the *review* task, not the implementation task.

## Measured hotspots

| File | Size | Responsibilities |
| --- | ---: | --- |
| `src/App.tsx` | 654 lines | Wallet lifecycle, state, synchronization, send validation, error mapping, rendering and transaction history |
| `backend/payments/views.py` | 620 lines | Login/session/recovery endpoints, payment request endpoints, send endpoints and queryset orchestration |
| `src-tauri/src/wallet/history.rs` | 150 lines | Transaction classification, SQLite read, memo parsing and projection |

## Findings

1. **High: UI component coupling.** `App` owns all wallet operations and page rendering. Extract wallet API calls and types into a typed client module, and move send validation into a pure function with unit tests. Keep the wallet recovery phrase out of generic logging or error telemetry.
2. **High: payment API cohesion.** `views.py` mixes account/recovery, payment requests and send requests. Split by domain with stable route exports. Maintain existing authentication and send-idempotency semantics.
3. **High: transaction-history schema assumptions.** The new Rust history reader assumes `v_transactions` and `v_tx_outputs` column names and types. Confirm against the locked Zcash SQLite version, test against a representative wallet database, and validate txid byte order before release. Do not claim history is complete before this verification.
4. **High: amount and fee semantics.** React uses floating-point formatting for display, though send amounts are parsed as integer zatoshis. Ensure display formatting is exact and handle outgoing amount, network fee, change and internal transfers separately.
5. **Medium: error duplication.** Rust services and React both classify wallet errors. Define stable error codes at the Tauri boundary, with readable messages in one frontend mapping function. Preserve the distinct *broadcast outcome unknown* state.
6. **Medium: duplicated wallet refresh pathways.** `refreshWallet`, `refreshDashboard` and post-send refresh need a single state lifecycle to avoid stale history and races.
7. **Medium: database access boundaries.** Keep wallet SQLite access read-only for history; never expose direct DB handles to the frontend. Confirm pagination and indexes before scaling beyond 200 entries.
8. **Medium: regression coverage.** Add targeted tests for transaction memo decoding, sent/received amounts, fee ownership, stale-wallet switching and backend view refactors.

## Refactor order

1. Validate and test history reader, fix any schema mismatch, and preserve send/broadcast safety.
2. Extract pure frontend amount formatting and send validation into independently tested modules.
3. Extract typed Tauri invocation adapter and wallet hooks without changing UI behavior.
4. Split Django payment views by responsibility, preserving route contracts and adding integration tests.
5. Benchmark the resulting database and UI paths.

## Review acceptance

Completed: inspected all three code hotspots and recorded actionable, prioritized findings with file-level measurements. Still open: **Improve typing and code organization** and **Document revised components**, as well as the separate milestone 05 refactoring and scalability verification.
