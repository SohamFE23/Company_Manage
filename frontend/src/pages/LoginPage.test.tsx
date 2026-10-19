import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./LoginPage";
import { useAuth } from "../auth/useAuth";

vi.mock("../auth/useAuth", () => ({
  useAuth: vi.fn(),
}));

describe("LoginPage", () => {
  const login = vi.fn();

  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: null,
      loading: false,
      login,
      logout: vi.fn(),
      refreshUser: vi.fn(),
    });
    login.mockReset();
    login.mockRejectedValue(new Error("Invalid email or password."));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
  });

  it("offers the renamed local demo accounts in development", () => {
    render(<LoginPage />);

    fireEvent.click(
      screen.getByRole("button", {
        name: /admin@opswork\.local/,
      }),
    );

    expect(
      (screen.getByLabelText("Email address") as HTMLInputElement).value,
    ).toBe("admin@opswork.local");
  });

  it("hides local demo accounts in production", () => {
    vi.stubEnv("PROD", true);
    render(<LoginPage />);

    expect(screen.queryByText("Local demo accounts")).toBeNull();
  });

  it("shows the authentication error after a failed login", async () => {
    render(<LoginPage />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "person@example.test" },
    });
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "bad-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Invalid email or password.",
    );
    expect(login).toHaveBeenCalledWith("person@example.test", "bad-password");
  });
});
