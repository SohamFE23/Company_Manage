
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiRequest, ApiError } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
import "./WorkItemsPage.css";

type WorkStatus = "open" | "in_progress" | "blocked" | "resolved";
type Priority = "low" | "medium" | "high" | "critical";

type WorkItem = {
  id: number;
  title: string;
  description?: string | null;
  status: WorkStatus;
  priority: Priority;
  team_id: number;
  assignee_id?: number | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type Team = {
  id: number;
  name: string;
};

type ListResponse =
  | WorkItem[]
  | { items: WorkItem[]; total?: number };

const statuses: WorkStatus[] = [
  "open",
  "in_progress",
  "blocked",
  "resolved",
];

const priorities: Priority[] = [
  "low",
  "medium",
  "high",
  "critical",
];

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function WorkItemsPage() {
  const { user } = useAuth();

  const [items, setItems] = useState<WorkItem[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [editingItem, setEditingItem] = useState<WorkItem | null>(null);
  const [selectedItem, setSelectedItem] = useState<WorkItem | null>(null);
  const [updating, setUpdating] = useState(false);
  const pageSize = 10;

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        skip: String(page * pageSize),
        limit: String(pageSize),
      });

      if (search.trim()) params.set("search", search.trim());
      if (status) params.set("status", status);
      if (priority) params.set("priority", priority);

      const result = await apiRequest<ListResponse>(
        `/api/work-items?${params.toString()}`,
      );

      if (Array.isArray(result)) {
        setItems(result);
        setTotal(result.length);
      } else {
        setItems(result.items);
        setTotal(result.total ?? result.items.length);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not load work items.",
      );
    } finally {
      setLoading(false);
    }
  }, [page, search, status, priority, refreshKey]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    apiRequest<Team[]>("/api/teams")
      .then(setTeams)
      .catch(() => setTeams([]));
  }, []);

  useEffect(() => {
    setPage(0);
  }, [search, status, priority]);

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

    if (!title || title.length < 3) {
      setError("Title must contain at least 3 characters.");
      return;
    }

    if (!teamId) {
      setError("Choose a team for this work item.");
      return;
    }

    const payload = {
      title,
      description: description || null,
      team_id: teamId,
      assignee_id: assigneeValue ? Number(assigneeValue) : null,
      priority: itemPriority,
    };

    setSaving(true);

    try {
      await apiRequest<WorkItem>("/api/work-items", {
        method: "POST",
        body: JSON.stringify(payload),
      });

      setShowCreate(false);
      setPage(0);
      setNotice("Work item created successfully.");
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

    const payload = {
      title,
      description: description || null,
      assignee_id: assigneeValue ? Number(assigneeValue) : null,
      status: newStatus,
      priority: newPriority,
      expected_version: item.version,
    };

    setUpdating(true);

    try {
      await apiRequest<WorkItem>(`/api/work-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      setEditingItem(null);
      setNotice(`OPS-${item.id} updated successfully.`);
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

        <button
          className="work-primary-button"
          onClick={() => {
            setError("");
            setShowCreate((value) => !value);
          }}
          type="button"
        >
          {showCreate ? "Cancel" : "+ New work item"}
        </button>
      </header>

      <section className="work-toolbar">
        <label className="work-search">
          <span>Search</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title or description..."
          />
        </label>

        <label>
          <span>Status</span>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
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
            onChange={(event) => setPriority(event.target.value)}
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
            onClick={() => setRefreshKey((value) => value + 1)}
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
              <input
                name="title"
                required
                minLength={3}
                maxLength={200}
                placeholder="e.g. Investigate payment mismatch"
              />
            </label>

            <label className="work-form-wide">
              Description
              <textarea
                name="description"
                rows={3}
                placeholder="What happened, and what needs to be done?"
              />
            </label>

            <label>
              Team
              <select name="team_id" required defaultValue="">
                <option value="" disabled>Select a team</option>
                {teams.map((team) => (
                  <option value={team.id} key={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Assignee ID (optional)
              <input
                name="assignee_id"
                type="number"
                min={1}
                placeholder="User ID"
              />
            </label>

            <label>
              Priority
              <select name="priority" defaultValue="medium">
                {priorities.map((value) => (
                  <option value={value} key={value}>{label(value)}</option>
                ))}
              </select>
            </label>

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
                disabled={saving || teams.length === 0}
              >
                {saving ? "Creating..." : "Create item"}
              </button>
            </div>

            {teams.length === 0 && (
              <p className="work-muted work-form-wide">
                No teams loaded. Confirm that your account belongs to a team
                and that GET /api/teams is working.
              </p>
            )}
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
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Priority
              <select name="priority" defaultValue={editingItem.priority}>
                {priorities.map((value) => (
                  <option key={value} value={value}>
                    {label(value)}
                  </option>
                ))}
              </select>
            </label>

            <label className="work-form-wide">
              Assignee ID
              <input
                name="assignee_id"
                type="number"
                min={1}
                defaultValue={editingItem.assignee_id ?? ""}
                placeholder="Enter user ID or leave blank"
              />
            </label>

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
                disabled={updating}
              >
                {updating ? "Saving..." : "Save changes"}
              </button>
            </div>
          </form>
        </section>
      )}

      {selectedItem && (
        <section className="work-create-panel">
          <div className="work-section-heading">
            <div>
              <p className="work-eyebrow">OPS-{selectedItem.id}</p>
              <h2>{selectedItem.title}</h2>
            </div>
            <button
              type="button"
              className="work-secondary-button"
              onClick={() => setSelectedItem(null)}
            >
              Close
            </button>
          </div>
          <p>{selectedItem.description || "No description provided."}</p>
          <p>
            {label(selectedItem.status)} · {label(selectedItem.priority)} ·{" "}
            {selectedItem.assignee_id == null
              ? "Unassigned"
              : `User #${selectedItem.assignee_id}`}
          </p>
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
                      <strong>{item.title}</strong>
                      <span className="work-item-id">OPS-{item.id}</span>
                      {item.description && (
                        <span className="work-row-description">
                          {item.description}
                        </span>
                      )}
                    </td>
                    <td>
                      {teams.find((team) => team.id === item.team_id)?.name
                        ?? `Team ${item.team_id}`}
                    </td>
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
                    <td>
                      {item.assignee_id == null
                        ? "Unassigned"
                        : `User #${item.assignee_id}`}
                    </td>
                    
                    <td>
                    <div className="work-row-actions">
                        <span>v{item.version}</span>

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

                        <button
                            type="button"
                            className="work-row-button"
                          onClick={() => setSelectedItem(item)}
                            >
                            View details
                        </button>
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
                        Change status
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
          <span>
            Page {page + 1} of {pageCount}
          </span>
          <div>
            <button
              className="work-secondary-button"
              type="button"
              disabled={page === 0 || loading}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              Previous
            </button>
            <button
              className="work-secondary-button"
              type="button"
              disabled={page + 1 >= pageCount || loading}
              onClick={() => setPage((value) => value + 1)}
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
