import { API_ORIGIN, ApiError } from "./client";
import { session } from "../auth/session";

export async function exportTransactionsCsv(start: string, end: string): Promise<void> {
  const token = session.getToken();
  if (!token) throw new ApiError({ status: 401, detail: "Sign in to export transactions." });
  const url = new URL("/api/v1/transactions/export/", API_ORIGIN);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "text/csv" },
      cache: "no-store",
    });
  } catch {
    throw new ApiError({ status: 0, detail: "Could not reach the server. Try again." });
  }
  if (!response.ok) {
    let detail = "Unable to export transactions. Check the dates and try again.";
    if (response.status === 401 || response.status === 403) detail = "Session expired or access denied. Please sign in again.";
    else if (response.status === 400) detail = "Invalid date range. Select valid start and end dates, up to 366 days.";
    throw new ApiError({ status: response.status, detail });
  }
  if (!(response.headers.get("Content-Type") ?? "").toLowerCase().includes("text/csv")) {
    throw new ApiError({ status: 502, detail: "The server did not return a CSV file." });
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `zoerdwallet_transactions_${start}_${end}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
}
