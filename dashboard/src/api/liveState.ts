import { useEffect, useState, useSyncExternalStore } from "react";
import { apiCooldown } from "./cooldown";

export function useConnectivity() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("online", connected);
    window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("online", connected);
      window.removeEventListener("offline", disconnected);
    };
  }, []);
  return online;
}

export function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function useApiCooldown() {
  const deadline = useSyncExternalStore(apiCooldown.subscribe, apiCooldown.getDeadline);
  const now = useClock();
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function useFinancialRefresh() {
  const online = useConnectivity();
  const cooldown = useApiCooldown();
  return {
    enabled: online && cooldown === 0,
    refetchInterval: online && cooldown === 0 ? 30_000 : false as const,
    refetchIntervalInBackground: false,
    refetchOnReconnect: "always" as const,
    refetchOnWindowFocus: false,
    retry: false,
  };
}
