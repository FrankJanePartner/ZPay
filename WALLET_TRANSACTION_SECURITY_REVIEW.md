# Wallet transaction security review

Reviewed on 2026-10-22: `src-tauri/src/wallet/send.rs`, `src-tauri/src/wallet/history.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/wallet/storage.rs`, and `src-tauri/src/wallet/network.rs`.

## Verified controls in source

- The UI-to-Rust amount boundary accepts integer zatoshis and `Zatoshis::from_u64` enforces the Zcash monetary bound. The older floating-point send function remains in source but is not the preferred UI boundary.
- A BIP39 mnemonic is parsed locally and converted to a spending key for account zero. Wallet DB signing uses the local prover; transaction bytes are sent through lightwalletd.
- Memo creation uses Zcash's `Memo` parser and ZIP-321 `Payment`. Transparent t1/t3 recipients are rejected for nonempty memos in Rust.
- Signing errors are separate from broadcast errors. RPC transport failure after submission is marked **outcome unknown** rather than confirmed failure; this is important to prevent accidental duplicate payments.
- Wallet creation/opening and restoration reject an existing wallet path. Failed restore preserves the recovery secret if the wallet DB already exists. The secret is stored through the Tauri secure-storage plugin; secure-storage failures during *new wallet creation* are reported through `secure_storage_saved`.
- Transaction history opens the SQLite file read-only, avoiding accidental database creation. Memo display filters empty, future-use and non-text payloads.

## Actionable findings (not yet remediated)

1. **High: SQLite view compatibility unproven.** History SQL directly references `v_transactions.pool_crossing_value`, `v_transactions.block_time`, `v_transactions.expired_unmined` and `v_tx_outputs.memo`. Confirm these columns exist and have the expected meaning in the actual `zcash_client_sqlite = 0.22.0` wallet schema. Fixture tests alone cannot prove that.
2. **High: Uncertain broadcasts need reconciliation.** A network timeout can occur after a transaction reaches lightwalletd. Never auto-resend without checking wallet history and network state. There is no demonstrated end-to-end test against a real lightwalletd endpoint.
3. **High: Spending-key lifecycle.** `build_signed_transaction` derives a seed from a recovery phrase held as a Rust `String`; inspect in-memory lifetime, logging, crash reporting and secure-storage handling. Avoid logging or persisting raw recovery phrases.
4. **Medium: Memo recipient guard relies on prefixes.** Validate address type after parsing, including all valid unified and shielded address forms. Prefix checks do not substitute for address-recipient capability validation.
5. **Medium: Partial multi-transaction broadcast.** If broadcasting one txid succeeds and a later one fails, the current error path returns an error without a structured list of confirmed vs uncertain txids. A retry could be unsafe.
6. **Medium: Network configuration.** Mainnet is hard-coded in signing and wallet storage. Verify chain identity and endpoint trust/TLS when using a remotely configured lightwalletd service.
7. **Medium: Wallet backup/recovery.** Secure storage is device-dependent; ensure users have acknowledged an offline seed backup and test restore on a clean machine. A database copy is not a substitute for a recovery phrase.
8. **Medium: History privacy and correctness.** Direct SQLite access to transaction views can omit or misclassify shielded, pending, internal and outgoing memo details. Validate using real wallet fixtures before calling transaction-history work complete.

## Closure criteria

This document completes **Milestone 03: Complete transaction security review**, which is a source-code review task, not remediation certification. The outstanding findings remain open under the transaction reliability, integration testing, production safeguards and final security review milestones. No main-branch merge or company sync is authorized by this review.
