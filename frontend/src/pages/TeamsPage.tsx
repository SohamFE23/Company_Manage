import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ApiError, apiRequest } from "../lib/api";
import type { Team } from "../types";
import { label } from "../types";
import "./TeamsPage.css";

export default function TeamsPage() {
  const { user } = useAuth();
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.resolve()
      .then(() => apiRequest<Team[]>("/api/teams"))
      .then((result) => {
        if (active) {
          setTeams(result);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof ApiError ? err.message : "Could not load teams.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [refreshKey]);

  async function createTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();

    if (name.length < 2) {
      setError("Team name must contain at least 2 characters.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");
    try {
      await apiRequest<Team>("/api/teams", {
        method: "POST",
        body: JSON.stringify({ name, description: description || null }),
      });
      setShowCreate(false);
      setNotice("Team created successfully.");
      setLoading(true);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not create the team.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="teams-page">
      <header className="teams-heading">
        <div>
          <p className="teams-eyebrow">OPS / WORKSPACE</p>
          <h1>Teams<span>.</span></h1>
          <p className="teams-subtitle">
            The people and shared work behind every operation.
          </p>
        </div>
        {user?.is_admin && (
          <button
            type="button"
            className="teams-primary"
            onClick={() => {
              setError("");
              setShowCreate((value) => !value);
            }}
          >
            {showCreate ? "Cancel" : "+ New team"}
          </button>
        )}
      </header>

      {notice && <div className="teams-notice" role="status">{notice}</div>}
      {error && (
        <div className="teams-error" role="alert">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setRefreshKey((value) => value + 1);
            }}
          >
            Retry
          </button>
        </div>
      )}

      {showCreate && user?.is_admin && (
        <section className="teams-panel">
          <p className="teams-eyebrow">NEW TEAM</p>
          <h2>Create a team</h2>
          <form className="teams-form" onSubmit={createTeam}>
            <label>
              Name
              <input name="name" required minLength={2} maxLength={120} />
            </label>
            <label>
              Description
              <textarea name="description" rows={3} maxLength={2000} />
            </label>
            <div className="teams-actions">
              <button
                className="teams-secondary"
                type="button"
                onClick={() => setShowCreate(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button className="teams-primary" type="submit" disabled={saving}>
                {saving ? "Creating..." : "Create team"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="teams-panel">
        <div className="teams-list-heading">
          <div>
            <p className="teams-eyebrow">YOUR SCOPE</p>
            <h2>Available teams</h2>
          </div>
          <span className="teams-count">{teams.length} teams</span>
        </div>

        {loading ? (
          <div className="teams-empty">Loading teams...</div>
        ) : teams.length === 0 ? (
          <div className="teams-empty">
            <strong>No teams available.</strong>
            <p>
              {user?.is_admin
                ? "Create a team to start organizing work."
                : "Ask a team manager to add you to a team."}
            </p>
          </div>
        ) : (
          <div className="teams-grid">
            {teams.map((team) => (
              <article className="team-card" key={team.id}>
                <div className="team-card-heading">
                  <span className="team-avatar">
                    {team.name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="team-role">
                    {team.my_role ? label(team.my_role) : "Administrator"}
                  </span>
                </div>
                <h2>{team.name}</h2>
                <p className="team-description">
                  {team.description || "No description provided."}
                </p>
                <div className="team-card-footer">
                  <span>{team.member_count ?? 0} members</span>
                  <Link to={`/teams/${team.id}`}>View team</Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
