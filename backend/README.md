# ZPay API — foundation

This branch adds the API foundation alongside the existing desktop wallet.
Live address allocation and a mined-deposit scanner, balances and received-output
history are implemented. Signed webhooks, withdrawals, dashboard UI, deployment
and live end-to-end validation are still pending. No endpoint accepts client claims
that a payment has been made. No mock addresses are used outside tests.

## Local setup (Windows PowerShell)

From F:\ZPay:

```powershell
py -3 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt
$env:ZPAY_DEBUG = "1"
backend/.venv/Scripts/python.exe backend/manage.py migrate
backend/.venv/Scripts/python.exe backend/manage.py test payments -v 2
backend/.venv/Scripts/python.exe backend/manage.py runserver 127.0.0.1:8000
```

Use Python 3.12 or 3.13 for this setup. SQLite is for local development;
CI uses PostgreSQL. DATABASE_URL selects PostgreSQL.
Visit http://127.0.0.1:8000/health/ for process liveness, not wallet readiness.

## Endpoints

All routes have trailing slashes. JSON requests and responses.

| Method | Route | Authentication |
| --- | --- | --- |
| POST | /api/v1/auth/register/ | None; email and password (12+ characters) |
| POST | /api/v1/auth/login/ | None; email and password |
| POST | /api/v1/auth/logout/ | Dashboard bearer token |
| GET, POST | /api/v1/keys/ | Dashboard bearer token; POST takes name |
| DELETE | /api/v1/keys/{id}/ | Dashboard bearer token |
| GET, POST | /api/v1/payment-requests/ | API key or dashboard bearer token |
| GET | /api/v1/payment-requests/{id}/ | API key or dashboard bearer token |

Register/login return a 12-hour bearer token. API keys are returned once when
created and stored as SHA-256 digests. They cannot create more keys.
Use Authorization: Bearer <token-or-key>. Keep integration keys on the
merchant's backend, never inside browser JavaScript.

POST payment request example:

```json
{"reference":"private-bill-order-1","amount_zatoshis":"100000","ttl_seconds":1800}
```

Supply Idempotency-Key: private-bill-order-1. Amount is an integer string
in zatoshis (100,000,000 = 1 ZEC). TTL is 60–1800 seconds.
Retries with identical payload return the same request/address. Changed payload
with the same key returns 409. Unconfigured/unavailable wallet returns 503;
retry with the SAME key. Request identity survives the failure.

Expiry starts only when allocation is recorded successfully. Expiry is computed
on reads, so it does not depend on a scheduled deletion job. The address and
mapping are retained permanently; the future scanner must keep monitoring them.
Expired orders must not automatically settle on late payment.

## Private Rust service contract — to implement next

ZPAY_WALLET_URL and ZPAY_WALLET_TOKEN configure the server-owned dependency.
POST /v1/addresses takes merchant_id and request_id strings; returns
merchant_id, request_id and address. Requests use bearer authentication.

The Rust service MUST persistently allocate exactly one address per
(merchant_id, request_id), including concurrent calls, restarts and lost HTTP
responses. It must bind the address to the correct merchant wallet, validate
the network and address receivers through Zcash libraries, back up recoverable
key material before returning an address, and expose no seeds in HTTP responses.
The companion wallet-service implements allocation and scanning using the pinned SDK.

## Next delivery gates

1. Validate live receipt, address attribution and recovery against the local node.
2. Add configurable testnet support and exercise real chain reorganizations.
3. Add outbox and signed webhook retries, then withdrawals with an explicit policy.
4. Add the account dashboard.
5. Deploy behind HTTPS with PostgreSQL, shared rate limiting, monitoring,
   backup/restore verification and a continuously running wallet scanner.

Do not expose this development server to public traffic. Production settings
require ZPAY_SECRET_KEY, HTTPS and explicit ZPAY_ALLOWED_HOSTS. The current
per-process throttles are development protection, not a production rate limiter.
Dependencies use bounded version ranges for this first build; lock exact versions
after validation before deployment.

Framework references:
https://docs.djangoproject.com/en/5.2/
https://www.django-rest-framework.org/api-guide/authentication/


### Interactive API documentation

Open http://localhost:8000/ for Swagger UI. All existing public operations have
request/response examples, bearer authentication and documented errors. Register
or log in, paste the returned token (without `Bearer `) into Authorize, then create
an API key. Use that key to exercise payment requests. No separate docs URL is needed;
the UI loads OpenAPI from `/?schema=1`. Examples contain fictional credentials.
Swagger assets are bundled with drf-spectacular-sidecar, not fetched from a CDN.
For deployment, run `python manage.py collectstatic --noinput` and serve STATIC_ROOT
at STATIC_URL through the deployment's static file server.

### Deposit scanning and history

Keep the Rust service and lightwalletd running. In a separate terminal, configure
ZPAY_DEBUG, ZPAY_WALLET_URL and ZPAY_WALLET_TOKEN as for Django, then run:

```
python manage.py migrate
python manage.py sync_wallets --once
python manage.py sync_wallets --interval 30
```

The worker scans only accounts with allocated addresses. Each merchant scan has a
120-second service timeout; large backlogs may require repeated scans. A complete
scan atomically replaces active mined observations. Failures preserve the prior
snapshot and mark it stale. Run one worker; per-account database leases also prevent
overlapping imports. The service serializes sync with allocation, so address requests
may need idempotent retries while a scan runs. This is an MVP throughput limitation.

GET /api/v1/balance/ returns SDK balances, synced_at, chain_height and stale. Values
are null before the first successful scan, never invented zero balances. Freshness
is relative to the last local-node scan, not an independent proof of global chain tip.
GET /api/v1/transactions/ returns paginated received outputs, including reversed
records for audit. This version lists mined deposits only, not mempool payments or
outgoing transaction history. Confirmations use the snapshot height. External
outputs without a matching payment address remain attributed to the wallet owner,
with payment_request=null. Internal transfers/change are excluded from receipt totals.

Payment responses include received_zatoshis and funding_status (unpaid,
partially_paid, paid, overpaid), based on active mined receipts at the last scan.
The existing status remains the payment-window state. Always check balance.stale.
Expiry does not remove address mappings. The late flag compares block time to expiry;
it cannot establish when a sender first broadcast a transaction.

No withdrawal, settlement or webhook is enabled by this change. Back up wallet data
and its encryption key before any live deposit test. A full live receive/reorg exercise
is still needed before production use.
