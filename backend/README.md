# ZPay API — foundation

This branch adds the API foundation alongside the existing desktop wallet.
It is NOT yet a complete payment processor. Live address allocation, payment
scanning/attribution, balances, transaction history, signed webhooks, withdrawals,
dashboard UI and deployment are still pending. No endpoint accepts client claims
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
The current Python adapter is not evidence this Rust contract is implemented.

## Next delivery gates

1. Extract Rust wallet runtime from Tauri; persistent allocation and encrypted
   secret storage, configurable testnet/mainnet and scan checkpoints.
2. Ingest verified per-output deposits; deduplicate by transaction/pool/output,
   handle confirmations/reorgs and pending vs confirmed accounting.
3. Add late/partial/excess payment handling, outbox and signed webhook retries.
4. Add account dashboard and complete real network integration tests.
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
