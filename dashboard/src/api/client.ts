import { session } from "../auth/session";
import type { ApiErrorFields } from "./types";
import { apiCooldown } from "./cooldown";

const environment = (import.meta as ImportMeta & {
  env?: { VITE_API_BASE_URL?: string };
}).env;

export const API_ORIGIN = (environment?.VITE_API_BASE_URL ?? "http://127.0.0.1:8000").replace(/\/+$/, "");

const GENERIC_ERROR_DETAIL = "Request failed. Please try again.";
const NETWORK_ERROR_DETAIL = "Network request failed. Check your connection and try again.";
const INVALID_PATH_DETAIL = "Invalid API path.";
const INVALID_RESPONSE_DETAIL = "Invalid API response. Please try again.";
const MAX_RETRY_AFTER_SECONDS = 86_400;

export class ApiError extends Error {
  readonly status: number;
  readonly detail: string;
  readonly fields: ApiErrorFields | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor({
    status,
    detail,
    fields,
    retryAfterSeconds,
  }: {
    status: number;
    detail: string;
    fields?: ApiErrorFields;
    retryAfterSeconds?: number;
  }) {
    super(detail);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.fields = fields;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeDetail(value: unknown): string {
  if (typeof value !== "string") {
    return GENERIC_ERROR_DETAIL;
  }

  const detail = value.trim();
  if (
    !detail ||
    detail.length > 300 ||
    /<\/?[a-z][^>]*>|&(?:lt|gt);|traceback|stack trace|(?:^|[\r\n])\s*at\s+[\w$.]+\(.*\)|\b(?:[a-z_$][\w$]*\.)+(?:[a-z_$][\w$]*(?:exception|error)|exception|error)\s*:/i.test(detail)
  ) {
    return GENERIC_ERROR_DETAIL;
  }

  return detail;
}

function extractFields(value: unknown): ApiErrorFields | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const fields = Object.entries(value).reduce<ApiErrorFields>((result, [key, fieldValue]) => {
    if (key === "detail") {
      return result;
    }
    if (typeof fieldValue === "string") {
      result[key] = safeDetail(fieldValue);
    } else if (Array.isArray(fieldValue) && fieldValue.every((item) => typeof item === "string")) {
      result[key] = fieldValue.map(safeDetail);
    }
    return result;
  }, {});

  return Object.keys(fields).length > 0 ? fields : undefined;
}

function retryAfterSeconds(header: string | null): number | undefined {
  const value = header?.trim();
  if (!value) {
    return undefined;
  }

  if (/^[0-9]+$/.test(value)) {
    const seconds = Number(value);
    return Number.isFinite(seconds) ? Math.min(seconds, MAX_RETRY_AFTER_SECONDS) : MAX_RETRY_AFTER_SECONDS;
  }

  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }

  const seconds = Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
  return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
}

function isJsonMediaType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim() ?? "";
  return /^application\/(?:[a-z0-9!#$&^_.+-]+\+)?json$/i.test(mediaType);
}

async function errorBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!isJsonMediaType(contentType)) {
    return undefined;
  }

  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function requestUrl(path: string): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new ApiError({ status: 0, detail: INVALID_PATH_DETAIL });
  }

  const apiUrl = new URL(API_ORIGIN);
  const resolvedUrl = new URL(path, `${API_ORIGIN}/`);
  if (resolvedUrl.origin !== apiUrl.origin) {
    throw new ApiError({ status: 0, detail: INVALID_PATH_DETAIL });
  }

  return resolvedUrl.toString();
}

async function successBody<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!isJsonMediaType(contentType)) {
    throw new ApiError({ status: response.status, detail: INVALID_RESPONSE_DETAIL });
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new ApiError({ status: response.status, detail: INVALID_RESPONSE_DETAIL });
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T | undefined> {
  const url = requestUrl(path);
  const headers = new Headers(init.headers);
  const token = session.getToken();
  const remaining = apiCooldown.remaining();
  if (remaining > 0) {
    throw new ApiError({ status: 429, detail: `Request throttled; retry in ${remaining} seconds.`, retryAfterSeconds: remaining });
  }

  headers.set("Accept", "application/json");
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (init.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiError({ status: 0, detail: NETWORK_ERROR_DETAIL });
  }

  if (response.status === 204) {
    return undefined;
  }

  if (!response.ok) {
    const body = await errorBody(response);
    const delay = retryAfterSeconds(response.headers.get("Retry-After"));
    if ((response.status === 429 || response.status === 503) && delay !== undefined && session.getToken() === token) {
      apiCooldown.defer(delay);
    }
    if (response.status === 401 && token !== null && session.getToken() === token) {
      session.clear();
    }
    throw new ApiError({
      status: response.status,
      detail: safeDetail(isRecord(body) ? body.detail : undefined),
      fields: extractFields(body),
      retryAfterSeconds: delay,
    });
  }

  return successBody<T>(response);
}
