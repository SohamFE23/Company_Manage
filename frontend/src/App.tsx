
import { AuthProvider, useAuth } from "./auth/AuthContext";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import "./App.css";

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <main className="app-loading">
        Checking your session...
      </main>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <DashboardPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}
