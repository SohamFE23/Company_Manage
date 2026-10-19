import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ApiError, apiRequest } from "../lib/api";
import type {
  ActivityEvent,
  Priority,
  TeamMember,
  WorkItem,
  WorkStatus,
} from "../types";
import { label } from "../types";
import "./WorkItemDetailsPage.css";

const statuses: WorkStatus[] = ["open", "in_progress", "blocked", "resolved"];
const priorities: Priority[] = ["low", "medium", "high", "critical"];

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function WorkItemDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const itemId =
    id && /^\d+$/.test(id) && Number(id) > 0 ? Number(id) : null;
  const [item, setItem] = useState<WorkItem | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [teamMembers, setTeamMembers] = useState<{
    teamId: number;
    members: TeamMember[];
  } | null>(null);
  const [memberFailure, setMemberFailure] = useState<{
    teamId: number;
    message: string;
  } | null>(null);
  const [activityError, setActivityError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState(false);

  const canEdit = Boolean(
    item &&
      (user?.is_admin ||
        user?.teams.some(
          (team) =>
            team.id === item.team_id &&
            ["member", "manager", "admin"].includes(team.role),
        )),
  );
  const members =
        teamMembers && teamMembers.teamId === item?.team_id
          ? teamMembers.members
          : [];
  const membersError =
        memberFailure && memberFailure.teamId === item?.team_id
          ? memberFailure.message
          : "";

  const loadDetails = useCallback(async () => {
    await Promise.resolve();
    setLoading(true);
    setError("");
    setConflict(false);
    setActivityError("");

    if (itemId === null) {
      setItem(null);
      setError("Invalid work item ID.");
      setLoading(false);
      return;
    }

    try {
      const latestItem = await apiRequest<WorkItem>(
        `/api/work-items/${itemId}`,
      );
      setItem(latestItem);

      try {
        const events = await apiRequest<ActivityEvent[]>(
          `/api/work-items/${itemId}/activity`,
        );
        setActivity(events);
      } catch (err) {
        setActivity([]);
        setActivityError(
          err instanceof ApiError
            ? err.message
            : "Could not load this item's activity.",
        );
      }
    } catch (err) {
      setItem(null);
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
    void Promise.resolve().then(loadDetails);
  }, [loadDetails]);

  useEffect(() => {
    let active = true;

    if (!item || !canEdit) return;

    apiRequest<TeamMember[]>(`/api/teams/${item.team_id}/members`)
      .then((result) => {
        if (active) {
          setTeamMembers({
            teamId: item.team_id,
            members: result.filter((member) => member.is_active),
          });
          setMemberFailure(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setMemberFailure({
            teamId: item.team_id,
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
  }, [item, canEdit]);

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
      status: String(form.get("status")) as WorkStatus,
      priority: String(form.get("priority")) as Priority,
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
        <Link className="details-secondary" to="/work-items">← Back</Link>
        <div className="details-error" role="alert">{error || "Work item not found."}</div>
        {itemId !== null && (
          <button
            className="details-secondary"
            type="button"
            onClick={() => void loadDetails()}
          >
            Retry
          </button>
        )}
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
        <Link className="details-secondary" to="/work-items">
          ← Back to work items
        </Link>
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
              Reload latest
            </button>
          )}
        </div>
      )}

      {notice && (
        <div className="details-notice" role="status" aria-live="polite">
          {notice}
        </div>
      )}

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
          <span>TEAM</span>
          <strong>{item.team_name ?? `Team ${item.team_id}`}</strong>
        </article>
        <article>
          <span>OWNER</span>
          <strong>{item.assignee_name ?? "Unassigned"}</strong>
        </article>
      </section>

      <div className="details-columns">
        <section className="details-panel">
          <p className="details-eyebrow">{canEdit ? "EDIT RECORD" : "RECORD"}</p>
          <h2>Description & ownership</h2>
          {canEdit ? (
            <>
              <p className="details-muted">
                Saving submits the version you opened. If another user has
                changed the item, the backend rejects this stale update.
              </p>
              {membersError && (
                <div className="details-error" role="alert">{membersError}</div>
              )}
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
                  Assignee
                  <select
                    name="assignee_id"
                    defaultValue={item.assignee_id ?? ""}
                    key={`assignee-${item.id}-${item.version}`}
                  >
                    <option value="">Unassigned</option>
                    {item.assignee_id !== null &&
                      !members.some((member) => member.user_id === item.assignee_id) && (
                        <option value={item.assignee_id}>
                          {item.assignee_name ?? "Current assignee"}
                        </option>
                      )}
                    {members.map((member) => (
                      <option value={member.user_id} key={member.user_id}>
                        {member.name} ({member.email})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="details-primary"
                  disabled={saving || conflict || Boolean(membersError)}
                >
                  {saving ? "Saving..." : "Save changes"}
                </button>
              </form>
            </>
          ) : (
            <div>
              <p className="details-muted">
                This work item is read-only because your team role does not
                allow editing.
              </p>
              <p>{item.description || "No description provided."}</p>
            </div>
          )}
        </section>

        <section className="details-panel">
          <p className="details-eyebrow">CHANGE RECORD</p>
          <h2>Activity timeline</h2>
          <p className="details-muted">
            Recorded actions help explain how this item evolved.
          </p>
          {activityError ? (
            <div className="details-error" role="alert">
              <p>{activityError}</p>
              <button
                type="button"
                className="details-secondary"
                onClick={() => void loadDetails()}
              >
                Retry
              </button>
            </div>
          ) : activity.length === 0 ? (
            <div className="details-empty">
              <strong>No activity events available.</strong>
              <p>No changes have been recorded for this work item yet.</p>
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
