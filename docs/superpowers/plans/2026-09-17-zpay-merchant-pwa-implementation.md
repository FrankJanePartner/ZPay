# ZPay Merchant PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an installable, responsive merchant dashboard for the existing ZPay API without changing the Tauri wallet UI.

**Architecture:** Create an independent `dashboard/` React/Vite PWA that calls Django through a typed network-only client. Django permits explicit frontend origins, browser secrets remain session-scoped, and service-worker storage contains frontend assets only.

**Tech Stack:** React 19, TypeScript 5.8+, Vite 7, React Router, TanStack React Query, Vitest, React Testing Library, Mock Service Worker, vite-plugin-pwa, Django 5.2, django-cors-headers, Vercel.

**Spec:** `docs/superpowers/specs/2026-09-17-zpay-merchant-pwa-design.md`

## Global Constraints

- Preserve root `src/` and `src-tauri/`; all hosted UI code belongs in `dashboard/`.
- Use `VITE_API_BASE_URL`, defaulting locally to `http://127.0.0.1:8000`.
- Store dashboard tokens only in `sessionStorage`; never persist API-key secrets or financial responses.
- Cache only versioned frontend assets and the navigation shell; API traffic is network-only.
- Calculate zatoshi/ZEC values with strings or `bigint`, never JavaScript `number`.
- Show payment-window, funding, deposit, and synchronization states separately.
- Settlement, withdrawal, webhooks, public checkout, pricing, organizations, and profiles are out of scope.
- Apply red-green-refactor to every production behavior and commit only green test states.

## File Map

`dashboard/src/api/` owns HTTP types, error normalization, and React Query operations. `dashboard/src/auth/` owns session storage and route protection. `dashboard/src/components/` contains presentation primitives. `dashboard/src/pages/` contains route screens. `dashboard/src/test/` owns MSW fixtures and provider-aware rendering. `backend/config/settings.py` owns CORS configuration. `vercel.json` and `.github/workflows/dashboard.yml` own deployment and CI.

---

### Task 1: Explicit Django CORS Boundary

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/config/settings.py`
- Create: `backend/payments/test_cors.py`

**Interfaces:**
- Consumes: comma-separated `ZPAY_CORS_ALLOWED_ORIGINS`.
- Produces: CORS headers only for exact configured origins; credentials remain disabled.

- [ ] **Step 1: Write failing CORS tests**

```python
from django.test import TestCase, override_settings

@override_settings(CORS_ALLOWED_ORIGINS=["https://zpay.example.com"])
class CorsPolicyTests(TestCase):
    def test_configured_origin_is_allowed(self):
        response = self.client.options("/health/", HTTP_ORIGIN="https://zpay.example.com", HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET")
        self.assertEqual(response["Access-Control-Allow-Origin"], "https://zpay.example.com")

    def test_unknown_origin_is_rejected(self):
        response = self.client.options("/health/", HTTP_ORIGIN="https://attacker.example", HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET")
        self.assertNotIn("Access-Control-Allow-Origin", response)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `.\backend\.venv\Scripts\python.exe backend\manage.py test payments.test_cors -v 2`

Expected: FAIL because no CORS header exists.

- [ ] **Step 3: Add minimal CORS implementation**

Add `django-cors-headers>=4.7,<5`. Insert `corsheaders` in `INSTALLED_APPS` and `corsheaders.middleware.CorsMiddleware` before `CommonMiddleware`. Configure:

```python
CORS_ALLOWED_ORIGINS = [
    item.strip()
    for item in os.environ.get(
        "ZPAY_CORS_ALLOWED_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173" if DEBUG else "",
    ).split(",") if item.strip()
]
CORS_ALLOW_CREDENTIALS = False
```

- [ ] **Step 4: Verify GREEN and regressions**

Run requirements installation, the focused test, then `backend\manage.py test payments -v 2`. Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/config/settings.py backend/payments/test_cors.py
git commit -m "feat: allow configured ZPay dashboard origins"
```

---

### Task 2: Tested React/Vite PWA Foundation

**Files:**
- Create: `dashboard/package.json`, `dashboard/package-lock.json`, `dashboard/tsconfig.json`, `dashboard/vite.config.ts`, `dashboard/index.html`
- Create: `dashboard/src/main.tsx`, `dashboard/src/App.tsx`, `dashboard/src/App.test.tsx`, `dashboard/src/test/setup.ts`, `dashboard/src/styles.css`
- Create: `dashboard/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`

**Interfaces:**
- Produces: `npm run dev`, `npm test`, `npm run build`, and an installable ZPay manifest.

- [ ] **Step 1: Add package metadata and a failing smoke test**

Use scripts `dev`, `build`, `test`, `test:watch`, and `preview`. Add React, React DOM, React Router, TanStack Query, vite-plugin-pwa, Vitest, jsdom, Testing Library, user-event, MSW, and TypeScript types.

```tsx
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { App } from "./App";

it("identifies the merchant dashboard", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: /zpay merchant dashboard/i })).toBeVisible();
});
```

- [ ] **Step 2: Install and verify RED**

Run `cd dashboard && npm install && npm test -- --run src/App.test.tsx`. Expected: missing `App` failure.

- [ ] **Step 3: Add minimal app and test setup**

```tsx
export function App() {
  return <h1>ZPay Merchant Dashboard</h1>;
}
```

Mount it under `React.StrictMode`. Configure jsdom and import `@testing-library/jest-dom/vitest` from the setup file.

- [ ] **Step 4: Configure asset-only PWA behavior**

Use `VitePWA({registerType: "prompt"})`, standalone display, charcoal background, gold theme, the three icons, and `globPatterns` for JS/CSS/HTML/icons/fonts. Add no API runtime-cache rule.

- [ ] **Step 5: Verify and commit**

Run `npm test -- --run && npm run build`. Confirm `dist/manifest.webmanifest` names ZPay. Commit `dashboard/` as `feat: establish tested ZPay merchant PWA`.

---

### Task 3: Exact Money, API, and Session Boundaries

**Files:**
- Create: `dashboard/src/api/types.ts`, `client.ts`, `client.test.ts`
- Create: `dashboard/src/auth/session.ts`, `session.test.ts`
- Create: `dashboard/src/components/Money.tsx`, `Money.test.tsx`
- Create: `dashboard/src/test/server.ts`, `handlers.ts`, `render.tsx`

**Interfaces:**
- Produces: `apiRequest<T>()`, `ApiError`, `session.getToken/setToken/clear`, and `formatZec(string): string`.

- [ ] **Step 1: Write and run failing exact-money tests**

```ts
expect(formatZec("0")).toBe("0.00000000");
expect(formatZec("1")).toBe("0.00000001");
expect(formatZec("100000000")).toBe("1.00000000");
expect(formatZec("2100000000000000")).toBe("21000000.00000000");
expect(() => formatZec("1.5")).toThrow("Invalid zatoshi amount");
```

Expected RED: formatter module is missing.

- [ ] **Step 2: Implement formatter with `BigInt` and verify GREEN**

Validate `^(0|[1-9][0-9]*)$`, divide by `100_000_000n`, and pad the remainder to eight digits.

- [ ] **Step 3: Write and run failing session tests**

```ts
session.setToken("zpay_example");
expect(sessionStorage.getItem("zpay.dashboard.token")).toBe("zpay_example");
expect(localStorage.getItem("zpay.dashboard.token")).toBeNull();
session.clear();
expect(session.getToken()).toBeNull();
```

- [ ] **Step 4: Implement session boundary and verify GREEN**

Expose only three methods, reject blank tokens, and never access localStorage.

- [ ] **Step 5: Write failing HTTP contract tests**

Using MSW, prove bearer headers are sent; 204 returns `undefined`; 401 clears the token; 429 captures `Retry-After`; 503 preserves safe detail; network errors become status `0`; HTML/traces never reach displayed error text.

- [ ] **Step 6: Implement client and exact response types**

Define `SessionResponse`, `KeyMetadata`, `IssuedKey`, `PaymentRequest`, `Paginated<T>`, `WalletBalance`, and `DepositOutput` using Swagger field names. `ApiError` carries `status`, `detail`, `fields`, and `retryAfterSeconds`.

- [ ] **Step 7: Verify and commit**

Run focused tests, all dashboard tests, and build. Commit as `feat: add secure typed ZPay browser client`.

---

### Task 4: Authentication, Protected Routes, and Responsive Shell

**Files:**
- Create: `dashboard/src/api/queries.ts`
- Create: `dashboard/src/auth/AuthProvider.tsx`, `ProtectedRoute.tsx`, `auth.test.tsx`
- Create: `dashboard/src/components/AppShell.tsx`, `AppShell.test.tsx`
- Create: `dashboard/src/router.tsx`
- Create: `dashboard/src/pages/LoginPage.tsx`, `RegisterPage.tsx`, `DocsPage.tsx`
- Modify: `dashboard/src/main.tsx`, `dashboard/src/styles.css`

**Interfaces:**
- Produces: `useAuth()`, auth routes, protected routes, logout, and responsive navigation.

- [ ] **Step 1: Write failing auth-flow tests**

```tsx
renderAt("/dashboard");
expect(await screen.findByRole("heading", { name: /sign in/i })).toBeVisible();
```

Add real MSW-backed tests for registration, login failure, redirecting authenticated users away from auth pages, and clearing local session even when logout returns 503.

- [ ] **Step 2: Verify RED**

Run `npm test -- --run src/auth/auth.test.tsx`. Expected: missing provider/router exports.

- [ ] **Step 3: Implement auth provider, labeled forms, and route guard**

Initialize from session storage. Expose `login`, `register`, and `logout`. Use correct autocomplete attributes, disable in-flight submission, and attach validation messages to fields.

- [ ] **Step 4: Write failing responsive-navigation tests**

Mock narrow and wide `matchMedia`. Require accessible labels `Mobile navigation` and `Primary navigation`, with Overview, Payments, Transactions, and API Keys links.

- [ ] **Step 5: Implement shell, temporary route screens, docs button, and accessible styles**

The Docs button opens `${API_ORIGIN}/` after a user click. Add visible focus, reduced-motion support, 44px targets, desktop sidebar, and mobile bottom navigation.

- [ ] **Step 6: Verify and commit**

Run auth/shell tests, all tests, and build. Commit as `feat: add ZPay dashboard authentication and navigation`.

---

### Task 5: Honest Overview and Shared Async States

**Files:**
- Create: `dashboard/src/components/AsyncState.tsx`, `CopyButton.tsx`, `CopyButton.test.tsx`
- Create: `dashboard/src/pages/DashboardPage.tsx`, `DashboardPage.test.tsx`
- Modify: `dashboard/src/api/queries.ts`, `dashboard/src/router.tsx`, `dashboard/src/styles.css`

**Interfaces:**
- Produces: freshness-aware `/dashboard`, async-state primitives, full-value clipboard behavior.

- [ ] **Step 1: Write failing dashboard state tests**

Test null amounts render `Not synced`, stale data has a role-alert warning, `100000000` renders `1.00000000 ZEC`, settlement false renders `Settlement disabled`, loading invents no zero, empty lists have actions, and offline mode retains in-memory values behind an offline banner.

- [ ] **Step 2: Verify RED, then implement minimal balance and recent-list queries**

Use skeletons during initial load, `Money` for values, `Intl.DateTimeFormat` for timestamps, and specific empty/error states.

- [ ] **Step 3: Write failing clipboard tests**

Assert the full untruncated value reaches `navigator.clipboard.writeText`, the live region says `Copied`, and failure produces `Copy failed`.

- [ ] **Step 4: Implement clipboard control and verify GREEN**

Use it for addresses, transaction IDs, payment IDs, and key secrets.

- [ ] **Step 5: Verify and commit**

Run focused/full tests and build. Commit as `feat: show freshness-aware ZPay overview`.

---

### Task 6: Idempotent Payments and Details

**Files:**
- Create: `dashboard/src/payments/idempotency.ts`, `idempotency.test.ts`
- Create: `dashboard/src/pages/PaymentsPage.tsx`, `PaymentsPage.test.tsx`
- Create: `dashboard/src/pages/PaymentDetailPage.tsx`, `PaymentDetailPage.test.tsx`
- Modify: `dashboard/src/api/queries.ts`, `dashboard/src/router.tsx`, `dashboard/src/styles.css`

**Interfaces:**
- Produces: immutable `createPaymentAttempt(payload)`, `/payments`, and `/payments/:id`.

- [ ] **Step 1: Write failing idempotency tests**

```ts
const attempt = createPaymentAttempt(payload);
expect(attempt.nextRetry().idempotencyKey).toBe(attempt.idempotencyKey);
expect(createPaymentAttempt(payload).idempotencyKey).not.toBe(attempt.idempotencyKey);
```

Also prove a changed payload cannot retain the prior attempt key.

- [ ] **Step 2: Verify RED, implement with `crypto.randomUUID()`, and verify GREEN**

Keep attempt state in memory only and freeze a copy of reference, amount, and TTL.

- [ ] **Step 3: Write failing payment form/list tests**

Prove integer-string submission, default TTL 1800, TTL range 60–1800, disabled double-submit, 201 navigation, 200 replay recovery, 503 retry with the same header/body, 409 requiring a new attempt, and edit-after-failure generating a new key. Inspect MSW requests rather than mock call counts.

- [ ] **Step 4: Implement payments page and verify GREEN**

Show requested/received amounts, window badge, funding badge, expiry, reference, and details action.

- [ ] **Step 5: Write failing detail tests and implement all state combinations**

Cover provisioning, awaiting, expired unpaid, expired late paid, partial, exact, and overpaid. Show both status families, copyable address/UUID, and countdown that becomes `Expired` without claiming funds vanished.

- [ ] **Step 6: Verify and commit**

Run payment tests, all tests, and build. Commit as `feat: add idempotent ZPay payment workflow`.

---

### Task 7: Received Outputs and API Keys

**Files:**
- Create: `dashboard/src/pages/TransactionsPage.tsx`, `TransactionsPage.test.tsx`
- Create: `dashboard/src/pages/ApiKeysPage.tsx`, `ApiKeysPage.test.tsx`
- Modify: `dashboard/src/api/queries.ts`, `dashboard/src/router.tsx`, `dashboard/src/styles.css`

**Interfaces:**
- Produces: paginated `/transactions` and one-time-secret `/api-keys` workflows.

- [ ] **Step 1: Write failing transaction tests**

Require confirmed/reversed text labels, confirmations, late/unmatched labels, linked request navigation, full txid copying, and safe same-origin pagination derived from API page URLs.

- [ ] **Step 2: Implement desktop table/mobile cards and verify GREEN**

Show pool, output index, amount, block time, confirmations, status, request link, and an audit explanation for reversed outputs.

- [ ] **Step 3: Write failing API-key tests**

Prove create shows the secret once, dismiss removes it, remount cannot recover it, storage contains no secret, list responses contain metadata only, revoke confirmation sends DELETE, cancellation sends nothing, and 204 refreshes metadata.

- [ ] **Step 4: Implement key management and verify GREEN**

Validate name length 1–80. Use an accessible one-time-secret dialog with copy/dismiss. Show prefix, name, created time, revoked time, and revoke action.

- [ ] **Step 5: Verify and commit**

Run focused/full tests and build. Commit as `feat: add ZPay transaction and API key screens`.

---

### Task 8: PWA Safety, Vercel, Documentation, and CI

**Files:**
- Create: `dashboard/src/pwa.test.ts`, `dashboard/.env.example`, `dashboard/README.md`
- Create: `vercel.json`, `.github/workflows/dashboard.yml`
- Modify: `.gitignore`

**Interfaces:**
- Produces: deterministic CI and Vercel SPA artifact with no API response caching.

- [ ] **Step 1: Write a failing production-artifact safety test**

Build to a temporary directory, inspect manifest and worker artifacts, and require ZPay name, standalone display, 192/512/maskable icons, plus absence of `/api/`, `Authorization`, `payment-requests`, `transactions`, and `balance` in precache/runtime-cache entries.

- [ ] **Step 2: Verify RED before deployment files exist**

Run `npm test -- --run src/pwa.test.ts`. Expected: artifact/deployment assertions fail.

- [ ] **Step 3: Add Vercel and environment configuration**

Build `dashboard` with `npm run build`, publish `dashboard/dist`, and rewrite non-assets to `/index.html`. Never proxy API traffic to localhost. `.env.example` contains only `VITE_API_BASE_URL=https://api.example.com`.

```json
{
  "installCommand": "cd dashboard && npm ci",
  "buildCommand": "cd dashboard && npm run build",
  "outputDirectory": "dashboard/dist",
  "rewrites": [{ "source": "/((?!assets/).*)", "destination": "/index.html" }]
}
```

- [ ] **Step 4: Add documentation and CI**

Document local startup, tests, Vercel settings, production CORS origin, HTTPS, session token storage, and scanner freshness. CI uses Node 22, `npm ci`, `npm test -- --run`, and `npm run build` for dashboard-related changes.

```yaml
name: Dashboard
on:
  pull_request:
    paths: ["dashboard/**", "vercel.json", ".github/workflows/dashboard.yml"]
  push:
    paths: ["dashboard/**", "vercel.json", ".github/workflows/dashboard.yml"]
jobs:
  test:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: dashboard
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: dashboard/package-lock.json
      - run: npm ci
      - run: npm test -- --run
      - run: npm run build
```

- [ ] **Step 5: Run the full verification story**

```bash
cd dashboard
npm ci
npm test -- --run
npm run build
cd ..
git diff --check
```

Then run backend tests and `manage.py spectacular --validate --fail-on-warn`. Expected: clean tests/build/schema and no root Tauri input changes.

- [ ] **Step 6: Perform manual responsive/installability checks**

At 360, 768, and 1440 pixels, verify keyboard login, navigation, dialog dismissal, copy feedback, payment retry, pagination, stale/offline states, and install prompt. Confirm offline API requests fail visibly and no financial response is served from service-worker storage.

- [ ] **Step 7: Commit**

```bash
git add dashboard vercel.json .github/workflows/dashboard.yml .gitignore
git commit -m "chore: verify and package ZPay merchant PWA"
```

## Completion Gate

Do not describe the PWA as production-ready until all eight tasks pass, Vercel uses HTTPS to a persistent backend, CORS names the real dashboard origin, and a live Zcash receipt is observed after lightwalletd finishes its cache. The current `sync_wallets --once` failure remains a separate infrastructure gate: preserve the previous snapshot, do not fabricate balances, and inspect the wallet-service log and lightwalletd cache height before retrying.
