
import { NavLink, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/useAuth";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import WorkItemsPage from "./pages/WorkItemsPage";
import WorkItemDetailsPage from "./pages/WorkItemDetailsPage";
import TeamsPage from "./pages/TeamsPage";
import TeamDetailsPage from "./pages/TeamDetailsPage";
import "./App.css";

function AuthenticatedApp() {
  const { user, loading, logout } = useAuth();

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

        <NavLink to="/" end className={({ isActive }) => isActive ? "ops-nav-active" : ""}>
          Dashboard
        </NavLink>

        <NavLink to="/work-items" className={({ isActive }) => isActive ? "ops-nav-active" : ""}>
          Work items
        </NavLink>

        <NavLink to="/teams" className={({ isActive }) => isActive ? "ops-nav-active" : ""}>
          Teams
        </NavLink>

        <span className="ops-navigation-spacer" />

        <span className="ops-navigation-user">{user.name}</span>

        {user.is_admin && (
          <NavLink to="/admin/users" className={({ isActive }) => isActive ? "ops-nav-active" : ""}>
            Admin
          </NavLink>
        )}

        <button type="button" onClick={logout}>
          Sign out
        </button>
      </nav>

      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/work-items" element={<WorkItemsPage />} />
        <Route path="/work-items/:id" element={<WorkItemDetailsPage />} />
        <Route path="/teams" element={<TeamsPage />} />
        <Route path="/teams/:id" element={<TeamDetailsPage />} />
        <Route
          path="*"
          element={
            <main className="app-loading">
              <h1>Page not found</h1>
              <NavLink to="/">Return to dashboard</NavLink>
            </main>
          }
        />
      </Routes>
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
