
import { useState } from "react";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import WorkItemsPage from "./pages/WorkItemsPage";
import "./App.css";

type Page = "dashboard" | "work-items";

function AuthenticatedApp() {
  const { user, loading, logout } = useAuth();
  const [page, setPage] = useState<Page>("dashboard");

  if (loading) {
    return <main className="app-loading">Checking your session...</main>;
  }

  if (!user) {
    return <LoginPage />;
  }

  return (
    <>
      <nav className="ops-navigation" aria-label="Main navigation">
        <span className="ops-navigation-brand">OPS /</span>

        <button
          type="button"
          className={page === "dashboard" ? "ops-nav-active" : ""}
          onClick={() => setPage("dashboard")}
        >
          Dashboard
        </button>

        <button
          type="button"
          className={page === "work-items" ? "ops-nav-active" : ""}
          onClick={() => setPage("work-items")}
        >
          Work items
        </button>

        <span className="ops-navigation-spacer" />

        <span className="ops-navigation-user">{user.name}</span>

        <button type="button" onClick={logout}>
          Sign out
        </button>
      </nav>

      {page === "dashboard" ? <DashboardPage /> : <WorkItemsPage />}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
