# OpsFlow: Implementation Plan (Commits 3 to 7)

This file is the working brief for GitHub Copilot (agent mode). Commits 1 and 2 are already done. Implement **one commit at a time**, in order, and stop after each so it can be reviewed and committed.

## Rules for Copilot

- Do only what the current commit section lists. Do not refactor unrelated files.
- Follow the conventions and contracts in "Current state" exactly. Do not rename existing functions, models, routes or response fields unless the commit says so.
- After each commit, run the **Verify** steps and fix failures before stopping.
- Use the given commit message. Do not commit for me; leave changes staged or in the working tree.
- Never log or return password hashes. Never hardcode secrets. Never trust the client for authorization; the backend enforces every permission.
- Keep code typed (Python type hints, strict TypeScript, no `any`).

---

## Current state (after commits 1 and 2)

**Stack:** FastAPI + SQLAlchemy 2.0 (PostgreSQL), PyJWT, pwdlib. Frontend is React 19 + TypeScript + Vite (no router yet, no UI library).

### Backend layout (`backend/`)

```
main.py                  app, CORS from settings, /api/health (checks DB), routers registered
app/config.py            `settings` (environment, database_url, jwt_secret_key, token_expire_hours, cors_origins, log_level, is_production)
app/database.py          engine, SessionLocal, Base, get_db
app/models.py            User, Team, TeamMembership, WorkItem, WorkItemActivity, utcnow()
app/auth.py              router /api/auth (login, me), get_current_user, require_admin, password_hash
app/permissions.py       TeamRole, ROLE_RANK, MANAGER_ROLES, role_rank, get_membership, visible_team_ids, require_team_role
app/schemas.py           WorkItemCreate / WorkItemUpdate / WorkItemResponse
app/routers/teams.py     teams + members API (done)
app/routers/admin.py     /api/admin/users API (done)
app/routers/work_items.py   STILL UNAUTHENTICATED (commit 3 rewrites it)
app/init_db.py           run with `python -m app.init_db`
seed_demo_accounts.py, reset_pass.py, app/create_admin.py   dev scripts
```

### Models (all timestamps are timezone-aware UTC)

- `User(id, name, email, is_admin, password_hash, is_active, created_at)`
- `Team(id, name, description, created_at)`
- `TeamMembership(id, user_id, team_id, role)` with a unique `(user_id, team_id)`
- `WorkItem(id, title, description, status, priority, team_id, assignee_id, version, created_at, updated_at)`
- `WorkItemActivity(id, work_item_id, actor_id, action, description, old_value, new_value, created_at)`

### Roles and permissions

- Global `User.is_admin` sees and manages everything.
- Team roles: `viewer` (read) < `member` (create and edit work items) < `manager` (manage team and members). Legacy role `"admin"` counts as manager.
- `require_team_role(db, user, team_id, minimum)` returns 404 for non-members (so team existence is not leaked) and 403 for insufficient role. Global admins always pass.
- `visible_team_ids(db, user)` returns `None` for global admins (all teams), otherwise a list of team ids.

### Existing endpoints

- `POST /api/auth/login` (form: username=email, password) returns `{access_token, token_type}`.
- `GET /api/auth/me` returns `{id, name, email, is_admin, teams: [{id, name, role}]}`.
- Teams: `GET /api/teams`, `POST /api/teams` (admin), `GET|PATCH|DELETE /api/teams/{id}`,
  `GET|POST /api/teams/{id}/members`, `PATCH|DELETE /api/teams/{id}/members/{user_id}`.
  - `TeamResponse = {id, name, description, member_count, my_role}`
  - `MemberResponse = {user_id, name, email, role, is_active}`
  - `POST members` body is `{email, role}` where role is `manager|member|viewer`.
  - A team must always keep at least one manager (the API returns 409).
- Admin: `GET /api/admin/users?search&skip&limit` returns `{items, total}`; `POST /api/admin/users`; `PATCH /api/admin/users/{id}` (`name`, `is_active`, `is_admin`); `POST /api/admin/users/{id}/reset-password` (204).
  - `AdminUserResponse = {id, name, email, is_admin, is_active, team_count}`
  - Cannot deactivate or demote yourself, nor the last active admin.
- Work items (old, unauthenticated, uses `page`/`page_size`, returns a bare list). **Commit 3 replaces this.**

### Known frontend problems to fix (commit 4)

- `src/lib/api.ts` defaults to port 8001; `AuthContext.login` uses port 8000. Use one base URL.
- Work item list sends `skip`/`limit`, the old backend wanted `page`/`page_size`.
- `src/pages/WorkitemDetailsPage.tsx` is misnamed (lowercase "i"), never imported, and calls an `/activity` endpoint that did not exist.
- Navigation is a `useState` in `App.tsx`, with no URLs and no deep links.
- Assignee is typed in as a raw user ID.
- `DashboardPage` calls `/api/work-items?limit=100` and expects a bare array.
- Dashboard renders its own header and sign-out button on top of the App nav (duplicate).
- `WorkItemsPage` has duplicated "Edit" and "Change status" buttons doing the same thing, plus an inline "selectedItem" panel that the details page replaces.

---

## Commit 3: Work items API

**Message:** `feat(backend): secure work items API with scoping, atomic versioning and activity log`

### 3.1 Schemas (`app/schemas.py`)

Keep `WorkItemCreate` and `WorkItemUpdate`. Add `str_strip_whitespace` to both. Extend and add:

```python
class WorkItemResponse(BaseModel):   # from_attributes=True
    id, title, description, status, priority, team_id, assignee_id,
    version, created_at, updated_at
    team_name: str | None = None
    assignee_name: str | None = None

class WorkItemList(BaseModel):
    items: list[WorkItemResponse]
    total: int

class ActivityResponse(BaseModel):
    id: int
    action: str
    description: str
    actor_name: str | None
    old_value: str | None
    new_value: str | None
    created_at: datetime
```

`ActivityResponse` field names must match the frontend type exactly (`action`, `description`, `actor_name`, `created_at`, `old_value`, `new_value`).

### 3.2 Router (`app/routers/work_items.py`), full rewrite

Every endpoint depends on `get_current_user`.

**`GET /api/work-items`**
- Query params: `search`, `status`, `priority`, `team_id`, `assignee_id`, `skip` (default 0, ≥0), `limit` (default 10, 1 to 100).
- Scope: global admin sees all. Others see only items in `visible_team_ids`. An empty list means an empty result.
- If `team_id` is given and not visible to the user, return 404.
- `search` matches title or description case-insensitively. **Escape `%`, `_` and `\`** in the term and pass `escape="\\"` to `ilike`.
- Returns `WorkItemList` with the pre-pagination `total` (count query), ordered by `updated_at desc, id desc`.
- Include `team_name` and `assignee_name` using joins (no N+1 queries).

**`POST /api/work-items`** (201)
- Requires `require_team_role(..., "member")` on `payload.team_id`.
- If `assignee_id` is set, the assignee must be an **active member of that team**; otherwise 422.
- Create the item and an activity row `action="created"`, `description="Created this work item"`, in the same transaction.

**`GET /api/work-items/{id}`**
- 404 if the item doesn't exist or the user can't see its team. Requires viewer or above.

**`PATCH /api/work-items/{id}`**
- Requires `member` or above on the item's team (viewers get 403).
- Keep the existing status transition rules:
  - `open` → `in_progress`, `blocked`
  - `in_progress` → `open`, `blocked`, `resolved`
  - `blocked` → `open`, `in_progress`
  - `resolved` → `open`
  - Invalid transition: 422 with `Cannot change status from X to Y`.
- New assignee must be an active member of the item's team (422 otherwise). `null` unassigns.
- **Atomic optimistic locking:** apply the change with a single
  `UPDATE work_items SET ..., version = version + 1, updated_at = now WHERE id = :id AND version = :expected`.
  If `rowcount == 0`, reload the item. If it is gone, return 404; otherwise return 409 with
  `detail={"message": "This item was changed by someone else. Reload it and retry.", "current_version": <n>}`.
- Only write fields that actually changed. If nothing changed, return the item unchanged and do not bump the version or log activity.
- Write one `WorkItemActivity` row per changed field, in the same transaction as the update:
  - `status_changed`: old and new status labels
  - `priority_changed`
  - `assignee_changed`: old and new **user names** (`Unassigned` when null)
  - `title_changed`: old and new title (truncate to 255 chars)
  - `description_changed`: description "Updated the description", no values
  - Each `description` is a readable sentence such as `Changed status from Open to In progress`.

**`GET /api/work-items/{id}/activity`**
- Requires viewer or above. Newest first, limit 100. Returns `list[ActivityResponse]` with `actor_name` from a join on users (`null` if the actor was deleted).

### 3.3 Misc

- Roll back and re-raise on unexpected DB errors. Log server errors with `logging.getLogger("opsflow")`.
- Remove the old `page`/`page_size` params entirely.

### Verify

- `uvicorn main:app --port 8000`, then in `/docs`:
  - No token on `/api/work-items` returns 401.
  - A viewer cannot POST or PATCH (403).
  - A user outside the team gets 404 on its items.
  - Two PATCHes with the same `expected_version`: the second returns 409.
  - `GET /api/work-items/{id}/activity` lists the changes.
  - Searching for `%` or `_` does not match everything.

---

## Commit 4: Frontend foundation and work item details

**Message:** `feat(frontend): routing, shared API client, work item details page`

### 4.1 Dependencies and routing

- `npm i react-router-dom`.
- `main.tsx`: wrap in `BrowserRouter`.
- Routes (inside the auth gate; unauthenticated users see `LoginPage`):
  - `/` Dashboard
  - `/work-items` list
  - `/work-items/:id` details
  - `/teams`, `/teams/:id` (added in commit 5)
  - `/admin/users` (added in commit 6, admin only)
  - `*` Not-found page
- Replace the `useState` page switch in `App.tsx` with `NavLink`s (keep the existing nav CSS classes, mapping `ops-nav-active` to the active class). Show the "Teams" link always and the "Admin" link only for `user.is_admin`.
- Add a top-level React `ErrorBoundary` with a friendly fallback and "Reload" button.

### 4.2 API client and types

- `src/lib/api.ts`: single `API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000"`. Export it.
- Make `AuthContext.login` use the shared base URL (export a small `apiLogin` helper or reuse the constant).
- Improve error parsing in `ApiError`: FastAPI `detail` can be a string, a validation array (`[{loc, msg}]`) or an object (`{message, current_version}`). Always produce a readable string; keep `status` and expose `detail` for the 409 case.
- Add `frontend/.env.example` with `VITE_API_BASE_URL=http://localhost:8000`.
- Create `src/types.ts` with shared `WorkItem` (including `team_name?`, `assignee_name?`), `WorkItemList`, `ActivityEvent`, `Team`, `TeamMember`, `WorkStatus`, `Priority` and label helpers. Remove the duplicated local type definitions in each page.

### 4.3 Work items list (`WorkItemsPage.tsx`)

- Use the `{items, total}` envelope. Send `skip` and `limit`.
- Debounce search (300 ms). Reset to page 0 when filters change **without** `setState` inside an effect (derive it in the change handlers).
- Fix the `useCallback` dependency on `refreshKey` and any `react-hooks` lint errors.
- Show `team_name` and `assignee_name` (fall back to `Unassigned`).
- Replace the assignee ID input with a `<select>` populated from `GET /api/teams/{teamId}/members` (active members only) once a team is chosen.
- Remove the inline "selectedItem" panel and the duplicate "Change status" button. Keep one "Edit" and make **"View details"** `navigate("/work-items/:id")`; make the title a link too.
- Hide "+ New work item" and "Edit" when the user has no `member` or `manager` role in any team and is not an admin (viewer-only users get read-only UI). Use `user.teams[].role`.
- Preserve the existing CSS class names so `WorkItemsPage.css` keeps working.

### 4.4 Details page

- `git mv src/pages/WorkitemDetailsPage.tsx src/pages/tmp.tsx && git mv src/pages/tmp.tsx src/pages/WorkItemDetailsPage.tsx` (two-step so the case change registers on case-insensitive file systems).
- Read `:id` with `useParams`; invalid id shows the not-found state. "Back" returns to `/work-items`.
- Show `team_name` and `assignee_name` rather than raw IDs.
- Assignee is a `<select>` from the team's members.
- Read-only mode (no form, no Save button) when the user's role in the item's team is `viewer`.
- Conflict handling: on 409, keep the user's typed values, show a banner with **"Reload latest"** and do not silently overwrite.
- Activity timeline uses `GET /api/work-items/{id}/activity` and reloads after a successful save. Show a clear error state (not silent) if it fails.
- Use `aria-live` on notices and `role="alert"` on errors.

### 4.5 Dashboard

- Read `.items` from the envelope. Request `limit=100`.
- Remove the duplicate header and sign-out button (the App nav already has them). Keep the rest of the layout.
- Link each attention item to `/work-items/:id`.

### Verify

- `npm run lint && npm run build` both pass with zero errors.
- Manual: deep link `/work-items/1` works after refresh; viewer account sees no Edit buttons; editing from two tabs shows the conflict banner; the timeline updates after saving.

---

## Commit 5: Teams and membership UI

**Message:** `feat(frontend): teams list and team membership management`

### Pages

- `src/pages/TeamsPage.tsx` at `/teams`
  - Cards or table: name, description, member count, `my_role`.
  - Admin only: "+ New team" form (name, description) calling `POST /api/teams`.
  - Each team links to `/teams/:id`.
- `src/pages/TeamDetailsPage.tsx` at `/teams/:id`
  - Header with team info. **Managers and admins** can edit name and description (`PATCH`).
  - Members table: name, email, role, status. Managers and admins get:
    - a role `<select>` (`manager|member|viewer`) calling `PATCH .../members/{user_id}`
    - a "Remove" button calling `DELETE` after a confirm dialog
  - "Add member" form (email + role) calling `POST .../members`.
  - Any member sees "Leave team" for themselves (confirm first). After leaving, go to `/teams` and refresh the user via `refreshUser()`.
  - Admin only: "Delete team" (confirm; show the API error if the team still has work items).
- Handle API errors visibly, especially the 409 "must keep at least one manager" message.
- Call `refreshUser()` from `useAuth()` after changes that affect the signed-in user's own memberships or roles.
- Add `TeamsPage.css` and `TeamDetailsPage.css`, reusing the visual style of `WorkItemsPage.css` (same variables, tables, buttons).

### Verify

- Lint and build pass.
- As manager: add, promote, demote, remove a member. Removing or demoting the last manager shows the 409 message.
- As member and viewer: no management controls are shown, and direct API calls still return 403.

---

## Commit 6: Administration UI

**Message:** `feat(frontend): admin user management`

- `src/pages/AdminUsersPage.tsx` at `/admin/users`, **admin only**:
  - Route guard: non-admins are redirected to `/` (the backend returns 403 anyway).
  - Table: name, email, role badge (Admin or User), status (Active or Deactivated), team count.
  - Debounced search (300 ms), pagination with `skip`/`limit` (25 per page) using `{items, total}`.
  - "+ New user" form: name, email, password (min 12, with a show/hide toggle), "Administrator" checkbox. Calls `POST /api/admin/users`.
  - Row actions: Deactivate/Activate, Make/Remove admin, Reset password (inline form, min 12 chars, confirm field).
  - Disable the controls for the current user's own row (deactivate and remove-admin). Show backend errors (such as the last-admin guard) in a visible alert.
  - Confirm before deactivating or removing admin.
- `AdminUsersPage.css` in the same visual style.
- Never keep passwords in state after submit. Clear the fields on success and on cancel.

### Verify

- Lint and build pass.
- Create a user, add them to a team via the Teams UI, deactivate them, and confirm the existing session fails with 401 on its next request (the backend checks `is_active` every call).
- Try deactivating yourself and the only admin; both must be rejected.

---

## Commit 7: Tests, migrations, containers, docs

**Message:** `chore: tests, migrations, Docker, CI and documentation`

### Backend tests (`backend/tests/`, pytest + httpx/TestClient)

- `pip install pytest httpx` and add them to `requirements-dev.txt`.
- `conftest.py`: set `DATABASE_URL=sqlite:///./test.db`, `JWT_SECRET_KEY` (32+ chars) and `APP_ENV=test` **before** importing the app. Create tables per test session, override `get_db` where needed, and provide fixtures for an admin, manager, member, viewer and an outsider with tokens.
- Cover at minimum:
  - login success and failure, inactive user rejected, 401 without a token
  - work item scoping (outsider gets 404, admin sees all)
  - viewer cannot create or edit (403)
  - assignee must be a team member (422)
  - stale `expected_version` returns 409, and a correct one increments the version
  - activity rows written for status, priority and assignee changes
  - `%` search escaping
  - last-manager guard on demote and remove
  - admin guards: self-deactivate, last admin, non-admin gets 403
  - removing a member unassigns their items

### Migrations

- Add Alembic (`alembic` in requirements). Create a baseline revision matching the current models. Document how to stamp an existing database (`alembic stamp head`) and to apply (`alembic upgrade head`).
- `app.init_db` is for local development only. It must refuse to run when `APP_ENV=production`.

### Production hardening

- `seed_demo_accounts.py` and `reset_pass.py` must exit immediately when `APP_ENV=production`.
- Wrap `app/create_admin.py` in `main()` with an `if __name__ == "__main__"` guard (it currently executes on import).
- Login rate limiting: simple in-memory limiter on `POST /api/auth/login` (for example 5 failures per email and IP per 15 minutes, returning 429). Note in the README that a multi-instance deployment needs Redis.
- Add a middleware setting `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Frontend: hide the "Local demo accounts" block on the login page when `import.meta.env.PROD`.

### Frontend tests

- Add Vitest and React Testing Library. Cover: login form error state, route guard for `/admin/users`, `ApiError` message parsing (string, validation array, 409 object).

### Docker and CI

- `backend/Dockerfile`: `python:3.12-slim`, non-root user, installs `requirements.txt`, runs `uvicorn main:app --host 0.0.0.0 --port 8000`.
- `frontend/Dockerfile`: multi-stage (node build, then nginx serving `dist` with an SPA fallback `try_files $uri /index.html`). `VITE_API_BASE_URL` is a build arg.
- `docker-compose.yml` at the repo root: `postgres` (volume and healthcheck), `backend` (env from `.env`, waits for the DB, runs `alembic upgrade head` on start), `frontend`.
- `.github/workflows/ci.yml`: on push and PR, run backend tests, and frontend `npm ci`, `lint`, `test`, `build`.
- Make sure `.gitignore` covers `.env`, `*.db`, `node_modules`, `dist`, `__pycache__`.

### Docs

- Root `README.md`: what OpsFlow is, architecture, local setup (backend, frontend, DB), env var table (`APP_ENV`, `DATABASE_URL`, `JWT_SECRET_KEY`, `TOKEN_EXPIRE_HOURS`, `CORS_ORIGINS`, `LOG_LEVEL`, `VITE_API_BASE_URL`), the role and permission matrix, how to create the first admin (`python -m app.create_admin`), migrations, tests, deployment notes and a short security checklist.

### Verify

- `pytest` passes. Frontend `npm run lint && npm test && npm run build` pass.
- `docker compose up --build` brings up all three services; `/api/health` returns healthy; the app loads at the frontend port.

---

## Role and permission matrix (reference)

| Action | Viewer | Member | Manager | Global admin |
|---|---|---|---|---|
| View team and its work items | Yes | Yes | Yes | Yes (all teams) |
| Create or edit work items | No | Yes | Yes | Yes |
| Edit team, manage members | No | No | Yes | Yes |
| Leave a team (not the last manager) | Yes | Yes | Yes | n/a |
| Create or delete teams | No | No | No | Yes |
| Manage users (`/api/admin/*`) | No | No | No | Yes |