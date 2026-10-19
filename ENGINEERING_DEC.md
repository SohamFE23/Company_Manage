# OpsWork Engineering Decisions

This document records the current implementation decisions that shape
development and deployment. It describes what the repository does today; it is
not a substitute for the security and operations guidance in the README.

## Application structure

- **Separate frontend and API:** The browser application is a React 19,
  TypeScript, and Vite single-page app. The API is a FastAPI application in
  `backend/`. This keeps UI concerns separate from authentication,
  authorization, and persistence.
- **REST-style JSON API:** The frontend uses a shared API client and the
  backend exposes authentication, team, work-item, and administrator routes
  under `/api`.
- **PostgreSQL as the deployment database:** SQLAlchemy 2 models describe the
  persisted entities. PostgreSQL is the production/deployment database;
  SQLite is used for isolated backend tests.

## Authentication and authorization

- **JWT bearer tokens:** Login issues signed access tokens. The frontend keeps
  the token in session storage and sends it in the `Authorization` header.
  Tokens expire according to `TOKEN_EXPIRE_HOURS` (8 hours by default).
- **Authorize on the server:** Team visibility and role checks are enforced by
  backend dependencies and route logic. Hiding controls in the frontend is
  presentation, not the security boundary.
- **Team roles and global administration:** Team roles are `viewer`, `member`,
  and `manager`; a global administrator can manage users and all teams.
  Non-members are not given details that would reveal inaccessible team
  resources.
- **Password hashing:** Account passwords are stored as hashes through
  `pwdlib`'s recommended password hasher. Passwords are never stored as
  plaintext in the database.
- **Conservative demo-account defaults:** Local demo controls are omitted from
  production frontend builds. Judge accounts are provisioned only by an
  explicit production command, receive generated one-time credentials, and
  have a deactivation path.

## Data consistency

- **Versioned work-item edits:** Updates include `expected_version`. The API
  rejects stale edits with `409 Conflict` rather than silently overwriting a
  more recent change.
- **Activity history:** Work-item create/update actions are stored as activity
  records in the same database transaction as the corresponding change.
- **Database schema changes use Alembic:** The baseline and future schema
  changes are versioned. `create_all` initialization is reserved for local
  development and explicitly refuses production.
- **Preserve relationships:** Database foreign keys and unique constraints
  enforce important relationships, including unique team membership per user.

## Runtime and deployment

- **Configuration comes from environment variables:** Runtime environment,
  database URL, JWT secret, token duration, CORS origins, and logging level are
  configured outside source code. Production requires an explicit CORS allow
  list and a JWT secret of at least 32 characters.
- **Containerized reference deployment:** Docker Compose describes PostgreSQL,
  the API, and the static frontend. The API waits for PostgreSQL health and
  applies Alembic migrations before starting.
- **Production transport/security headers:** TLS is expected at a trusted
  ingress or reverse proxy. The API adds `nosniff`, frame-denial, and
  no-referrer headers; interactive API documentation is disabled in production.
- **One CI workflow:** Pushes and pull requests run backend tests and frontend
  install, lint, test, and build checks. CI does not deploy the application.

## Testing decisions

- Backend API tests run against SQLite to keep them isolated and independent of
  an external database service.
- Frontend component tests use Vitest, jsdom, and React Testing Library.
- The production frontend build runs TypeScript project checks before Vite
  emits static assets.
- Docker Compose configuration can be validated without a running Docker
  daemon. Building and running containers still requires an available daemon.

## Operational implications

- The login failure limiter is process-local and in-memory. Multiple API
  instances need a shared limiter (for example Redis).
- Frontend `VITE_API_BASE_URL` is compiled into the static bundle at build time;
  changing it requires rebuilding the frontend image/assets.
- Judge demo passwords are generated when provisioned and printed once. They
  must be distributed through a private channel and revoked when evaluation
  ends.
- Existing databases with the baseline schema must be checked before using
  `alembic stamp head`; stamping records migration state without changing table
  structure.
