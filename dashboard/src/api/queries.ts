import { API_ORIGIN, ApiError, apiRequest } from "./client";
import type { CreatePaymentPayload } from "../payments/idempotency";
import type {
  DepositOutput,
  IssuedKey,
  KeyMetadata,
  Paginated,
  PaymentRequest,
  SessionResponse,
  WalletBalance,
} from "./types";

export interface Credentials {
  email: string;
  password: string;
}

function requireSession(response: SessionResponse | undefined): SessionResponse {
  if (!response) {
    throw new ApiError({
      status: 204,
      detail: "Invalid API response. Please try again.",
    });
  }

  return response;
}

export async function login(
  credentials: Credentials,
  signal?: AbortSignal,
): Promise<SessionResponse> {
  const response = await apiRequest<SessionResponse>("/api/v1/auth/login/", {
    method: "POST",
    body: JSON.stringify(credentials),
    signal,
  });
  return requireSession(response);
}

export async function register(
  credentials: Credentials,
  signal?: AbortSignal,
): Promise<SessionResponse> {
  const response = await apiRequest<SessionResponse>("/api/v1/auth/register/", {
    method: "POST",
    body: JSON.stringify(credentials),
    signal,
  });
  return requireSession(response);
}

export async function logout(): Promise<void> {
  await apiRequest("/api/v1/auth/logout/", { method: "POST" });
}

export async function getWalletBalance(signal?: AbortSignal): Promise<WalletBalance> {
  const response = await apiRequest<WalletBalance>("/api/v1/balance/", { signal });
  if (!response) {
    throw new ApiError({ status: 204, detail: "Invalid API response. Please try again." });
  }
  return response;
}

export async function getRecentTransactions(signal?: AbortSignal): Promise<Paginated<DepositOutput>> {
  return getTransactions("/api/v1/transactions/", signal);
}

function paginationPath(pageUrl: string, expectedPath: string): string {
  let resolved: URL;
  try {
    resolved = new URL(pageUrl, `${API_ORIGIN}/`);
  } catch {
    throw new ApiError({ status: 0, detail: "Invalid pagination URL." });
  }

  if (
    resolved.origin !== new URL(API_ORIGIN).origin ||
    resolved.pathname !== expectedPath ||
    resolved.username ||
    resolved.password ||
    resolved.hash
  ) {
    throw new ApiError({ status: 0, detail: "Invalid pagination URL." });
  }

  return `${resolved.pathname}${resolved.search}`;
}

export async function getTransactions(
  pageUrl = "/api/v1/transactions/",
  signal?: AbortSignal,
): Promise<Paginated<DepositOutput>> {
  const response = await apiRequest<Paginated<DepositOutput>>(paginationPath(pageUrl, "/api/v1/transactions/"), {
    signal,
  });
  if (!response) {
    throw new ApiError({ status: 204, detail: "Invalid API response. Please try again." });
  }
  return response;
}

export async function getApiKeys(signal?: AbortSignal): Promise<KeyMetadata[]> {
  const response = await apiRequest<KeyMetadata[]>("/api/v1/keys/", { signal });
  if (!response) {
    throw new ApiError({ status: 204, detail: "Invalid API response. Please try again." });
  }
  return response.map(({ id, name, prefix, created_at, revoked_at }) => ({
    id,
    name,
    prefix,
    created_at,
    revoked_at,
  }));
}

export async function createApiKey(name: string, signal?: AbortSignal): Promise<IssuedKey> {
  const response = await apiRequest<IssuedKey>("/api/v1/keys/", {
    method: "POST",
    body: JSON.stringify({ name }),
    signal,
  });
  if (!response) {
    throw new ApiError({ status: 204, detail: "Invalid API response. Please try again." });
  }
  return response;
}

export async function revokeApiKey(id: string, signal?: AbortSignal): Promise<void> {
  await apiRequest(`/api/v1/keys/${encodeURIComponent(id)}/`, {
    method: "DELETE",
    signal,
  });
}

export async function getPayments(pageUrl = "/api/v1/payment-requests/", signal?: AbortSignal): Promise<Paginated<PaymentRequest>> {
  const response = await apiRequest<Paginated<PaymentRequest>>(paginationPath(pageUrl, "/api/v1/payment-requests/"), {
    signal,
  });
  if (!response) {
    throw new ApiError({ status: 204, detail: "Invalid API response. Please try again." });
  }
  return response;
}

export async function getPayment(id: string, signal?: AbortSignal): Promise<PaymentRequest> {
  const response = await apiRequest<PaymentRequest>(
    `/api/v1/payment-requests/${encodeURIComponent(id)}/`,
    { signal },
  );
  if (!response) {
    throw new ApiError({ status: 204, detail: "Invalid API response. Please try again." });
  }
  return response;
}

export async function createPayment(
  payload: Readonly<CreatePaymentPayload>,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<PaymentRequest> {
  const response = await apiRequest<PaymentRequest>("/api/v1/payment-requests/", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(payload),
    signal,
  });
  if (!response) {
    throw new ApiError({ status: 204, detail: "Invalid API response. Please try again." });
  }
  return response;
}
