import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  login as requestLogin,
  logout as requestLogout,
  register as requestRegister,
  type Credentials,
} from "../api/queries";
import { session } from "./session";

interface AuthContextValue {
  isAuthenticated: boolean;
  login: (credentials: Credentials, signal?: AbortSignal) => Promise<boolean>;
  register: (credentials: Credentials, signal?: AbortSignal) => Promise<boolean>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(() => session.getToken());
  const mounted = useRef(false);
  const authGeneration = useRef(0);
  const activeToken = useRef(session.getToken());

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = session.subscribe((nextToken) => {
      if (activeToken.current !== nextToken) {
        authGeneration.current += 1;
        activeToken.current = nextToken;
        queryClient.clear();
      }
      setToken(nextToken);
    });

    return () => {
      mounted.current = false;
      authGeneration.current += 1;
      unsubscribe();
    };
  }, [queryClient]);

  const authenticate = useCallback(
    async (
      request: typeof requestLogin,
      credentials: Credentials,
      signal?: AbortSignal,
    ): Promise<boolean> => {
      const generation = ++authGeneration.current;
      const response = await request(credentials, signal);

      if (!mounted.current || signal?.aborted || generation !== authGeneration.current) {
        return false;
      }

      session.setToken(response.token);
      return true;
    },
    [],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: token !== null,
      login(credentials, signal) {
        return authenticate(requestLogin, credentials, signal);
      },
      register(credentials, signal) {
        return authenticate(requestRegister, credentials, signal);
      },
      async logout() {
        authGeneration.current += 1;
        try {
          await requestLogout();
        } catch {
          // Ending the browser session must not depend on API availability.
        } finally {
          session.clear();
        }
      },
    }),
    [authenticate, token],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return value;
}
