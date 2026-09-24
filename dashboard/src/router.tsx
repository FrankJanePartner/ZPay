import { Navigate, Outlet, type RouteObject } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { ProtectedRoute } from "./auth/ProtectedRoute";
import { AppShell } from "./components/AppShell";
import { ApiKeysPage } from "./pages/ApiKeysPage";
import { DocsPage } from "./pages/DocsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { PaymentDetailPage } from "./pages/PaymentDetailPage";
import { PaymentsPage } from "./pages/PaymentsPage";
import { RegisterPage } from "./pages/RegisterPage";
import { SendPage } from "./pages/SendPage";
import { TransactionsPage } from "./pages/TransactionsPage";
import { RouteErrorPage } from "./components/RouteErrorPage";

function PublicOnlyRoute() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <Navigate to="/dashboard" replace /> : <Outlet />;
}

export const appRoutes: RouteObject[] = [
  { errorElement: <RouteErrorPage />, children: [
  { path: "/", element: <Navigate to="/dashboard" replace /> },
  {
    element: <PublicOnlyRoute />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/register", element: <RegisterPage /> },
    ],
  },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: "/dashboard", element: <DashboardPage /> },
          { path: "/payments", element: <PaymentsPage /> },
          { path: "/payments/:id", element: <PaymentDetailPage /> },
          { path: "/transactions", element: <TransactionsPage /> },
          { path: "/send", element: <SendPage /> },
          { path: "/api-keys", element: <ApiKeysPage /> },
          { path: "/docs", element: <DocsPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <Navigate to="/dashboard" replace /> },
  ] },
];
