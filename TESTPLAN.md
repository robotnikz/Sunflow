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

## 5) Non-functional Tests

### a) Performance & load
- Manual/optional automated load with `autocannon` against `/api/info` and `/api/history`.

### b) Stability & reliability
- Long-run (24h): polling, retention, restart/resume, DB file growth.
- Soak (lightweight, automatable): `npm run soaktest -- --url http://localhost:3000 --duration 3600 --interval 2`
	- Expected: no 5xx, no timeouts, stable status codes.
	- For Docker: `docker compose up -d` then run soaktest against the published port.
	- Optional: run `docker compose restart` during the soak and verify the service recovers cleanly.

For a concrete 24h checklist (restart/resume, outage simulation, what to monitor), see `OPERATIONS.md`.

### c) Security
- AuthN/Z: admin token enforced
- Input validation: invalid bodies/IDs
- Secrets: redaction when admin token is enabled
- Automated regressions: see `tests/api.security.regression.test.ts` (CORS allowlist + webhook SSRF guard).

Manual self-hosting checklist: `SECURITY_CHECKLIST.md`.

## 6) Usability & UX

- Clear copy, consistent validation, actionable error messages.

Checklist: `UX_CHECKLIST.md`.

## 7) Compatibility & environment

- Browser (E2E): Chromium/Firefox/WebKit (via Playwright)
- OS: Windows & Linux (tests are Windows-friendly; temp file cleanup accounts for EPERM retries)
- Node.js: tested via `package.json`; recommended: LTS (e.g. Node 20/22)
- Deployment: Docker, reverse proxy (TRUST_PROXY), Windows/Linux
- Storage: SQLite DB persisted via volume (`/app/data`)

## 8) Regression

Goal: Catch regressions early without slowing CI unnecessarily.

Recommended pipeline (documentation; may differ from current CI implementation):

- On every PR/push: `npm ci`, `npm run typecheck`, `npm run test:run`
- Optional/nightly: `npm run test:e2e` (Playwright; requires `npm run playwright:install` in CI)
- Release: same as PR/push, plus container build/publish

Note: E2E can run nightly to reduce CI flakiness impact.

## 9) Deployment & operations scenarios

- Update/rollback via image tags (pinning recommended)
	- Recommendation: pin production deployments to a version tag (`ghcr.io/robotnikz/sunflow:<version>`), not only `latest`.
	- Update: change the tag and restart the container.
	- Rollback: switch back to the previous tag and restart.
- DB persisted via volume
	- Docker Compose: `./sunflow-data:/app/data`
	- Backup: copy `sunflow-data/solar_data.db` (container stopped or via file copy).
	- Monitoring: DB growth, CPU/RAM (especially during long polling/soak)

Manual ops scenarios (short):
- Restart/resume: `docker compose restart` while `npm run soaktest` is running
- Network outage: inverter IP temporarily unreachable → API must not crash; UI should remain usable

For a practical runbook (backup/restore, upgrades/rollbacks, monitoring), see `OPERATIONS.md`.

## 10) Docs & tests

- README/setup/examples must stay consistent with current behavior.
- References:
	- Security: `AUDIT.md`
	- Tests: this test plan + `npm run test:run` / `npm run test:e2e`

## How to run

- Unit/integration: `npm run test:run`
- Typecheck: `npm run typecheck`
- Load test (manual): `npm run loadtest -- --url http://localhost:3000 --duration 10 --connections 25`
- Soak/stability (manual): `npm run soaktest -- --url http://localhost:3000 --duration 3600 --interval 2`
