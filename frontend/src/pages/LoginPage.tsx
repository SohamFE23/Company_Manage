
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/useAuth";

const demoAccounts = [
  { label: "Administrator", email: "admin@opsflow.local" },
  { label: "Manager", email: "manager@opsflow.local" },
  { label: "Employee", email: "employee@opsflow.local" },
  { label: "Viewer", email: "viewer@opsflow.local" },
];

export default function LoginPage() {
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      await login(email, password);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Sign-in failed. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <div className="brand-mark">O</div>
        <p className="eyebrow">OPERATIONS UNDER PRESSURE</p>
        <h1>Welcome to OpsFlow</h1>
        <p className="muted">
          Sign in to manage work, coordinate teams, and track important changes.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label htmlFor="email">Email address</label>
          <input
            id="email"
            type="email"
            autoComplete="username"
            placeholder="you@company.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />

          {error && <div className="error-message" role="alert">{error}</div>}

          <button type="submit" disabled={submitting}>
            {submitting ? "Signing in..." : "Sign in"}
          </button>
        </form>

        {!import.meta.env.PROD && (
          <div className="demo-section">
            <p className="demo-title">Local demo accounts</p>
            {demoAccounts.map((account) => (
              <button
                className="demo-account"
                type="button"
                key={account.email}
                onClick={() => setEmail(account.email)}
              >
                <span>{account.label}</span>
                <span className="muted">{account.email}</span>
              </button>
            ))}
            <p className="muted demo-note">
              Demo accounts work only after you run the local seed script.
              Select an account, then enter your demo password.
            </p>
          </div>
        )}
      </section>
    </main>
  );
}
