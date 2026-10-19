import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ApiError, apiRequest } from "../lib/api";
import type { Team, TeamMember, TeamRole } from "../types";
import { label } from "../types";
import "./TeamDetailsPage.css";

const roles: TeamRole[] = ["manager", "member", "viewer"];

function getApiMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export default function TeamDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, refreshUser } = useAuth();
  const teamId = id && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null;
  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingTeam, setEditingTeam] = useState(false);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const canManage = Boolean(
    user?.is_admin || team?.my_role === "manager" || team?.my_role === "admin",
  );

  useEffect(() => {
    let active = true;
    if (teamId === null) {
      void Promise.resolve().then(() => {
        if (active) {
          setTeam(null);
          setMembers([]);
          setError("Invalid team ID.");
          setLoading(false);
        }
      });
      return () => {
        active = false;
      };
    }

    void Promise.all([
      apiRequest<Team>(`/api/teams/${teamId}`),
      apiRequest<TeamMember[]>(`/api/teams/${teamId}/members`),
    ])
      .then(([loadedTeam, loadedMembers]) => {
        if (active) {
          setTeam(loadedTeam);
          setMembers(loadedMembers);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(getApiMessage(err, "Could not load this team."));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [teamId, refreshKey]);

  async function refreshTeam() {
    setLoading(true);
    setRefreshKey((value) => value + 1);
  }

  async function updateTeam(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!team) return;

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
      const updated = await apiRequest<Team>(`/api/teams/${team.id}`, {
        method: "PATCH",
        body: JSON.stringify({ name, description: description || null }),
      });
      setTeam(updated);
      setEditingTeam(false);
      await refreshUser();
      setNotice("Team details updated.");
    } catch (err) {
      setError(getApiMessage(err, "Could not update this team."));
    } finally {
      setSaving(false);
    }
  }

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!team) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get("email") ?? "").trim();
    const role = String(form.get("role")) as TeamRole;

    setSaving(true);
    setError("");
    setNotice("");
    try {
      const added = await apiRequest<TeamMember>(
        `/api/teams/${team.id}/members`,
        {
          method: "POST",
          body: JSON.stringify({ email, role }),
        },
      );
      setMembers((current) =>
        [...current, added].sort((a, b) => a.name.localeCompare(b.name)),
      );
      formElement.reset();
      setNotice(`${added.name} added to the team.`);
      if (added.user_id === user?.id) await refreshUser();
      setLoading(true);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(getApiMessage(err, "Could not add this member."));
    } finally {
      setSaving(false);
    }
  }

  async function changeRole(member: TeamMember, role: TeamRole) {
    if (!team || role === member.role) return;
    setBusyUserId(member.user_id);
    setError("");
    setNotice("");
    try {
      const updated = await apiRequest<TeamMember>(
        `/api/teams/${team.id}/members/${member.user_id}`,
        {
          method: "PATCH",
          body: JSON.stringify({ role }),
        },
      );
      setMembers((current) =>
        current.map((entry) =>
          entry.user_id === member.user_id ? updated : entry,
        ),
      );
      if (member.user_id === user?.id) {
        setTeam((current) =>
          current ? { ...current, my_role: updated.role } : current,
        );
      }
      setNotice(`${updated.name}'s role updated to ${label(updated.role)}.`);
      if (member.user_id === user?.id) await refreshUser();
    } catch (err) {
      setError(getApiMessage(err, "Could not update this member's role."));
      setLoading(true);
      setRefreshKey((value) => value + 1);
    } finally {
      setBusyUserId(null);
    }
  }

  async function removeMember(member: TeamMember, leaving = false) {
    if (!team) return;
    const prompt = leaving
      ? `Leave ${team.name}? You will lose access to its work items.`
      : `Remove ${member.name} from ${team.name}?`;
    if (!window.confirm(prompt)) return;

    setBusyUserId(member.user_id);
    setError("");
    setNotice("");
    try {
      await apiRequest<void>(
        `/api/teams/${team.id}/members/${member.user_id}`,
        { method: "DELETE" },
      );
      if (member.user_id === user?.id) {
        await refreshUser();
        navigate("/teams");
        return;
      }
      setMembers((current) =>
        current.filter((entry) => entry.user_id !== member.user_id),
      );
      setNotice(`${member.name} removed from the team.`);
    } catch (err) {
      setError(getApiMessage(err, "Could not remove this member."));
    } finally {
      setBusyUserId(null);
    }
  }

  async function deleteTeam() {
    if (!team || !window.confirm(`Delete the ${team.name} team? This cannot be undone.`)) {
      return;
    }

    setSaving(true);
    setError("");
    try {
      await apiRequest<void>(`/api/teams/${team.id}`, { method: "DELETE" });
      navigate("/teams");
    } catch (err) {
      setError(getApiMessage(err, "Could not delete this team."));
    } finally {
      setSaving(false);
    }
  }

  if (loading && !team) {
    return <main className="team-details-page"><p>Loading team...</p></main>;
  }

  if (!team) {
    return (
      <main className="team-details-page">
        <Link className="team-secondary" to="/teams">← Back to teams</Link>
        <div className="team-error" role="alert">{error || "Team not found."}</div>
        {teamId !== null && (
          <button className="team-secondary" type="button" onClick={() => void refreshTeam()}>
            Retry
          </button>
        )}
      </main>
    );
  }

  return (
    <main className="team-details-page">
      <header className="team-details-heading">
        <div>
          <p className="team-eyebrow">OPS / TEAMS / {team.name.toUpperCase()}</p>
          <h1>{team.name}<span>.</span></h1>
          <p className="team-subtitle">{team.description || "No description provided."}</p>
        </div>
        <Link className="team-secondary" to="/teams">← Back to teams</Link>
      </header>

      {notice && <div className="team-notice" role="status">{notice}</div>}
      {error && (
        <div className="team-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError("")}>Dismiss</button>
        </div>
      )}

      {editingTeam && canManage ? (
        <section className="team-panel">
          <p className="team-eyebrow">TEAM SETTINGS</p>
          <h2>Edit team</h2>
          <form className="team-form" onSubmit={updateTeam}>
            <label>
              Name
              <input name="name" required minLength={2} maxLength={120} defaultValue={team.name} />
            </label>
            <label>
              Description
              <textarea name="description" rows={3} maxLength={2000} defaultValue={team.description ?? ""} />
            </label>
            <div className="team-actions">
              <button className="team-secondary" type="button" onClick={() => setEditingTeam(false)} disabled={saving}>Cancel</button>
              <button className="team-primary" type="submit" disabled={saving}>{saving ? "Saving..." : "Save team"}</button>
            </div>
          </form>
        </section>
      ) : (
        <section className="team-overview team-panel">
          <div>
            <p className="team-eyebrow">TEAM OVERVIEW</p>
            <p>{team.description || "No description provided."}</p>
          </div>
          <div className="team-overview-meta">
            <span>{members.length} members</span>
            <span>{team.my_role ? label(team.my_role) : "Administrator"}</span>
            {canManage && (
              <button className="team-secondary" type="button" onClick={() => setEditingTeam(true)}>
                Edit team
              </button>
            )}
            {user?.is_admin && (
              <button className="team-danger" type="button" onClick={() => void deleteTeam()} disabled={saving}>
                Delete team
              </button>
            )}
          </div>
        </section>
      )}

      {canManage && (
        <section className="team-panel">
          <p className="team-eyebrow">MEMBERSHIP</p>
          <h2>Add a member</h2>
          <form className="team-add-form" onSubmit={addMember}>
            <label>
              Email address
              <input name="email" type="email" required maxLength={255} placeholder="person@company.com" />
            </label>
            <label>
              Team role
              <select name="role" defaultValue="member">
                {roles.map((role) => <option value={role} key={role}>{label(role)}</option>)}
              </select>
            </label>
            <button className="team-primary" type="submit" disabled={saving}>
              {saving ? "Adding..." : "Add member"}
            </button>
          </form>
        </section>
      )}

      <section className="team-panel">
        <div className="team-list-heading">
          <div>
            <p className="team-eyebrow">TEAM ROSTER</p>
            <h2>Members</h2>
          </div>
          <span className="team-count">{members.length} people</span>
        </div>
        {members.length === 0 ? (
          <div className="team-empty">This team has no members.</div>
        ) : (
          <div className="team-table-wrap">
            <table className="team-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {members.map((member) => {
                  const isSelf = member.user_id === user?.id;
                  return (
                    <tr key={member.user_id}>
                      <td><strong>{member.name}</strong>{isSelf && <span className="team-you">You</span>}</td>
                      <td>{member.email}</td>
                      <td>
                        {canManage ? (
                          <select
                            aria-label={`Role for ${member.name}`}
                            value={member.role === "admin" ? "manager" : member.role}
                            disabled={busyUserId === member.user_id}
                            onChange={(event) => void changeRole(member, event.target.value as TeamRole)}
                          >
                            {roles.map((role) => <option value={role} key={role}>{label(role)}</option>)}
                          </select>
                        ) : label(member.role)}
                      </td>
                      <td>
                        <span className={`team-status ${member.is_active ? "team-active" : "team-inactive"}`}>
                          {member.is_active ? "Active" : "Deactivated"}
                        </span>
                      </td>
                      <td>
                        {isSelf ? (
                          <button
                            className="team-danger"
                            type="button"
                            disabled={busyUserId === member.user_id}
                            onClick={() => void removeMember(member, true)}
                          >
                            Leave team
                          </button>
                        ) : canManage ? (
                          <button
                            className="team-danger"
                            type="button"
                            disabled={busyUserId === member.user_id}
                            onClick={() => void removeMember(member)}
                          >
                            Remove
                          </button>
                        ) : <span className="team-muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
