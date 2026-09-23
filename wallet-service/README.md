# ZPay wallet service — address allocation stage

This Linux/WSL service reuses the existing wallet storage, address and network modules without Tauri.
It currently supports MAINNET because the reused wallet engine hardcodes that network.
The service supports address allocation and SDK scanning. Django imports complete snapshots
for deposit attribution, balances and reorganization handling. Webhooks and withdrawals
remain unavailable. Live receipt and recovery testing is still required.

## First: verify lightwalletd (read-only)

Run in Ubuntu, with Rust on PATH:

```bash
cd /mnt/f/ZPay
export CARGO_TARGET_DIR="$HOME/.cache/zpay-target"
cargo run --manifest-path wallet-service/Cargo.toml -- probe
```

LIGHTWALLETD_URL defaults to http://127.0.0.1:9067. The probe uses the gRPC GetLatestBlock and
GetTreeState methods and prints chain_tip, tree_height and network. It neither generates keys
nor creates wallets. If Windows can reach 9067 but Ubuntu cannot, check the service bind address
and WSL networking before changing the endpoint.

## Initialize and serve (after the probe)

Use the Ubuntu filesystem for wallet data, not /mnt/f or the git checkout:

```bash
export ZPAY_WALLET_DATA="$HOME/.local/share/zpay-wallet"
cargo run --manifest-path wallet-service/Cargo.toml -- init
cargo run --manifest-path wallet-service/Cargo.toml -- serve
```

Init refuses to overwrite an existing directory. It creates a random 32-byte vault.key and an
independent service.token, stored in mode-0600 files under a mode-0700 directory. Keep an offline
backup of vault.key separately from encrypted recovery records before accepting any funds.
Encryption protects recovery records if they are copied alone; access to the live data directory
includes the encryption key and therefore still requires strong operating-system access controls.

The service binds only 127.0.0.1:9070 and locks its data directory to one process.
GET /health reports liveness. GET /v1/probe and POST /v1/addresses require
Authorization: Bearer <contents-of-service.token>. Never paste that token or vault.key into chat.

POST /v1/addresses accepts:

```json
{"merchant_id":"1","request_id":"a479f0f1-dc2a-4f41-b364-e7b1595f30ad"}
```

merchant_id is the Django account ID, and request_id is the persisted payment UUID.
The response echoes both fields and contains address. Each merchant has a separate wallet DB,
an authenticated encrypted recovery record (including birthday), and durable per-request mappings.
Repeated requests return the persisted address. Recoverable material is written before publication.
Wallet expiry never deletes these records. An interrupted allocation may leave an unused address in
the wallet; no returned address is intentionally reused for another request.

Configure Django with ZPAY_WALLET_URL=http://127.0.0.1:9070 and ZPAY_WALLET_TOKEN set privately
from service.token, then restart Django. Allocation can take longer on a new wallet; a 503 is
retried using the same Idempotency-Key. No synthetic addresses are generated on errors.

## Validation and limitations

cargo test --manifest-path wallet-service/Cargo.toml --lib runs vault, identity and persistence tests
plus the inherited wallet tests. Inherited tests marked ignored need a real lightwalletd and are NOT
run automatically. A successful unit test run does not verify live Zcash receipt or recovery.

This initial implementation serializes allocations. Protect and back up BOTH Django records and
the wallet-service directory: seeds alone do not reconstruct business ownership or request mappings.
There is no multi-process scaling, automatic secret rotation, continuous scanner, or restoration CLI yet.
Keep the private service off the public internet. The existing Tauri source remains the original implementation.

POST /v1/snapshot (private service bearer token, JSON {"merchant_id":"1"})
scans an existing merchant wallet and returns a complete mined-output snapshot plus
SDK balances. It never creates a merchant wallet. Partial scans return 503. The
snapshot reader uses read-only SQL against the pinned zcash_client_sqlite 0.22.0
schema, tested against an actual migrated SDK database. It includes external mined
receipts across supported pools, excludes change/internal outputs, and preserves
unmatched addresses for account-level attribution. Keep the Rust SDK pinned and
run the schema-contract test on upgrades.
