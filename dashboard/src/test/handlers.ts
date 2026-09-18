import { http, HttpResponse } from "msw";

export const API_ORIGIN = "http://127.0.0.1:8000";

export const handlers = [
  http.get(`${API_ORIGIN}/api/v1/payment-requests/`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
  http.get(`${API_ORIGIN}/api/v1/health/`, () =>
    HttpResponse.json({
      service: "ZPay API",
      status: "ok",
      settlement_enabled: false,
    }),
  ),
  http.get(`${API_ORIGIN}/api/v1/balance/`, () =>
    HttpResponse.json({
      total_zatoshis: null,
      spendable_zatoshis: null,
      pending_zatoshis: null,
      confirmed_received_zatoshis: null,
      chain_height: null,
      synced_at: null,
      stale: true,
      sync_error: "",
      settlement_enabled: false,
    }),
  ),
  http.get(`${API_ORIGIN}/api/v1/transactions/`, () =>
    HttpResponse.json({ count: 0, next: null, previous: null, results: [] }),
  ),
];
