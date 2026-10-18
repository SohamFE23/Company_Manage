
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { apiRequest } from "../lib/api";

export type TeamAccess = {
  id: number;
  name: string;
  role: string;
};

export type CurrentUser = {
  id: number;
  name: string;
  email: string;
  is_admin: boolean;
  teams: TeamAccess[];
};

type AuthContextValue = {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

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
      const body = new URLSearchParams();
      body.set("username", email.trim().toLowerCase());
      body.set("password", password);

      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"}/api/auth/login`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
      );

      if (!response.ok) {
        let message = "Unable to sign in.";
        try {
          const result = await response.json();
          message = result.detail ?? message;
        } catch {
          // Keep the fallback message.
        }
        throw new Error(message);
      }

      const result: { access_token: string; token_type: string } =
        await response.json();

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

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }

  return context;
}
