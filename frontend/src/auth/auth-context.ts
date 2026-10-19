import { createContext } from "react";
import type { TeamRole } from "../types";

export type TeamAccess = {
  id: number;
  name: string;
  role: TeamRole;
};

export type CurrentUser = {
  id: number;
  name: string;
  email: string;
  is_admin: boolean;
  teams: TeamAccess[];
};

export type AuthContextValue = {
  user: CurrentUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(
  undefined,
);
