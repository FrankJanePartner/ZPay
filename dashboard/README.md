# ZPay Merchant Dashboard

The dashboard is a Vite/React progressive web app for a merchant's ZPay account. It reads balances and received outputs from the ZPay API; it never treats browser state or a service-worker cache as financial truth.

## Local development

Use Node.js 22. Start the API first, following `../backend/README.md`, then run:

```sh
cp .env.example .env.local
npm ci
npm run dev
```

For the local API, set `VITE_API_BASE_URL=http://127.0.0.1:8000` in `.env.local`. This is the only public frontend environment variable. Values prefixed with `VITE_` are compiled into browser code, so never put tokens, API keys, wallet credentials, seeds, or other secrets in a dashboard environment file.

The development server prints its local URL. Register or sign in there; do not expose the Django development server to public traffic.

## Tests and production build

```sh
npm test -- --run
npm run build
npm run preview
```

The PWA artifact test makes a separate temporary production build and checks the install manifest, service worker, and Vercel output contract. The service worker precaches only the versioned frontend assets and application shell. It has no runtime cache for API responses, authorization material, payment requests, transactions, or balances. Offline API calls must fail visibly; cached account values in the in-memory query client are display-only and are marked stale or offline when refresh fails.

## Authentication and API keys

Dashboard bearer tokens are held in `sessionStorage`, so they are scoped to the browser tab and removed when the tab session ends or the API rejects the session. This reduces persistence but does not protect against script running in the same origin. Keep a strict dependency and content-security policy, serve only over HTTPS, and never persist an issued integration key in browser storage. Newly issued API-key secrets are displayed once and must be copied to the merchant's server-side secret store.

## Vercel and API deployment

Connect the repository through Vercel Git integration. The root `vercel.json` installs and builds `dashboard`, publishes `dashboard/dist`, and sends client-side SPA routes to `index.html`. GitHub Actions is only a deterministic test/build gate; it does not deploy and needs no `VERCEL_TOKEN`.

Configure `VITE_API_BASE_URL` in the Vercel Preview and Production environments with the persistent backend's public `https://` origin. Do not use localhost, a laptop, or an ephemeral development server. The backend must explicitly allow the real dashboard origin in its CORS configuration and use production HTTPS/secure-cookie/proxy settings. Do not add an API proxy or backend secret to this frontend project.

Before calling the system production-ready, verify the deployed dashboard and API over HTTPS, confirm CORS from the exact dashboard origin, and observe a live Zcash receipt after lightwalletd has reached a current cache height. The scanner's `synced_at`, `chain_height`, and `stale` fields describe the last successful local-node scan, not independent global-chain freshness. If `sync_wallets --once` fails, preserve the prior snapshot, inspect the wallet-service log and lightwalletd cache height, and retry only after the infrastructure problem is understood. Never fabricate a zero balance or mark stale data fresh.
