import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/useAuth";
import { ApiError, apiRequest } from "../lib/api";
import type { AdminUser, AdminUserList } from "../types";
import "./AdminUsersPage.css";

const pageSize = 25;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback;
}

export default function AdminUsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [resettingUserId, setResettingUserId] = useState<number | null>(null);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    let active = true;
    if (!user?.is_admin) return;
    if (search !== debouncedSearch) return;

    const params = new URLSearchParams({
      skip: String(page * pageSize),
      limit: String(pageSize),
    });
    if (debouncedSearch.trim()) {
      params.set("search", debouncedSearch.trim());
    }

    void Promise.resolve()
      .then(() =>
        apiRequest<AdminUserList>(`/api/admin/users?${params.toString()}`),
      )
      .then((result) => {
        if (active) {
          setUsers(result.items);
          setTotal(result.total);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(errorMessage(err, "Could not load users."));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user?.is_admin, search, debouncedSearch, page, refreshKey]);

  if (!user?.is_admin) {
    return <Navigate to="/" replace />;
  }

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "").trim();
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const isAdmin = form.get("is_admin") === "on";

    if (password.length < 12) {
      setError("Password must contain at least 12 characters.");
      return;
    }

    setCreating(true);
    setError("");
    setNotice("");
    try {
      await apiRequest<AdminUser>("/api/admin/users", {
        method: "POST",
        body: JSON.stringify({
          name,
          email,
          password,
          is_admin: isAdmin,
        }),
      });
      formElement.reset();
      setShowCreate(false);
      setShowCreatePassword(false);
      setPage(0);
      setNotice("User created successfully.");
      setLoading(true);
      setRefreshKey((value) => value + 1);
    } catch (err) {
      setError(errorMessage(err, "Could not create this user."));
    } finally {
      setCreating(false);
    }
  }

  async function updateUser(
    target: AdminUser,
    changes: { is_active?: boolean; is_admin?: boolean },
  ) {
    const replacingAdmin =
      changes.is_admin === false && target.is_admin;
    const deactivating = changes.is_active === false && target.is_active;
    const action = deactivating
      ? "Deactivate"
      : replacingAdmin
        ? "Remove administrator access from"
        : "Update";
    if (
      (deactivating || replacingAdmin) &&
      !window.confirm(`${action} ${target.name}?`)
    ) {
      return;
    }

    setBusyUserId(target.id);
    setError("");
    setNotice("");
    try {
      const updated = await apiRequest<AdminUser>(
        `/api/admin/users/${target.id}`,
        {
          method: "PATCH",
          body: JSON.stringify(changes),
        },
      );
      setUsers((current) =>
        current.map((entry) => (entry.id === target.id ? updated : entry)),
      );
      setNotice(`${updated.name}'s account was updated.`);
    } catch (err) {
      setError(errorMessage(err, "Could not update this user."));
      setLoading(true);
      setRefreshKey((value) => value + 1);
    } finally {
      setBusyUserId(null);
    }
  }

  async function resetPassword(
    event: FormEvent<HTMLFormElement>,
    target: AdminUser,
  ) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const password = String(form.get("password") ?? "");
    const confirmation = String(form.get("confirm_password") ?? "");

    if (password.length < 12) {
      setError("Password must contain at least 12 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }

    setResettingUserId(target.id);
    setError("");
    setNotice("");
    try {
      await apiRequest<void>(
        `/api/admin/users/${target.id}/reset-password`,
        {
          method: "POST",
          body: JSON.stringify({ password }),
        },
      );
      formElement.reset();
      setResettingUserId(null);
      setShowResetPassword(false);
      setNotice(`Password reset for ${target.name}.`);
    } catch (err) {
      formElement.reset();
      setError(errorMessage(err, "Could not reset this password."));
    } finally {
      setResettingUserId(null);
    }
  }

  return (
    <main className="admin-users-page">
      <header className="admin-users-heading">
        <div>
          <p className="admin-users-eyebrow">OPS / ADMINISTRATION</p>
          <h1>User management<span>.</span></h1>
          <p className="admin-users-subtitle">
            Manage accounts, administrator access and credentials.
          </p>
        </div>
        <button
          className="admin-primary"
          type="button"
          onClick={() => {
            setError("");
            setShowCreate((value) => !value);
          }}
        >
          {showCreate ? "Cancel" : "+ New user"}
        </button>
      </header>

      {notice && (
        <div className="admin-notice" role="status" aria-live="polite">
          {notice}
        </div>
      )}
      {error && (
        <div className="admin-error" role="alert">
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
        <section className="admin-panel">
          <p className="admin-users-eyebrow">NEW ACCOUNT</p>
          <h2>Create a user</h2>
          <form className="admin-create-form" onSubmit={createUser}>
            <label>
              Name
              <input name="name" required maxLength={120} />
            </label>
            <label>
              Email
              <input name="email" type="email" required maxLength={255} />
            </label>
            <label>
              Password (minimum 12 characters)
              <span className="admin-password-field">
                <input
                  name="password"
                  type={showCreatePassword ? "text" : "password"}
                  required
                  minLength={12}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="admin-secondary"
                  onClick={() => setShowCreatePassword((value) => !value)}
                >
                  {showCreatePassword ? "Hide" : "Show"}
                </button>
              </span>
            </label>
            <label className="admin-checkbox">
              <input name="is_admin" type="checkbox" />
              Administrator
            </label>
            <div className="admin-form-actions">
              <button
                className="admin-secondary"
                type="button"
                disabled={creating}
                onClick={(event) => {
                  event.currentTarget.form?.reset();
                  setShowCreate(false);
                  setShowCreatePassword(false);
                }}
              >
                Cancel
              </button>
              <button className="admin-primary" type="submit" disabled={creating}>
                {creating ? "Creating..." : "Create user"}
              </button>
            </div>
          </form>
        </section>
      )}

      <section className="admin-panel">
        <div className="admin-list-heading">
          <div>
            <p className="admin-users-eyebrow">DIRECTORY</p>
            <h2>Users</h2>
          </div>
          <span className="admin-count">{total} accounts</span>
        </div>

        <label className="admin-search">
          <span>Search users</span>
          <input
            type="search"
            value={search}
            placeholder="Name or email..."
            onChange={(event) => {
              setLoading(true);
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>

        {loading ? (
          <div className="admin-empty">Loading users...</div>
        ) : users.length === 0 ? (
          <div className="admin-empty">No users match this search.</div>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Teams</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((target) => {
                  const isSelf = target.id === user.id;
                  const busy = busyUserId === target.id;
                  const resetOpen = resettingUserId === target.id;
                  return (
                    <tr key={target.id}>
                      <td>
                        <strong>{target.name}</strong>
                        {isSelf && <span className="admin-you">You</span>}
                        <span className="admin-email">{target.email}</span>
                      </td>
                      <td>
                        <span className={`admin-badge ${target.is_admin ? "admin-badge-admin" : ""}`}>
                          {target.is_admin ? "Administrator" : "User"}
                        </span>
                      </td>
                      <td>
                        <span className={`admin-status ${target.is_active ? "admin-status-active" : "admin-status-inactive"}`}>
                          {target.is_active ? "Active" : "Deactivated"}
                        </span>
                      </td>
                      <td>{target.team_count}</td>
                      <td>
                        <div className="admin-row-actions">
                          <button
                            type="button"
                            className="admin-secondary"
                            disabled={busy || (isSelf && target.is_active)}
                            onClick={() =>
                              void updateUser(target, {
                                is_active: !target.is_active,
                              })
                            }
                          >
                            {target.is_active ? "Deactivate" : "Activate"}
                          </button>
                          <button
                            type="button"
                            className="admin-secondary"
                            disabled={busy || (isSelf && target.is_admin)}
                            onClick={() =>
                              void updateUser(target, {
                                is_admin: !target.is_admin,
                              })
                            }
                          >
                            {target.is_admin ? "Remove admin" : "Make admin"}
                          </button>
                          <button
                            type="button"
                            className="admin-secondary"
                            disabled={busy || resetOpen}
                            onClick={() => {
                              setError("");
                              setResettingUserId(target.id);
                            }}
                          >
                            Reset password
                          </button>
                        </div>
                        {resetOpen && (
                          <form
                            className="admin-reset-form"
                            onSubmit={(event) => void resetPassword(event, target)}
                          >
                            <label>
                              New password
                              <input
                                name="password"
                                type={showResetPassword ? "text" : "password"}
                                minLength={12}
                                required
                                autoComplete="new-password"
                              />
                            </label>
                            <label>
                              Confirm password
                              <input
                                name="confirm_password"
                                type={showResetPassword ? "text" : "password"}
                                minLength={12}
                                required
                                autoComplete="new-password"
                              />
                            </label>
                            <div className="admin-row-actions">
                              <button
                                type="button"
                                className="admin-secondary"
                                onClick={(event) => {
                                  event.currentTarget.form?.reset();
                                  setResettingUserId(null);
                                  setShowResetPassword(false);
                                }}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="admin-secondary"
                                onClick={() => setShowResetPassword((value) => !value)}
                              >
                                {showResetPassword ? "Hide" : "Show"}
                              </button>
                              <button
                                className="admin-primary"
                                type="submit"
                                disabled={busy}
                              >
                                Save password
                              </button>
                            </div>
                          </form>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <footer className="admin-pagination">
          <span>Page {page + 1} of {pageCount}</span>
          <div>
            <button
              className="admin-secondary"
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
              className="admin-secondary"
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
    </main>
  );
}
