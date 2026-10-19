# OpsWork Limitations

This document lists known product and operational constraints in the current
implementation. It is intended to set expectations, not to imply that any
specific limitation is a defect.

## Deployment and operations

- The repository provides a Docker Compose reference deployment, not a
  production cloud platform configuration. TLS termination, domain/DNS,
  hosting, secret management, backups, alerting, and recovery procedures must
  be supplied by the deployment environment.
- The current CI workflow validates code but does not build, publish, or deploy
  release artifacts.
- A live Docker-based deployment could not be smoke-tested in the development
  environment because the Docker daemon was unavailable. Compose syntax and
  application-level checks were validated separately.
- The frontend API origin is embedded at build time through
  `VITE_API_BASE_URL`; changing the API host requires rebuilding the frontend.
- Operational metrics, distributed tracing, and centralized log aggregation
  are not configured by this repository.

## Scaling and security

- Login rate limiting is held in process memory. It resets when the process
  restarts and is not shared across instances; multi-instance deployments need
  a shared store such as Redis and appropriate proxy/client-IP handling.
- Access tokens are bearer tokens stored in browser session storage. A
  same-origin script execution vulnerability could access the token; production
  deployments should use HTTPS, keep dependencies current, and apply an
  appropriate Content Security Policy at the serving layer.
- The backend currently has no built-in password reset email flow, MFA, SSO,
  or self-service account registration; administrators create and manage users.
- Judge demo accounts are temporary shared evaluation identities, not suitable
  for real customer data or general public signup. Their passwords are shown
  only during provisioning and must be shared privately.

## Data and integrations

- The application currently models users, teams, memberships, work items, and
  work-item activity. It has no file attachments, notifications, external
  integrations, or configurable workflow engine.
- PostgreSQL is the intended deployed database. SQLite tests provide fast
  isolation but do not fully reproduce PostgreSQL behavior; release validation
  should include an integration run against the target PostgreSQL version.
- There is no automated backup or restore mechanism in the application;
  database backup schedules, retention, and restore testing are deployment
  responsibilities.
- Pagination is request-driven by API parameters; there is no background
  archival or data-retention policy.

## User experience and validation

- The application is a browser-based single-page app; the repository does not
  provide native mobile applications or offline synchronization.
- Automated frontend coverage is focused on selected components and API error
  formatting. A comprehensive browser end-to-end suite across all workflows
  and browsers is not currently configured.
- The application has no localization framework; the UI is currently English.

## Current verification boundary

Unit/API tests, frontend lint/tests/build, migration checks, and Compose
configuration validation cover important behavior. They do not replace
production-like verification of PostgreSQL, container startup, HTTPS ingress,
secrets, backups, or the target hosting platform.
