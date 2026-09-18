# Task 7 Report: Received Outputs and API Keys

## Status

Implemented and verified the authenticated transaction-history and API-key workflows. Root Tauri sources were not changed.

## RED evidence

### Initial feature tests

Command:

```text
cd dashboard
npm test -- --run src/pages/TransactionsPage.test.tsx src/pages/ApiKeysPage.test.tsx
```

Observed result before implementation:

```text
Test Files  2 failed (2)
Tests       9 failed (9)
```

The failures showed the existing placeholder routes and the absence of transaction facts, pagination, key metadata, one-time-secret handling, validation, and revocation behavior.

### Metadata-only cache hardening

Command:

```text
npm test -- --run src/pages/ApiKeysPage.test.tsx -t "shows key metadata"
```

Observed result before response projection:

```text
Test Files  1 failed (1)
Tests       1 failed | 3 skipped (4)
AssertionError: expected cached key metadata not to contain zpay_once_only_super_secret
```

This proved that TypeScript typing alone did not remove an unexpected secret field from a list response.

## GREEN evidence

Focused command:

```text
npm test -- --run src/pages/TransactionsPage.test.tsx src/pages/ApiKeysPage.test.tsx
```

Result:

```text
Test Files  2 passed (2)
Tests       9 passed (9)
```

Final full dashboard command:

```text
npm test -- --run
```

Result:

```text
Test Files  13 passed (13)
Tests       89 passed (89)
```

## Build

Command:

```text
npm run build
```

Result:

```text
tsc --noEmit && vite build
104 modules transformed
vite build completed successfully
PWA generateSW completed; 11 precache entries
```

## Files

- Created `dashboard/src/pages/TransactionsPage.tsx`
- Created `dashboard/src/pages/TransactionsPage.test.tsx`
- Created `dashboard/src/pages/ApiKeysPage.tsx`
- Created `dashboard/src/pages/ApiKeysPage.test.tsx`
- Modified `dashboard/src/api/queries.ts`
- Modified `dashboard/src/router.tsx`
- Modified `dashboard/src/styles.css`

## Implemented behavior

- Transaction desktop table converts to mobile cards without horizontal primary-content scrolling.
- Received outputs show amount, block time, pool, output index, confirmations, confirmed/reversed state, late/unmatched state, linked payment requests, and full transaction-ID copy.
- Reversed outputs include an audit explanation.
- API-provided transaction page URLs are resolved only when they match the configured API origin and exact transaction-list path; cross-origin and malformed URLs fail before fetch.
- API-key lists are projected to metadata fields before entering the query cache, even if an unexpected secret field appears in a response.
- New API-key secrets use component state only, never TanStack mutation/query caches or browser storage, and disappear on dismiss, remount, navigation, or session change.
- API-key creation validates trimmed names at 1–80 characters.
- Accessible one-time-secret and revoke-confirmation dialogs provide copy/dismiss and cancel/confirm actions.
- A successful 204 revoke invalidates and refreshes metadata; cancellation sends no DELETE.
- Create/revoke requests are abortable and guarded against stale component or changed-session completion.

## Self-review

- `git diff --check`: clean.
- Scope check: only the seven requested dashboard source/test files changed; no root Tauri files changed.
- Pagination review: scheme/host/port, credentials, hash, and pathname are validated before conversion to a relative API path.
- Secret review: create uses a direct abortable request rather than a cached mutation; list records are explicitly projected; tests inspect local storage, session storage, query cache, and mutation cache.
- Session review: AuthProvider continues to clear remote caches on token changes; API-key component state and active operations are also cleared/aborted.
- Accessibility review: semantic table headings remain available on mobile; dialogs have names, modal semantics, keyboard Escape handling, autofocus, and explicit actions.
- Responsive review: transaction rows become labeled cards below 768px; key forms and metadata collapse to one column.

## Concerns

- Verification output includes the environment-level npm warning `Unknown env config "http-proxy"`; it does not affect test or build success.
- No external browser visual-regression run was required by this task; responsive behavior is implemented in CSS and covered by semantic component tests.

## Fix Round 1: Dialog Accessibility and Pagination Recovery

### Root cause and RED evidence

The existing modal work captured the opener and restored it during the modal cleanup. On a successful revoke, React removed that revoke button in the same commit, so focus landed on the document body after the removed opener. The following added focus-restoration assertion failed before the post-refresh focus fix:

```text
Expected element with focus:
<h2 id="key-list-title" tabindex="-1">Your API keys</h2>
Received element with focus:
<body>…</body>
```

### Changes

- Added a portal-based `ModalDialog` shared by the API-key secret and revoke confirmation dialogs. It places initial focus in the dialog, traps Tab/Shift+Tab, handles Escape (unless a revoke is pending), isolates body siblings with `inert` and `aria-hidden`, restores their original state, and restores opener focus on Cancel/Escape.
- Kept revoke failures inside the named `alertdialog`, with an announced alert description.
- After a successful revoke and refreshed key list, focuses the persistent `Your API keys` heading rather than the revoked button being removed from the DOM.
- Added Retry, Back to previous page, and Back to first page actions after a transaction-page failure. Pagination recovery retains the existing URL validation by retrying through `getTransactions`; the cross-origin test proves Retry does not issue an attacker-origin request.

### Verification

Focused command:

```text
cd dashboard
npm test -- --run src/pages/ApiKeysPage.test.tsx src/pages/TransactionsPage.test.tsx
```

Result:

```text
Test Files  2 passed (2)
Tests       14 passed (14)
```

Full dashboard command:

```text
npm test -- --run
```

Result:

```text
Test Files  13 passed (13)
Tests       94 passed (94)
```

Build and whitespace check:

```text
npm run build && git diff --check
```

Result:

```text
tsc --noEmit && vite build
105 modules transformed
vite build completed successfully
PWA generateSW completed; 11 precache entries
git diff --check: clean
```

### Fix-round self-review

- Secret and revoke dialogs each have coverage for initial focus, Tab/Shift+Tab wrapping, background isolation/restoration, Escape dismissal, and focus restoration; successful revoke additionally covers the removed-trigger fallback.
- Dialog accessibility is explicit: the secret uses `role="dialog"`; revocation uses `role="alertdialog"`, a stable name, a description, and an in-context `role="alert"` error.
- Recovery controls keep the failed page URL inside the existing query function, so same-origin and exact-path validation runs for both initial attempts and retries. The regression test checks that an attacker URL never reaches `fetch`.
- Scope remains limited to Task 7 dashboard source/tests plus this report. No root Tauri files changed.
