# ZPay Merchant PWA Design

Date: 2026-09-17
Status: Approved design
Target branch: `feat/payment-api`

## Purpose

Build an installable, responsive merchant and developer dashboard for the ZPay
Zcash payment API. The dashboard serves account holders who create receiving
addresses, manage API credentials, inspect payment requests, and review wallet
observations. It does not replace the existing Tauri desktop wallet.

The first release is a merchant portal, not a public customer checkout. It must
represent the API honestly: wallet observations can be stale, payment-window
status is distinct from funding status, and settlement is not available.

## Deployment Architecture

The frontend will be a separate React, TypeScript, and Vite project in
`dashboard/`. It will be deployed to Vercel as a Progressive Web App. The
existing root React/Tauri application remains intact.

The persistent backend stack cannot run reliably in Vercel's serverless
environment. Django, PostgreSQL, the Rust wallet service, the scanner worker,
lightwalletd, and Zebra will run on a persistent server or VPS. The browser
connects to Django over HTTPS through an environment-specific API origin.

The dashboard reads the API origin from `VITE_API_BASE_URL`. Local development
uses `http://127.0.0.1:8000`. Django CORS policy will allow only explicit local
development origins and configured production dashboard origins.

## Technology

- React and TypeScript with Vite.
- React Router for application routes and protected navigation.
- TanStack React Query for server state, invalidation, and explicit retries.
- A small typed fetch client for bearer authentication and normalized errors.
- Vitest, React Testing Library, and Mock Service Worker for component and API
  contract tests.
- A Vite PWA integration for the manifest, installability, update behavior, and
  application-shell caching.

Next.js is deliberately excluded because Django already owns server behavior.
The existing Tauri UI is not reused because its local-wallet responsibilities
and runtime assumptions differ from a hosted multi-account portal.

## Routes and Screens

### Public authentication

- `/login` accepts email and password and creates a dashboard session.
- `/register` creates an account and dashboard session.
- Authenticated users visiting either route are redirected to `/dashboard`.

### Protected application

- `/dashboard` shows total, spendable, pending, and cumulative received
  zatoshis; last synchronization time; stale/offline state; recent payment
  requests; and recent received outputs.
- `/payments` creates payment requests and lists the authenticated account's
  requests. Creation accepts reference, amount, and expiry duration.
- `/payments/:id` shows the request UUID, reference, address, requested and
  received amounts, payment-window status, funding status, creation time, and
  expiry. Copy controls are provided for identifiers and addresses.
- `/transactions` shows paginated received output history, confirmations,
  linked payment request, late marker, pool, transaction ID, and reversal state.
- `/api-keys` lists API-key metadata, creates keys, and revokes keys. A newly
  issued secret is displayed once and never reconstructed.
- `/docs` opens the Django Swagger homepage in a new browser tab using the API
  origin.

Desktop uses a sidebar and top status bar. Small screens use compact header and
bottom navigation. Tables become labeled cards on narrow viewports rather than
requiring horizontal scrolling for primary information.

## API and Data Flow

The typed client maps the existing endpoints:

- `POST /api/v1/auth/register/`
- `POST /api/v1/auth/login/`
- `POST /api/v1/auth/logout/`
- `GET|POST /api/v1/keys/`
- `DELETE /api/v1/keys/:id/`
- `GET|POST /api/v1/payment-requests/`
- `GET /api/v1/payment-requests/:id/`
- `GET /api/v1/balance/`
- `GET /api/v1/transactions/`

TanStack Query owns remote records. Successful payment creation invalidates the
payment list and dashboard summaries. Successful key mutation invalidates key
metadata. Background refresh is conservative and stops while the document is
offline; returning online triggers refetches.

Payment creation generates an idempotency key before the first request and
retains it for every retry of the same submitted payload. The submit button is
locked while that operation is in flight. A new key is generated only after the
operation succeeds, the user changes the payload, or the user explicitly starts
a new payment.

Zatoshi values cross the network as decimal strings. Formatting to ZEC uses
string or integer arithmetic and always renders eight decimal places; financial
calculations never use JavaScript floating-point numbers.

## Authentication and Secret Handling

Dashboard bearer tokens are stored in `sessionStorage`. This supports a page
refresh but requires a new login after the browser session closes. Protected
routes redirect to login when no session exists.

API-key secrets remain only in React component memory. The UI provides a copy
action and warns that the value cannot be retrieved again. Closing the one-time
secret view or navigating away discards it. Keys, tokens, addresses, balances,
and transaction responses are never written to local storage, IndexedDB, or the
service-worker cache.

An HTTP 401 clears the session and redirects to login. A 403 explains that a
dashboard session, rather than an API key, is required. Logout calls the API
before clearing the local session, but the local session is cleared even when
the remote logout request fails.

## Status Semantics

The interface keeps these concepts separate:

- Payment-window status: `provisioning`, `awaiting_payment`, or `expired`.
- Funding status: `unpaid`, `partially_paid`, `paid`, or `overpaid`.
- Deposit status: `confirmed` or `reversed`.
- Observation freshness: current-looking data may still be marked stale when
  the scanner reports an error or the last successful snapshot is too old.

Expired requests retain their address and can show late deposits. A reversed
deposit remains visible for audit but is not counted in active received totals.
The dashboard never describes spendable balance as permission to withdraw.

Before the first successful wallet scan, null balances render as "Not synced"
rather than zero. When a prior snapshot exists but is stale, its values remain
visible behind a prominent stale warning with the last synchronized timestamp.

## Error, Loading, Empty, and Offline States

- Skeletons represent initial loading without inventing financial values.
- Empty payments, transactions, and keys have specific calls to action.
- Validation errors remain attached to their fields.
- HTTP 409 on payment creation explains that the idempotency key conflicts with
  a changed payload and requires starting a new payment operation.
- HTTP 429 displays a throttling message and respects `Retry-After` when present.
- HTTP 503 identifies the wallet or node as temporarily unavailable and offers
  a safe retry that retains the idempotency key.
- Network failure shows an offline/unreachable state without replacing the last
  successful in-memory query data.
- Unexpected errors show a stable fallback with retry and navigation actions;
  raw server traces are never displayed.

## PWA Behavior

The manifest defines the ZPay name, standalone display mode, theme colors, and
responsive icons. The service worker caches only versioned frontend assets and
the application shell. API routes and cross-origin API responses use network-only
handling and are never available as authoritative offline financial data.

An update notification lets the user reload when a new frontend version is
ready. Installation is optional: every route continues to work as a normal
responsive website on current desktop and mobile browsers. Platform-specific
limitations on installation do not block use of the website.

## Visual System and Accessibility

The interface uses a dark charcoal foundation with restrained Zcash-gold
accents, high-contrast text, and status colors that are never the sole carrier
of meaning. The layout favors operational clarity over decorative charts.

Cards summarize balances and freshness. Desktop tables become labeled mobile
cards. Long addresses and transaction IDs truncate visually but remain fully
copyable. Controls include visible labels, keyboard focus, accessible names,
adequate targets, semantic headings, and reduced-motion support.

## Testing Strategy

Test-driven development is required for new behavior. Each production behavior
starts with a focused failing test.

Unit tests cover exact zatoshi formatting, API error normalization, session
storage behavior, and idempotency-key lifetime. Component tests cover login,
registration, protected redirects, logout, one-time API-key display, key
revocation, payment creation, retry behavior, stale balances, empty states,
paginated records, offline presentation, and responsive navigation.

Mock Service Worker fixtures mirror the documented Django response shapes and
exercise 400, 401, 403, 409, 429, 503, and network failures. Production checks
run TypeScript compilation, test suite, Vite build, and PWA manifest validation.

Mocked frontend tests do not validate the live Zcash path. Live address
allocation, receipt detection, attribution, balance update, and reorganization
handling remain an integration gate after lightwalletd completes its cache.

## Explicitly Deferred

- Public customer checkout pages.
- Withdrawals and settlement.
- Webhook registration or delivery.
- User profile and organization management.
- Fiat or market-price conversion.
- Testnet selection.
- Replacing or merging the existing Tauri desktop wallet.

These features require separate backend contracts and their own approved design
work rather than placeholders in the first dashboard.

## Acceptance Criteria

The dashboard is complete for this phase when a user can register or log in,
manage API keys, create and inspect idempotent payment requests, view honest
balance freshness, inspect received-output history, open API documentation, and
use the experience across desktop and mobile browsers. It must build as an
installable PWA for Vercel, avoid persistent secret and financial-response
caching, pass its automated tests, and leave the existing Tauri wallet unchanged.
