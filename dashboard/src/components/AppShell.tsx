import { useEffect, useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";
import { useApiCooldown, useConnectivity } from "../api/liveState";

const NARROW_VIEWPORT = "(max-width: 767px)";

const navigationItems = [
  { to: "/dashboard", label: "Overview" },
  { to: "/payments", label: "Payments" },
  { to: "/transactions", label: "Transactions" },
  { to: "/api-keys", label: "API Keys" },
];

function useNarrowViewport(): boolean {
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window.matchMedia === "function"
      ? window.matchMedia(NARROW_VIEWPORT).matches
      : false,
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }

    const media = window.matchMedia(NARROW_VIEWPORT);
    const updateViewport = (event: MediaQueryListEvent) => setIsNarrow(event.matches);
    setIsNarrow(media.matches);
    media.addEventListener("change", updateViewport);
    return () => media.removeEventListener("change", updateViewport);
  }, []);

  return isNarrow;
}

function Navigation({ label, className }: { label: string; className: string }) {
  return (
    <nav aria-label={label} className={className}>
      {navigationItems.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => (isActive ? "navigation-link active" : "navigation-link")}
        >
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { logout } = useAuth();
  const isNarrow = useNarrowViewport();
  const online = useConnectivity();
  const cooldown = useApiCooldown();

  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="brand" to="/dashboard" aria-label="ZPay dashboard">
          ZPay
        </Link>
        <div className="header-actions">
          <Link className="header-link" to="/docs">
            Docs
          </Link>
          <button className="button-secondary" type="button" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>
      <div className="shell-body">
        {!isNarrow ? (
          <aside className="sidebar">
            <Navigation label="Primary navigation" className="primary-navigation" />
          </aside>
        ) : null}
        <main className="app-content">
          <p role={online ? "status" : "alert"} className={online ? "connection-status" : "async-error"}>
            {online ? "Online" : "Offline: retained financial values are not current. Refresh resumes when online."}
          </p>
          {cooldown > 0 ? <p role="status">Request throttled; retry in {cooldown} seconds.</p> : null}
          <Outlet />
        </main>
      </div>
      {isNarrow ? (
        <Navigation label="Mobile navigation" className="mobile-navigation" />
      ) : null}
    </div>
  );
}
