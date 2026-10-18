
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ApiError, apiRequest } from "../lib/api";
import "./WorkItemDetailsPage.css";

type WorkItem = {
  id: number;
  title: string;
  description?: string | null;
  status: "open" | "in_progress" | "blocked" | "resolved";
  priority: "low" | "medium" | "high" | "critical";
  team_id: number;
  assignee_id?: number | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type ActivityEvent = {
  id: number;
  action: string;
  description: string;
  actor_name?: string | null;
  created_at: string;
  old_value?: string | null;
  new_value?: string | null;
};

type Props = {
  itemId: number;
  onBack: () => void;
};

const statuses = ["open", "in_progress", "blocked", "resolved"] as const;
const priorities = ["low", "medium", "high", "critical"] as const;

function label(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function WorkItemDetailsPage({ itemId, onBack }: Props) {
  const [item, setItem] = useState<WorkItem | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);

  const loadDetails = useCallback(async () => {
    setLoading(true);
    setError("");
    setConflict(false);

    try {
      const latestItem = await apiRequest<WorkItem>(
        `/api/work-items/${itemId}`,
      );
      setItem(latestItem);

      // This endpoint must be implemented in the backend.
      try {
        const events = await apiRequest<ActivityEvent[]>(
          `/api/work-items/${itemId}/activity`,
        );
        setActivity(events);
      } catch {
        setActivity([]);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Unable to load this work item.",
      );
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  async function saveChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!item) return;

    setSaving(true);
    setError("");
    setNotice("");
    setConflict(false);

    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();

    if (title.length < 3) {
      setError("Title must contain at least 3 characters.");
      setSaving(false);
      return;
    }

    const assignee = String(form.get("assignee_id") ?? "").trim();

    const payload = {
      title,
      description: String(form.get("description") ?? "").trim() || null,
      status: String(form.get("status")),
      priority: String(form.get("priority")),
      assignee_id: assignee ? Number(assignee) : null,
      expected_version: item.version,
    };

    try {
      await apiRequest<WorkItem>(`/api/work-items/${item.id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      setNotice("Changes saved successfully.");
      await loadDetails();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true);
        setError(
          "This work item changed after you opened it. Your changes were not saved. Reload the latest version before editing again.",
        );
      } else {
        setError(
          err instanceof ApiError
            ? err.message
            : "Unable to save changes.",
        );
      }
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <main className="details-page"><p>Loading work item...</p></main>;
  }

  if (!item) {
    return (
      <main className="details-page">
        <button className="details-secondary" onClick={onBack}>← Back</button>
        <div className="details-error" role="alert">
          {error || "Work item not found."}
        </div>
        <button className="details-secondary" onClick={() => void loadDetails()}>
          Retry
        </button>
      </main>
    );
  }

  return (
    <main className="details-page">
      <header className="details-header">
        <div>
          <p className="details-eyebrow">OPS / WORK REGISTER / OPS-{item.id}</p>
          <h1>Work item details<span>.</span></h1>
          <p className="details-muted">
            Review the issue, ownership and recorded changes.
          </p>
        </div>
        <button className="details-secondary" onClick={onBack}>
          ← Back to work items
        </button>
      </header>

      {error && (
        <div className="details-error" role="alert">
          <p>{error}</p>
          {conflict && (
            <button
              type="button"
              className="details-secondary"
              onClick={() => void loadDetails()}
            >
              Reload latest version
            </button>
          )}
        </div>
      )}

      {notice && <div className="details-notice" role="status">{notice}</div>}

      <section className="details-summary">
        <div>
          <p className="details-eyebrow">WORK ITEM · OPS-{item.id}</p>
          <h2>{item.title}</h2>
          <p className="details-muted">
            Created {formatDate(item.created_at)}
          </p>
        </div>
        <div className="details-version">
          <span>RECORD VERSION</span>
          <strong>v{item.version}</strong>
          <small>Used to detect stale edits</small>
        </div>
      </section>

      <section className="details-metrics">
        <article>
          <span>STATUS</span>
          <strong className={`details-tag status-${item.status}`}>
            {label(item.status)}
          </strong>
        </article>
        <article>
          <span>PRIORITY</span>
          <strong className={`details-tag priority-${item.priority}`}>
            {label(item.priority)}
          </strong>
        </article>
        <article>
          <span>TEAM ID</span>
          <strong>{item.team_id}</strong>
        </article>
        <article>
          <span>OWNER</span>
          <strong>
            {item.assignee_id == null ? "Unassigned" : `User #${item.assignee_id}`}
          </strong>
        </article>
      </section>

      <div className="details-columns">
        <section className="details-panel">
          <p className="details-eyebrow">EDIT RECORD</p>
          <h2>Description & ownership</h2>
          <p className="details-muted">
            Saving submits the version you opened. If another user has changed
            the item, the backend should reject this stale update.
          </p>

          <form className="details-form" onSubmit={saveChanges}>
            <label>
              Title
              <input
                name="title"
                required
                minLength={3}
                maxLength={200}
                defaultValue={item.title}
                key={`title-${item.id}-${item.version}`}
              />
            </label>

            <label>
              Description
              <textarea
                name="description"
                rows={6}
                defaultValue={item.description ?? ""}
                key={`description-${item.id}-${item.version}`}
              />
            </label>

            <label>
              Status
              <select
                name="status"
                defaultValue={item.status}
                key={`status-${item.id}-${item.version}`}
              >
                {statuses.map((value) => (
                  <option key={value} value={value}>{label(value)}</option>
                ))}
              </select>
            </label>

            <label>
              Priority
              <select
                name="priority"
                defaultValue={item.priority}
                key={`priority-${item.id}-${item.version}`}
              >
                {priorities.map((value) => (
                  <option key={value} value={value}>{label(value)}</option>
                ))}
              </select>
            </label>

            <label>
              Assignee user ID
              <input
                name="assignee_id"
                type="number"
                min={1}
                defaultValue={item.assignee_id ?? ""}
                placeholder="Leave blank to unassign"
                key={`assignee-${item.id}-${item.version}`}
              />
            </label>

            <button
              type="submit"
              className="details-primary"
              disabled={saving || conflict}
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </form>
        </section>

        <section className="details-panel">
          <p className="details-eyebrow">CHANGE RECORD</p>
          <h2>Activity timeline</h2>
          <p className="details-muted">
            Recorded actions help explain how this item evolved.
          </p>

          {activity.length === 0 ? (
            <div className="details-empty">
              <strong>No activity events available.</strong>
              <p>
                The activity API may not be implemented yet, or this item has
                no recorded events.
              </p>
            </div>
          ) : (
            <div className="details-timeline">
              {activity.map((event) => (
                <article className="details-event" key={event.id}>
                  <div className="details-event-dot" />
                  <div>
                    <strong>{event.description || label(event.action)}</strong>
                    <p>{event.actor_name || "System"}</p>
                    {(event.old_value || event.new_value) && (
                      <p>
                        {event.old_value ?? "—"} → {event.new_value ?? "—"}
                      </p>
                    )}
                    <time dateTime={event.created_at}>
                      {formatDate(event.created_at)}
                    </time>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <footer className="details-footer">
        Last updated: {formatDate(item.updated_at)} · Version {item.version}
      </footer>
    </main>
  );
}
