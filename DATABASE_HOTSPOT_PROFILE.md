# Database hotspot profiling review

Scope: Django payment API query paths. Instrumented regression tests use `CaptureQueriesContext` to capture the SQL query count in API requests.

## Hotspots examined

| Path | Query behavior | Result |
| --- | --- | --- |
| Payment list | Annotates active deposit totals in SQL, avoiding one aggregation per listed payment | Existing regression test enforces at most 5 queries for 3 payments |
| Payment detail | Serializer falls back to one aggregate query for deposits | New test creates 12 deposits and enforces at most 6 queries |
| Send list | Uses a filtered `SendRequest` queryset with pagination; serializer accesses scalar fields | No per-item related object traversal found |
| Credential lookup | `Login` and `ConfirmLegacyMigrate` use `select_related("owner")` | Avoids a second owner lookup for credential validation |
| Recovery flows | Small existence checks and conditional writes | Multiple round trips are intentional authorization/recovery checks |
| Payment creation | `get_or_create`, external address allocation, guarded conditional update and refresh | External service latency likely dominates; do not combine remote calls into DB transactions |
| Send creation | Idempotent claim/transition operations | Avoid collapsing database state transitions that protect against duplicate sends |

## Measured coverage and limits

The two payment API tests are executable query-count measurements in Django CI. The new payment-detail test creates 12 deposits and checks the total and SQL query bound. This is a *query-count* profile, not a wall-clock latency benchmark. A real database query-plan / latency benchmark remains in milestone 10.

## Follow-up

- If a real PostgreSQL deployment shows slow list pagination, inspect `EXPLAIN ANALYZE` for owner/time ordering and active-deposit aggregation.
- If payment detail becomes a high-volume endpoint, consider annotating its active-deposit sum directly, reducing the extra aggregate query.
- Benchmark request latency and production-sized datasets separately before adding indexes or caches.
