import { session } from "../auth/session";

let deadline = 0;
const listeners = new Set<() => void>();
function notify() { listeners.forEach((listener) => listener()); }

// DRF's user/anonymous throttles span endpoints. Keep their deadline only in memory.
session.subscribe(() => { deadline = 0; notify(); });

export const apiCooldown = {
  getDeadline: () => deadline,
  remaining: () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)),
  defer(seconds: number) {
    deadline = Math.max(deadline, Date.now() + Math.min(86_400, Math.max(0, seconds)) * 1000);
    notify();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
