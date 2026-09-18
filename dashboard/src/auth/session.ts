const TOKEN_KEY = "zpay.dashboard.token";
type SessionListener = (token: string | null) => void;

const listeners = new Set<SessionListener>();

function notify(token: string | null): void {
  listeners.forEach((listener) => listener(token));
}

function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

function setToken(token: string): void {
  if (!token.trim()) {
    throw new Error("Dashboard token cannot be blank");
  }

  sessionStorage.setItem(TOKEN_KEY, token);
  notify(token);
}

function clear(): void {
  sessionStorage.removeItem(TOKEN_KEY);
  notify(null);
}

function subscribe(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const session = { getToken, setToken, clear, subscribe };
