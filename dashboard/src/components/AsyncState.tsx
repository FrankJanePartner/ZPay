import type { ReactNode } from "react";
import { ApiError } from "../api/client";
import { session } from "../auth/session";

export function LoadingSkeleton({ label, className = "" }: { label: string; className?: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      aria-live="polite"
      aria-busy="true"
      className={`loading-skeleton ${className}`.trim()}
    >
      <span className="visually-hidden">{label}</span>
    </div>
  );
}

export function ErrorState({ children, error }: { children: ReactNode; error?: unknown }) {
  if (error instanceof ApiError && error.status === 403) {
    return <div role="alert" className="async-error">
      <p>A dashboard session is required. Integration API keys cannot replace a dashboard session.</p>
      <button type="button" onClick={() => session.clear()}>Sign in again</button>
    </div>;
  }
  return <div role="alert" className="async-error">{children}</div>;
}
