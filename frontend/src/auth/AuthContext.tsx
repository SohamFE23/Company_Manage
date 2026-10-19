
import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { apiLogin, apiRequest } from "../lib/api";
import { AuthContext, type CurrentUser } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    const token = sessionStorage.getItem("opsflow_access_token");

    if (!token) {
      setUser(null);
      return;
    }

    const currentUser = await apiRequest<CurrentUser>("/api/auth/me");
    setUser(currentUser);
  }, []);

  const logout = useCallback(() => {
    sessionStorage.removeItem("opsflow_access_token");
    setUser(null);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await apiLogin(email, password);

      sessionStorage.setItem("opsflow_access_token", result.access_token);

      try {
        await refreshUser();
      } catch (error) {
        sessionStorage.removeItem("opsflow_access_token");
        setUser(null);
        throw error;
      }
    },
    [refreshUser],
  );

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      try {
        await refreshUser();
      } catch {
        sessionStorage.removeItem("opsflow_access_token");
        if (active) setUser(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    void restoreSession();

    const handleUnauthorized = () => {
      if (active) setUser(null);
    };

    window.addEventListener("opsflow:unauthorized", handleUnauthorized);

    return () => {
      active = false;
      window.removeEventListener("opsflow:unauthorized", handleUnauthorized);
    };
  }, [refreshUser]);

  return (
    <AuthContext.Provider
      value={{ user, loading, login, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}
