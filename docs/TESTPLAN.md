# Test Plan (SunFlow)

Status: Work in progress (Branch: `audit-2026-01-15-security-hardening`) — focus: regression safety + operational scenarios.

## 1) Functional Tests (What should the software do?)

Goal: Verify the application meets its requirements (“does the system do exactly what is specified?”).

### Core features / business logic (use cases)

| Area | Use case | Expectation | Automated? |
|---|---|---|---|
| Config | Read/write config | GET returns defaults, POST persists, validation enforced | partially |
| Realtime | Fetch live data | Missing IP -> error; with IP -> stable data model | partially |
| Forecast | Solcast forecast | Cached during daytime, no Solcast calls at night, meaningful errors | partially |
| Tariffs | CRUD | Validation, at least 1 tariff remains, correct status codes | yes |
| Expenses | CRUD | Validation, correct status codes | yes |
| CSV Import | Preview/import | Preview returns headers+preview; import writes DB; tmp cleanup; clean error paths | yes |
| Notifications | Test notification | Only allowed Discord webhooks; robust error handling | yes |
| Update Check | /api/info | No network dependency in tests; latestVersion/updateAvailable set | yes |

### Edge cases
- Empty inputs (e.g. missing/invalid `mapping`)
- Limits (upload size, JSON body limit)
- Invalid data (IDs, dates, negative values outside allowed ranges)

### Error handling
- Every API returns consistent JSON errors and appropriate status codes.

### Authorization / roles
- Optional: `SUNFLOW_ADMIN_TOKEN` enables admin-only behavior for mutating endpoints.

## 2) Unit Tests

Goal: Test isolated logic (fast, CI-friendly).

- `services/api.ts`: query string building, error paths for `!res.ok`, parsing.

## 3) Integration Tests

Goal: Validate component interaction.

- Backend ↔ SQLite (temporary data dir)
- Backend ↔ external APIs via mocks (axios)

## 4) System Tests / E2E

Goal: Validate UI ↔ backend as a whole.

- Playwright smoke: app loads, dashboard visible, settings open.
- Playwright regression: settings persistence + critical UX guards.
- Playwright mocked broad coverage: deterministic UI coverage with mocked `/api/*` and Open‑Meteo (runs without inverter/external network).

Notes:
- The mocked E2E suite uses Playwright request interception and synthetic fixtures only (no secrets, no real production data).
- This keeps the repo CI/public-friendly while still providing high confidence UI coverage.

## 5) Non-functional Tests

### a) Performance & load
- Manual/optional automated load with `autocannon` against `/api/info` and `/api/history`.

### b) Stability & reliability
- Long-run (24h): polling, retention, restart/resume, DB file growth.

- Soak (lightweight, automatable): run the soak test script (see [CONTRIBUTING.md](../CONTRIBUTING.md)).
	- Expected: no 5xx, no timeouts, stable status codes.
	- For Docker: start the container via Compose, then run the soak test against the published port.
	- Optional: restart the container during the soak and verify the service recovers cleanly.

For a concrete 24h checklist (restart/resume, outage simulation, what to monitor), see [OPERATIONS.md](OPERATIONS.md).

### c) Security
- AuthN/Z: admin token enforced
- Input validation: invalid bodies/IDs
- Secrets: redaction when admin token is enabled
- Automated regressions: see `tests/api.security.regression.test.ts` (CORS allowlist + webhook SSRF guard).

Manual self-hosting checklist: [SECURITY.md](../SECURITY.md).

## 6) Usability & UX

- Clear copy, consistent validation, actionable error messages.

Checklist: [UX_CHECKLIST.md](UX_CHECKLIST.md).

## 7) Compatibility & environment

- Browser (E2E): Chromium/Firefox/WebKit (via Playwright)
- OS: Linux (recommended for self-hosting and CI-like parity)
- Node.js: tested via `package.json`; recommended: LTS (e.g. Node 20/22)
- Deployment: Docker, reverse proxy (TRUST_PROXY)
- Storage: SQLite DB persisted in `./sunflow-data/` (bind mount to `/app/data`)

## 8) Regression

Goal: Catch regressions early without slowing CI unnecessarily.

Recommended pipeline (documentation; may differ from current CI implementation):

- On every PR/push: run the standard checks (see [CONTRIBUTING.md](CONTRIBUTING.md))
- Optional/nightly: run E2E (Playwright)
- Release: same as PR/push, plus container build/publish

Note: E2E can run nightly to reduce CI flakiness impact.

## 9) Deployment & operations scenarios

- Update/rollback via image tags (pinning recommended)
	- Recommendation: pin production deployments to a version tag (`ghcr.io/robotnikz/sunflow:<version>`), not only `latest`.
	- Update: change the tag and restart the container.
	- Rollback: switch back to the previous tag and restart.

- DB persisted via bind mount (Docker Compose default): `./sunflow-data:/app/data`
	- Backup: stop container, then copy the `sunflow-data/` directory (see [OPERATIONS.md](OPERATIONS.md)).
	- Monitoring: DB growth, CPU/RAM (especially during long polling/soak)

Manual ops scenarios (short):
- Restart/resume: restart the container while a soak test is running
- Network outage: inverter IP temporarily unreachable → API must not crash; UI should remain usable

For a practical runbook (backup/restore, upgrades/rollbacks, monitoring), see `OPERATIONS.md`.

## 10) Docs & tests

- README/setup/examples must stay consistent with current behavior.
- References:
	- Security: `AUDIT.md`
	- How to run tests: see [CONTRIBUTING.md](CONTRIBUTING.md)

## How to run

See [CONTRIBUTING.md](CONTRIBUTING.md) for the exact commands (tests, Playwright, load/soak scripts).
