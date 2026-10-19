# OpsWork

OpsWork is a team-based operations work management application. It provides a
React single-page frontend and a FastAPI backend backed by PostgreSQL, with
JWT authentication, team-scoped permissions, work-item activity history, and
optimistic concurrency for edits.

## Architecture

- `frontend/`: React, TypeScript, Vite, and React Router.
- `backend/`: FastAPI, SQLAlchemy, Alembic, and PostgreSQL.
- `backend/app/routers/`: authentication, teams, work items, and administration
  API endpoints.
- `backend/migrations/`: versioned database schema.
- `.github/workflows/ci.yml`: backend and frontend validation on pushes and pull
  requests.

## Local development

### Requirements

- Python 3.12+
- Node.js 22+ and npm
- PostgreSQL 16+

Create a database and copy the backend environment example:

```powershell
Copy-Item backend\.env.example backend\.env
```

Set `DATABASE_URL` in `backend\.env` to your local PostgreSQL instance and set
`JWT_SECRET_KEY` to a random secret of at least 32 characters. Then install the
backend and frontend dependencies:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt -r requirements-dev.txt
alembic upgrade head
uvicorn main:app --reload
```

In a second terminal:

```powershell
cd frontend
Copy-Item .env.example .env.local
npm ci
npm run dev
```

The frontend runs at `http://localhost:5173`; the API runs at
`http://localhost:8000`. The interactive API docs are available at
`http://localhost:8000/docs` outside production. Set `VITE_API_BASE_URL` in
`frontend/.env.local` if the API is hosted elsewhere.

### First administrator

After applying the migrations, create an administrator interactively from
`backend/`:

```powershell
python -m app.create_admin
```

The command prompts for the account details and password. Do not use demo
account seeding in production. With Docker Compose, run it interactively using
`docker compose exec backend python -m app.create_admin`.

## Environment variables

| Variable | Purpose | Example/default |
|---|---|---|
| `APP_ENV` | Runtime environment; use `production` for deployment safeguards. | `development` |
| `DATABASE_URL` | SQLAlchemy database connection URL. | `postgresql+psycopg://user:pass@localhost:5432/opsflow` |
| `JWT_SECRET_KEY` | Secret used to sign access tokens; at least 32 characters in production. | Generate a unique secret |
| `TOKEN_EXPIRE_HOURS` | Access-token lifetime in hours. | `8` |
| `CORS_ORIGINS` | Comma-separated allowed browser origins; set explicit origins in production. | `http://localhost:5173` |
| `LOG_LEVEL` | Backend logging level. | `INFO` |
| `VITE_API_BASE_URL` | API origin compiled into the frontend build. | `http://localhost:8000` |
| `POSTGRES_DB` | Docker Compose database name. | `opsflow` |
| `POSTGRES_USER` | Docker Compose PostgreSQL user. | `opsflow` |
| `POSTGRES_PASSWORD` | Docker Compose PostgreSQL password. | Set a unique strong password |

For Compose, use URL-safe characters in `POSTGRES_PASSWORD` because Compose
interpolates it into the PostgreSQL connection URL.

## Roles and permissions

| Action | Viewer | Member | Manager | Global admin |
|---|---|---|---|---|
| View a team's work items | Yes | Yes | Yes | Yes, across all teams |
| Create or edit work items | No | Yes | Yes | Yes |
| Edit team settings and manage members | No | No | Yes | Yes |
| Leave a team (unless the last manager) | Yes | Yes | Yes | N/A |
| Create or delete teams | No | No | No | Yes |
| Manage users | No | No | No | Yes |

## Database migrations

Use Alembic to apply the current schema and later upgrades:

```powershell
cd backend
alembic upgrade head
```

For a database that already has the matching schema created by the original
development initialization, record the baseline without recreating its tables:

```powershell
alembic stamp head
```

Only stamp a database after confirming that its schema matches the baseline
models. `app.init_db` is intended for local development and refuses to run in
production.

## Tests and quality checks

Backend tests use an isolated SQLite database:

```powershell
cd backend
python -m pip install -r requirements.txt -r requirements-dev.txt
pytest
```

Frontend tests, lint, and production build:

```powershell
cd frontend
npm ci
npm test
npm run lint
npm run build
```

## Docker Compose

Copy the root environment template and replace its example secrets/passwords:

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Compose starts PostgreSQL, waits for it to become healthy, applies Alembic
migrations in the backend container, then starts the API and frontend. The
frontend is available at `http://localhost:8080`, and the API health endpoint is
`http://localhost:8000/api/health`. PostgreSQL data persists in the
`postgres_data` volume.

For production, terminate TLS at a trusted ingress or reverse proxy, use unique
strong secrets and database credentials, restrict network access, and manage
backups and migrations as part of deployment. A multi-instance API deployment
must replace the in-memory login rate limiter with a shared store such as Redis.

## Security checklist

- Set `APP_ENV=production`, a unique 32+ character `JWT_SECRET_KEY`, and
  explicit `CORS_ORIGINS`.
- Keep `.env` files and database files out of version control.
- Use HTTPS, restrictive network rules, strong PostgreSQL credentials, and
  regular backups.
- Run Alembic migrations deliberately and verify the target database before
  stamping an existing schema.
- Do not expose local demo accounts or development initialization scripts in
  production.
- Use Redis or another shared limiter for multiple backend instances.
