
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { apiRequest, ApiError } from "../lib/api";
import type { WorkItem, WorkItemList, WorkStatus } from "../types";
import "./DashboardPage.css";

type StatusFilter = "all" | WorkStatus;

const statusLabel: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  blocked: "Blocked",
  resolved: "Resolved",
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isCritical(item: WorkItem) {
  return item.priority.toLowerCase() === "critical";
}

function isOpen(item: WorkItem) {
  return item.status.toLowerCase() !== "resolved";
}

function riskRank(item: WorkItem) {
  if (item.status === "blocked") return 0;
  if (isCritical(item)) return 1;
  if (item.assignee_id == null) return 2;
  if (item.priority.toLowerCase() === "high") return 3;
  return 4;
}

export default function DashboardPage() {
  const { user } = useAuth();

  const [items, setItems] = useState<WorkItem[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  const loadItems = useCallback(async () => {
    setError("");

    try {
      // This is a first-page request. The backend remains responsible
      // for authorization, filtering, and pagination.
      const result = await apiRequest<WorkItemList>(
        "/api/work-items?limit=100",
      );

      setItems(result.items);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not load work items. Check the API connection.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(loadItems);
  }, [loadItems, reloadKey]);

  const filteredItems = useMemo(() => {
    const query = search.trim().toLowerCase();

    return items
      .filter((item) => {
        const matchesSearch =
          !query ||
          item.title.toLowerCase().includes(query) ||
          (item.description ?? "").toLowerCase().includes(query) ||
          `ops-${item.id}`.includes(query);

        const matchesStatus =
          statusFilter === "all" || item.status === statusFilter;

        return matchesSearch && matchesStatus;
      })
      .sort((a, b) => {
        const riskDifference = riskRank(a) - riskRank(b);
        if (riskDifference !== 0) return riskDifference;

        return (
          new Date(b.updated_at).getTime() -
          new Date(a.updated_at).getTime()
        );
      });
  }, [items, search, statusFilter]);

  const openCount = items.filter(isOpen).length;
  const criticalCount = items.filter(
    (item) => isCritical(item) && isOpen(item),
  ).length;
  const blockedCount = items.filter(
    (item) => item.status === "blocked",
  ).length;
  const unassignedCount = items.filter(
    (item) => isOpen(item) && item.assignee_id == null,
  ).length;

  const recentItems = useMemo(
    () =>
      [...items]
        .sort(
          (a, b) =>
            new Date(b.updated_at).getTime() -
            new Date(a.updated_at).getTime(),
        )
        .slice(0, 5),
    [items],
  );

  const teamName = (teamId: number) =>
    user?.teams.find((team) => team.id === teamId)?.name ??
    `Team ${teamId}`;

  return (
    <main className="control-room">
      <section className="control-intro">
        <div>
          <p className="control-overline">YOUR OPERATIONAL SNAPSHOT</p>
          <h1>Control room<span>.</span></h1>
          <p className="control-subtitle">
            See the pressure points. Decide what moves next.
          </p>
        </div>

        <button
          className="control-refresh"
          type="button"
          onClick={() => {
            setLoading(true);
            setReloadKey((value) => value + 1);
          }}
          disabled={loading}
        >
          ↻ {loading ? "Refreshing…" : "Refresh data"}
        </button>
      </section>

      <section className="control-stats" aria-label="Work summary">
        <article className="control-stat control-stat-dark">
          <span>OPEN WORK</span>
          <strong>{loading ? "—" : openCount}</strong>
          <small>Items not yet resolved</small>
        </article>

        <article className="control-stat control-stat-critical">
          <span>CRITICAL</span>
          <strong>{loading ? "—" : criticalCount}</strong>
          <small>High urgency, immediate review</small>
        </article>

        <article className="control-stat">
          <span>BLOCKED</span>
          <strong>{loading ? "—" : blockedCount}</strong>
          <small>Needs an intervention</small>
        </article>

        <article className="control-stat">
          <span>NO OWNER</span>
          <strong>{loading ? "—" : unassignedCount}</strong>
          <small>Open work without an assignee</small>
        </article>
      </section>

      {error && (
        <section className="control-error" role="alert">
          <strong>Work items could not be loaded.</strong>
          <p>{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setReloadKey((value) => value + 1);
            }}
          >
            Try again
          </button>
        </section>
      )}

      <section className="control-main-grid">
        <div className="control-panel attention-panel">
          <div className="control-panel-heading">
            <div>
              <p className="control-overline">PRIORITY ORDER</p>
              <h2>Attention queue</h2>
            </div>
            <span className="control-count">
              {loading ? "…" : filteredItems.length}
            </span>
          </div>

          <div className="control-filters">
            <input
              aria-label="Search work items"
              placeholder="Search title, description or ID…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />

            <select
              aria-label="Filter by status"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as StatusFilter)
              }
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="in_progress">In progress</option>
              <option value="blocked">Blocked</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>

          {loading ? (
            <div className="control-empty">Loading operational data…</div>
          ) : filteredItems.length === 0 ? (
            <div className="control-empty">
              {items.length === 0
                ? "No work items are available to you yet."
                : "No work items match these filters."}
            </div>
          ) : (
            <div className="attention-list">
              {filteredItems.slice(0, 10).map((item) => {
                const reason =
                  item.status === "blocked"
                    ? "Blocked"
                    : isCritical(item)
                      ? "Critical priority"
                      : item.assignee_id == null
                        ? "Unassigned"
                        : item.priority.toLowerCase() === "high"
                          ? "High priority"
                          : "Normal queue";

                return (
                  <article className="attention-item" key={item.id}>
                    <div
                      className={`attention-marker marker-${item.status}`}
                      aria-hidden="true"
                    />

                    <div className="attention-content">
                      <div className="attention-meta">
                        <span>OPS-{item.id}</span>
                        <span>{item.team_name ?? teamName(item.team_id)}</span>
                      </div>

                      <h3>
                        <Link to={`/work-items/${item.id}`}>{item.title}</Link>
                      </h3>

                      {item.description && (
                        <p className="attention-description">
                          {item.description}
                        </p>
                      )}

                      <div className="attention-tags">
                        <span
                          className={`status-tag status-${item.status}`}
                        >
                          {statusLabel[item.status] ?? item.status}
                        </span>
                        <span className="attention-reason">{reason}</span>
                      </div>
                    </div>

                    <div className="attention-updated">
                      <span>UPDATED</span>
                      <time dateTime={item.updated_at}>
                        {formatDate(item.updated_at)}
                      </time>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <aside className="control-side-column">
          <section className="control-panel team-panel">
            <p className="control-overline">YOUR SCOPE</p>
            <h2>Teams</h2>

            {!user?.teams.length ? (
              <p className="control-muted">
                No team memberships are associated with this account.
              </p>
            ) : (
              <div className="team-list">
                {user.teams.map((team) => (
                  <div className="team-entry" key={team.id}>
                    <div className="team-avatar">
                      {team.name.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="team-entry-copy">
                      <strong>{team.name}</strong>
                      <span>{team.role}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <p className="control-muted team-note">
              Work-item access must be enforced by the backend for each team.
            </p>
          </section>

          <section className="control-panel movement-panel">
            <p className="control-overline">RECENTLY TOUCHED</p>
            <h2>Latest movements</h2>

            {loading ? (
              <p className="control-muted">Loading updates…</p>
            ) : recentItems.length === 0 ? (
              <p className="control-muted">No recent work to show.</p>
            ) : (
              <div className="movement-list">
                {recentItems.map((item) => (
                  <Link
                    className="movement-entry"
                    key={item.id}
                    to={`/work-items/${item.id}`}
                  >
                    <div className="movement-icon">↗</div>
                    <div className="movement-copy">
                      <strong>{item.title}</strong>
                      <span>
                        {statusLabel[item.status] ?? item.status} ·{" "}
                        {formatDate(item.updated_at)}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            <p className="control-muted movement-note">
              These are recently updated items. Open a work item to see its
              recorded activity timeline.
            </p>
          </section>
        </aside>
      </section>

      <footer className="control-footer">
        <span>OPS / CONTROL ROOM</span>
        <span>
          {user?.teams.length ?? 0} team
          {(user?.teams.length ?? 0) === 1 ? "" : "s"} · Data from OpsFlow API
        </span>
      </footer>
    </main>
  );
}
