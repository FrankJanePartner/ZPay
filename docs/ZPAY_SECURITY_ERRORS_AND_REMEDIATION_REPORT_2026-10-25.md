# ZOERDWallet (ZPay) — security, errors, warnings and remediation report

**Prepared:** 2026-10-25  
**Repository:** https://github.com/FrankJanePartner/ZPay  
**Audit branch:** `audit/security-hardening-2026-10`  
**Audit PR:** https://github.com/FrankJanePartner/ZPay/pull/5  
**Release decision:** **NOT READY TO MERGE OR DEPLOY** (pending critical verification).

## Primary vulnerability and code-quality dashboard

**SonarCloud project:** https://sonarcloud.io/project/overview?id=ZOERDHUB_ZPay

This is the canonical link for the organization's SonarCloud findings, including security vulnerabilities, security hotspots, reliability findings, maintainability issues and the quality gate. For issue-level review, open the project dashboard and select **Issues** or **Security Hotspots**.

**Important evidence limit:** SonarCloud's live project details were not retrievable during preparation of this report. Therefore **no exact SonarCloud counts, severities, issue IDs, quality-gate result, or resolution statuses are claimed**. The dashboard must be inspected with appropriate access, and findings exported or recorded before claiming any SonarCloud issue fixed. SonarCloud warnings are not identical to dependency advisories; hotspots require human review.

## 1. Verified audit progress and remaining risk

| Area | Evidence from audit | Current assessment |
| --- | --- | --- |
| GitHub CI | Five workflows passed on commit `c6821643022a51444aeedbd6300703ae1498d691`: frontend, backend, wallet service, dependency security audit and Rust | **Passed at that commit only**; rerun at final HEAD |
| Django payment/backend tests | 50 tests reported passing in the local audit session | **Passed locally**, not proof of live payments |
| Rust wallet tests | 23 passed, 4 ignored (ignored cases require live lightwalletd) | **Partially verified** |
| React/Vite dashboard build | Build succeeded in local Windows session | **Build verified**, not full merchant acceptance |
| Windows desktop release | Tauri release executable built and opened; wallet creation and persistence were exercised | **Partial manual pass** |
| Wallet recovery | Existing-wallet overwrite protection checked; isolated recovery-test app built but initial launch hit localhost connection refusal | **Recovery not verified** |
| Real memo sending | Earlier reported failure when attaching memo; no successful controlled broadcast shown | **Open / not verified fixed** |
| Transaction history | Earlier reported missing sent transactions, received memos and incomplete fee/status data | **Open / not verified fixed** |
| Error handling | Earlier reported opaque insufficient-funds and wallet-unavailable messages | **Needs end-to-end verification** |
| SonarCloud | Project URL supplied; issue data not accessible in this audit session | **Unverified; review required** |
| Live infrastructure | TLS/proxy, DB backups, node access and monitoring not acceptance-tested | **Open** |

The passing automated tests and builds are meaningful progress, but do **not** demonstrate that Zcash transactions, memo broadcasting, wallet recovery or the deployed merchant payment flow work end to end.

## 2. Errors and defects observed or reported

### ZP-01 — Outgoing transactions absent from history
**Observed/reported:** Sent transactions were not displayed as expected in the desktop transaction history.  
**Impact:** Operators may not be able to reconcile debits or investigate uncertain broadcasts.  
**Required fix/test:** Reconcile outgoing ledger records against wallet transactions; cover pending, broadcast, mined and failed statuses; test real wallet schema and pagination.  
**Status:** **Not verified resolved.**

### ZP-02 — Memo-enabled sending fails
**Observed/reported:** Including a memo prevented a ZEC send from broadcasting.  
**Impact:** A failed or ambiguous payment could lead to unsafe retries or duplicate transfers.  
**Required fix/test:** Validate recipient type and memo support, encode memo correctly, retain broadcast txid and errors, and reconcile ambiguous network outcomes before retry. Test against controlled network.  
**Status:** **Not verified resolved.**

### ZP-03 — Incoming memos not displayed
**Observed/reported:** Incoming transaction memos were not shown.  
**Required fix/test:** Confirm memo retrieval, decoding, storage and authorized display without logging sensitive memo content.  
**Status:** **Not verified resolved.**

### ZP-04 — Incomplete transaction metadata
**Required history fields:** UTC timestamp, direction, exact amount, network fee, memo where available, transaction ID, and status.  
**Required fix/test:** Compare dashboard/API representations with wallet database and actual chain data; avoid floating-point loss for zatoshis.  
**Status:** **Partially addressed in code according to earlier audit; real database verification outstanding.**

### ZP-05 — Cryptic send failures
**Observed/reported:** Insufficient funds could appear as a generic wallet-unavailable code.  
**Required fix/test:** Typed server/Rust error mapping and safe, actionable frontend messages; preserve diagnostics in restricted logs without secrets.  
**Status:** **Not verified resolved.**

### ZP-06 — Isolated recovery-test app fails to load frontend
**Observed:** The separately compiled recovery executable displayed `localhost refused to connect` / `ERR_CONNECTION_REFUSED`. Its Tauri config included `devUrl: http://localhost:1420`; it was compiled with plain `cargo build --release`, not the normal Tauri production build command. The isolated test database did not exist.  
**Impact:** Recovery exercise could not proceed; **this does not establish failure of the main desktop release**.  
**Required fix/test:** Produce the recovery-test executable through the Tauri production build process, verify embedded frontend, isolate application data and Windows credential store, restore a disposable wallet and compare addresses.  
**Status:** **Open; intentionally paused** to prioritize merchant API.

### ZP-07 — Build and environment blockers encountered
- Windows initially lacked `uv`; WSL was used for Python tooling.
- `npm ci` under WSL encountered network timeouts; Windows npm succeeded.
- Flasharb registry digest mismatch belongs to the **separate arbitrage project**, **not** ZPay and must not be included as a ZPay defect.
- Tauri JSON BOM/config parsing issue was corrected for local release compilation.
- Six Rust dead-code warnings were observed during desktop builds. These are compiler warnings, **not proven security vulnerabilities**; review before removing code.
- A closed desktop window left a process running in one test. Confirm whether intentional background behavior or lifecycle defect.

## 3. Security and vulnerability review

**SonarCloud:** https://sonarcloud.io/project/overview?id=ZOERDHUB_ZPay

| Category | Risk and review needed | Evidence/status |
| --- | --- | --- |
| Static-analysis vulnerabilities | Inspect rule, severity, file/line, exploitability and remediation | **SonarCloud issue inventory not yet obtained** |
| Security hotspots | Human-review cryptography, secret handling, authentication, logging, network calls and configuration; record safe/fixed decisions | **Not yet reviewed from SonarCloud** |
| Dependency advisories | Inspect GitHub dependency audit output, vulnerable package/version, fix availability and runtime reachability | **Workflow passed at recorded commit; individual advisory inventory not provided** |
| Authentication/authorization | Verify merchant permissions, API token handling, object ownership and least privilege | **Production verification pending** |
| CORS and browser access | `backend/payments/test_cors.py` includes tests for allowed origins, hostile lookalike origins and preflight headers | **Tests exist; deployed policy still needs verification** |
| Wallet recovery secrets | Windows secure-storage plugin uses keyring service from Tauri `productName` and the fixed recovery key; test identity and key were changed for isolation | **Source-level isolation reviewed; actual restore not completed** |
| Payments and reconciliation | Validate idempotency, duplicate requests, retries, confirmation thresholds, transaction history and payout-state correctness | **Production verification pending** |
| Deployment and data protection | TLS, reverse proxy, database backup, secret rotation, logging, disaster recovery and rollback | **Pending** |

**Do not label SonarCloud findings as resolved based solely on passing GitHub Actions.** A green dependency audit workflow is not the same as a SonarCloud security review.

## 4. Remediation and hardening work completed to date

1. Established a dedicated audit branch and draft PR instead of directly merging into `main`.
2. Ran and passed frontend, backend, wallet-service, dependency-audit and Rust CI workflows on the recorded audit commit.
3. Executed 50 Django tests and 23 Rust tests locally; documented four ignored live-integration Rust tests.
4. Built the React dashboard and native Windows desktop release.
5. Manually exercised wallet creation, reopening and persistence; confirmed protection against restoration over an existing wallet.
6. Inspected the Tauri recovery secret storage implementation and created a distinct recovery-test identity/key without deleting the original wallet.
7. Added/retained CORS regression tests for expected browser headers and disallowed origins.
8. Recorded the formal **NOT READY TO MERGE** decision in `MERGE_READINESS_DECISION.md`, including live wallet, security and deployment acceptance gates.

**Caveat:** The list records completed checks and preparation. It does **not** assert that all corresponding product bugs have been fixed, nor that SonarCloud warnings have been cleared.

## 5. Remaining work and release acceptance criteria

### P0 — Before live merchant payment deployment
- [ ] Access the SonarCloud project and record exact open vulnerabilities, hotspots, rule IDs, severities, locations, issue links and quality-gate status.
- [ ] Triage each security finding with owner, fix commit and regression test; rerun SonarCloud on the correct final branch.
- [ ] Review the **merchant-facing dashboard and deployed payment API** end to end, including authentication, wallet ownership, payment creation, memo support, transaction reconciliation, and error messages.
- [ ] Test actual API deployment with TLS/CORS, backend environment, database persistence, backup and rollback.
- [ ] Verify no unresolved critical security issue or payment-integrity blocker remains.

### P1 — Before complete wallet release
- [ ] Controlled memo-enabled outgoing payment and incoming memo tests.
- [ ] Compare complete transaction history to real wallet data, including exact fees and statuses.
- [ ] Complete isolated seed recovery test without touching the original wallet.
- [ ] Resolve/justify Rust warnings and confirm desktop process lifecycle.
- [ ] Rerun full CI, security scans and acceptance tests at final commit; obtain explicit approval.

## 6. Audit evidence and links

- **Primary SonarCloud vulnerability dashboard:** https://sonarcloud.io/project/overview?id=ZOERDHUB_ZPay
- Personal source repository: https://github.com/FrankJanePartner/ZPay
- Audit PR: https://github.com/FrankJanePartner/ZPay/pull/5
- Audit readiness decision: `MERGE_READINESS_DECISION.md` on `audit/security-hardening-2026-10`
- CORS regression tests: `backend/payments/test_cors.py` on audit branch

## 7. Status update protocol

For each new SonarCloud finding, record: issue ID; rule; severity; affected path/line; issue URL; risk; reproducibility; remediation; commit/PR; test evidence; latest SonarCloud status; reviewer and date. Mark as **fixed** only when code and verification support that claim. Record a new report revision whenever scans or deployments change.

**Current decision: NO-GO for merging the complete ZPay audit branch or deploying unverified payment changes.** This report is a working audit record, not a certification of security.
