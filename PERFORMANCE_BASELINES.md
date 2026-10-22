# Performance baselines: audit branch

Recorded 2026-10-22. These are **tested query-count ceilings**, not wall-clock timings or production benchmarks. They provide a repeatable starting point for milestone 10.

| Operation | Test workload | Existing assertion | CI evidence |
| --- | --- | --- | --- |
| Payment list | Three payment requests, one active and one inactive deposit each | HTTP 200, correct active totals, no more than five database queries | Backend CI passed for commit 31c33eb |
| Payment detail | One payment request with twelve active deposits | HTTP 200, received total 120 zatoshis, no more than six database queries | Backend CI passed for commit 31c33eb |

The tests use Django's `CaptureQueriesContext`, count all SQL statements during the HTTP request, and exercise the actual API response. The numbers are *upper bounds*, not observed exact query counts.

## Reproduction

From `backend` in a configured development/test environment:

```bash
python manage.py test payments.tests.PaymentAPITests.test_payment_list_aggregates_active_deposits payments.tests.PaymentAPITests.test_payment_detail_query_count_with_deposits
```

## Missing measurements for remaining milestone 10 tasks

- p50/p95/p99 HTTP response latency under concurrency on representative PostgreSQL
- transaction creation and broadcast latency (with simulated wallet responses)
- desktop startup, wallet-open and history-render timing
- database `EXPLAIN ANALYZE` plans and CPU/memory under production-sized datasets

Do not treat these baseline ceilings as evidence that production performance is acceptable. The separate benchmarking and improvement-verification tasks remain open.
