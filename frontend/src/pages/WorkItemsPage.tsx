import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ApiError, apiRequest } from "../lib/api";
import type {
  Priority,
  Team,
  TeamMember,
  WorkItem,
  WorkItemList,
  WorkStatus,
} from "../types";
import { label } from "../types";
import "./WorkItemsPage.css";

const statuses: WorkStatus[] = ["open", "in_progress", "blocked", "resolved"];
const priorities: Priority[] = ["low", "medium", "high", "critical"];

function useTeamMembers(teamId: number | null) {
  const [result, setResult] = useState<{
    teamId: number;
    members: TeamMember[];
  } | null>(null);
  const [failure, setFailure] = useState<{
    teamId: number;
    message: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (teamId === null) return;

    apiRequest<TeamMember[]>(`/api/teams/${teamId}/members`)
      .then((result) => {
        if (active) {
          setResult({
            teamId,
            members: result.filter((member) => member.is_active),
          });
          setFailure(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setFailure({
            teamId,
            message:
              err instanceof ApiError
                ? err.message
                : "Could not load the team's active members.",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [teamId]);

  return {
    members: result?.teamId === teamId ? result.members : [],
    error: failure?.teamId === teamId ? failure.message : "",
  };
}

export default function WorkItemsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<WorkItem[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [teamsError, setTeamsError] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createTeamId, setCreateTeamId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingItem, setEditingItem] = useState<WorkItem | null>(null);
  const [updating, setUpdating] = useState(false);
  const pageSize = 10;

  const selectedTeamId = showCreate
    ? createTeamId
    : editingItem?.team_id ?? null;
  const { members, error: membersError } = useTeamMembers(selectedTeamId);
  const canCreate = Boolean(
    user?.is_admin ||
      user?.teams.some((team) =>
        ["member", "manager", "admin"].includes(team.role),
      ),
  );

  const canEdit = (item: WorkItem) =>
    Boolean(
      user?.is_admin ||
        user?.teams.some(
          (team) =>
            team.id === item.team_id &&
            ["member", "manager", "admin"].includes(team.role),
        ),
    );

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let active = true;
    if (search !== debouncedSearch) return;

    const params = new URLSearchParams({
      skip: String(page * pageSize),
      limit: String(pageSize),
    });
    if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
    if (status) params.set("status", status);
    if (priority) params.set("priority", priority);

    apiRequest<WorkItemList>(`/api/work-items?${params.toString()}`)
      .then((result) => {
        if (active) {
          setItems(result.items);
          setTotal(result.total);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(
            err instanceof ApiError
              ? err.message
              : "Could not load work items.",
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [page, search, debouncedSearch, status, priority, refreshKey]);

  useEffect(() => {
    let active = true;
    apiRequest<Team[]>("/api/teams")
      .then((result) => {
        if (active) setTeams(result);
      })
      .catch((err: unknown) => {
        if (active) {
          setTeamsError(
            err instanceof ApiError ? err.message : "Could not load teams.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function createItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const teamId = Number(form.get("team_id"));
    const assigneeValue = String(form.get("assignee_id") ?? "").trim();
    const itemPriority = String(form.get("priority")) as Priority;

    if (title.length < 3) {
      setError("Title must contain at least 3 characters.");
      return;
    }

    if (!teamId) {
      setError("Choose a team for this work item.");
      return;
    }

    setSaving(true);
    try {
      await apiRequest<WorkItem>("/api/work-items", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: description || null,
          team_id: teamId,
          assignee_id: assigneeValue ? Number(assigneeValue) : null,
          priority: itemPriority,
        }),
      });

      setShowCreate(false);
      setCreateTeamId(null);
      setPage(0);
      setNotice("Work item created successfully.");
      setLoading(true);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not create the work item.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function updateItem(
    event: FormEvent<HTMLFormElement>,
    item: WorkItem,
  ) {
    event.preventDefault();
    setError("");
    setNotice("");

    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    const assigneeValue = String(form.get("assignee_id") ?? "").trim();
    const newStatus = String(form.get("status")) as WorkStatus;
    const newPriority = String(form.get("priority")) as Priority;

    if (title.length < 3) {
      setError("Title must contain at least 3 characters.");
      return;
    }

    setUpdating(true);
    try {
      await apiRequest<WorkItem>(`/api/work-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title,
          description: description || null,
          assignee_id: assigneeValue ? Number(assigneeValue) : null,
          status: newStatus,
          priority: newPriority,
          expected_version: item.version,
        }),
      });

      setEditingItem(null);
      setNotice(`OPS-${item.id} updated successfully.`);
      setLoading(true);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError(
          "This item was changed by someone else. Refresh the list and reopen Edit before trying again.",
        );
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : "Could not update this work item.",
        );
      }
    } finally {
      setUpdating(false);
    }
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <main className="work-page">
      <header className="work-heading">
        <div>
          <p className="work-eyebrow">OPS / WORK REGISTER</p>
          <h1>Work items<span>.</span></h1>
          <p className="work-subtitle">
            Find the issue. Understand its state. Move it forward.
          </p>
        </div>

        {canCreate && (
          <button
            className="work-primary-button"
            onClick={() => {
              setError("");
              setEditingItem(null);
              setShowCreate((value) => !value);
            }}
            type="button"
          >
            {showCreate ? "Cancel" : "+ New work item"}
          </button>
        )}
      </header>

      <section className="work-toolbar">
        <label className="work-search">
          <span>Search</span>
          <input
            value={search}
            onChange={(event) => {
              setLoading(true);
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="Search title or description..."
          />
        </label>

        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => {
              setLoading(true);
              setStatus(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All statuses</option>
            {statuses.map((value) => (
              <option value={value} key={value}>{label(value)}</option>
            ))}
          </select>
        </label>

        <label>
          <span>Priority</span>
          <select
            value={priority}
            onChange={(event) => {
              setLoading(true);
              setPriority(event.target.value);
              setPage(0);
            }}
          >
            <option value="">All priorities</option>
            {priorities.map((value) => (
              <option value={value} key={value}>{label(value)}</option>
            ))}
          </select>
        </label>
      </section>

      {notice && (
        <div className="work-notice" role="status">{notice}</div>
      )}

      {error && (
        <div className="work-error" role="alert">
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

      {showCreate && (
        <section className="work-create-panel">
          <div className="work-section-heading">
            <div>
              <p className="work-eyebrow">NEW RECORD</p>
              <h2>Create a work item</h2>
            </div>
          </div>

          <form className="work-form" onSubmit={createItem}>
            <label className="work-form-wide">
              Title
              <input name="title" required minLength={3} maxLength={200} />
            </label>
            <label className="work-form-wide">
              Description
              <textarea name="description" rows={3} />
            </label>
            <label>
              Team
              <select
                name="team_id"
                required
                value={createTeamId ?? ""}
                onChange={(event) =>
                  setCreateTeamId(
                    event.target.value ? Number(event.target.value) : null,
                  )
                }
              >
                <option value="" disabled>Select a team</option>
                {teams.map((team) => (
                  <option value={team.id} key={team.id}>{team.name}</option>
                ))}
              </select>
            </label>
            <label>
              Assignee (optional)
              <select name="assignee_id" defaultValue="" disabled={!createTeamId}>
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option value={member.user_id} key={member.user_id}>
                    {member.name} ({member.email})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select name="priority" defaultValue="medium">
                {priorities.map((value) => (
                  <option value={value} key={value}>{label(value)}</option>
                ))}
              </select>
            </label>
            {teamsError && (
              <p className="work-error work-form-wide" role="alert">{teamsError}</p>
            )}
            {membersError && (
              <p className="work-error work-form-wide" role="alert">{membersError}</p>
            )}
            <div className="work-form-actions">
              <button
                type="button"
                className="work-secondary-button"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="work-primary-button"
                disabled={saving || teams.length === 0 || Boolean(teamsError)}
              >
                {saving ? "Creating..." : "Create item"}
              </button>
            </div>
          </form>
        </section>
      )}

      {editingItem && (
        <section className="work-create-panel">
          <div className="work-section-heading">
            <div>
              <p className="work-eyebrow">OPS-{editingItem.id}</p>
              <h2>Edit work item</h2>
            </div>
          </div>
          <form
            className="work-form"
            onSubmit={(event) => updateItem(event, editingItem)}
          >
            <label className="work-form-wide">
              Title
              <input
                name="title"
                required
                minLength={3}
                maxLength={200}
                defaultValue={editingItem.title}
              />
            </label>
            <label className="work-form-wide">
              Description
              <textarea
                name="description"
                rows={3}
                defaultValue={editingItem.description ?? ""}
              />
            </label>
            <label>
              Status
              <select name="status" defaultValue={editingItem.status}>
                {statuses.map((value) => (
                  <option key={value} value={value}>{label(value)}</option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select name="priority" defaultValue={editingItem.priority}>
                {priorities.map((value) => (
                  <option key={value} value={value}>{label(value)}</option>
                ))}
              </select>
            </label>
            <label>
              Assignee
              <select
                name="assignee_id"
                defaultValue={editingItem.assignee_id ?? ""}
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option value={member.user_id} key={member.user_id}>
                    {member.name} ({member.email})
                  </option>
                ))}
              </select>
            </label>
            {membersError && (
              <p className="work-error work-form-wide" role="alert">{membersError}</p>
            )}
            <div className="work-form-actions">
              <button
                type="button"
                className="work-secondary-button"
                onClick={() => setEditingItem(null)}
                disabled={updating}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="work-primary-button"
                disabled={updating || Boolean(membersError)}
              >
                {updating ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="work-list-panel">
        <div className="work-list-heading">
          <div>
            <p className="work-eyebrow">LIVE REGISTER</p>
            <h2>All work</h2>
          </div>
          <span className="work-total">{total} records</span>
        </div>

        {loading ? (
          <div className="work-empty">Loading work items...</div>
        ) : items.length === 0 ? (
          <div className="work-empty">
            <strong>No work items found.</strong>
            <p>Try another filter or create a new work item.</p>
          </div>
        ) : (
          <div className="work-table-wrap">
            <table className="work-table">
              <thead>
                <tr>
                  <th>Work item</th>
                  <th>Team</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Assignee</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong><Link to={`/work-items/${item.id}`}>{item.title}</Link></strong>
                      <span className="work-item-id">OPS-{item.id}</span>
                      {item.description && (
                        <span className="work-row-description">
                          {item.description}
                        </span>
                      )}
                    </td>
                    <td>{item.team_name ?? `Team ${item.team_id}`}</td>
                    <td>
                      <span className={`work-status status-${item.status}`}>
                        {label(item.status)}
                      </span>
                    </td>
                    <td>
                      <span className={`work-priority priority-${item.priority}`}>
                        {label(item.priority)}
                      </span>
                    </td>
                    <td>{item.assignee_name ?? "Unassigned"}</td>
                    <td>
                      <div className="work-row-actions">
                        <span>v{item.version}</span>
                        {canEdit(item) && (
                          <button
                            type="button"
                            className="work-row-button"
                            onClick={() => {
                              setShowCreate(false);
                              setEditingItem(item);
                              setError("");
                              setNotice("");
                            }}
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          className="work-row-button"
                          onClick={() => navigate(`/work-items/${item.id}`)}
                        >
                          View details
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <footer className="work-pagination">
          <span>Page {page + 1} of {pageCount}</span>
          <div>
            <button
              className="work-secondary-button"
              type="button"
              disabled={page === 0 || loading}
              onClick={() => {
                setLoading(true);
                setPage((value) => Math.max(0, value - 1));
              }}
            >
              Previous
            </button>
            <button
              className="work-secondary-button"
              type="button"
              disabled={page + 1 >= pageCount || loading}
              onClick={() => {
                setLoading(true);
                setPage((value) => value + 1);
              }}
            >
              Next
            </button>
          </div>
        </footer>
      </section>

      <footer className="work-page-footer">
        OPS / WORK REGISTER · Signed in as {user?.email}
      </footer>
    </main>
  );
}
