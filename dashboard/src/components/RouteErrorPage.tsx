import { Link } from "react-router-dom";

export function RouteErrorPage() {
  return <main className="auth-layout">
    <section className="auth-card" aria-labelledby="route-error-title">
      <h1 id="route-error-title">Something went wrong</h1>
      <p>This screen could not be displayed. Reload it or open another page to continue.</p>
      <div className="error-actions">
        <button type="button" onClick={() => window.location.reload()}>Reload page</button>
        <Link to="/payments">Go to payments</Link>
        <Link to="/dashboard">Go to overview</Link>
      </div>
    </section>
  </main>;
}
