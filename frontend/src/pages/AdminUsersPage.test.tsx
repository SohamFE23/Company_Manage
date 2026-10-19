import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { AuthContext } from "../auth/auth-context";
import type { AuthContextValue } from "../auth/auth-context";
import AdminUsersPage from "./AdminUsersPage";

describe("AdminUsersPage route guard", () => {
  it("redirects non-admin users to the dashboard", async () => {
    const auth: AuthContextValue = {
      user: {
        id: 3,
        name: "Viewer",
        email: "viewer@example.test",
        is_admin: false,
        teams: [],
      },
      loading: false,
      login: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(),
    };

    render(
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={["/admin/users"]}>
          <Routes>
            <Route path="/admin/users" element={<AdminUsersPage />} />
            <Route path="/" element={<p>Dashboard route</p>} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>,
    );

    expect(await screen.findByText("Dashboard route")).toBeTruthy();
    expect(screen.queryByText("User management.")).toBeNull();
  });
});
