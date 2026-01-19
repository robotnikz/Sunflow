# SunFlow Audit (Architecture, Security, Hardening)

Date: 2026-01-15
Branch: `audit-2026-01-15-security-hardening`

## Architecture (as implemented)

- Single-container “monolith”: React/Vite static frontend served from the same Express backend.
- Persistent state stored in SQLite under `/app/data` (mounted data directory in Docker Compose; bind-mounted by default).
- Background jobs:
  - 1-minute inverter polling
  - hourly retention/aggregation job
- External integrations:
  - Fronius Solar API via HTTP to a user-configured `inverterIp`
  - Solcast API via HTTPS using user-provided API key
  - Discord notifications via webhook
  - GitHub Releases check via GitHub API

## Threat model assumptions

This project is typically run on a home LAN/NAS/Raspberry Pi. If the service is exposed to the public internet without authentication, an attacker can:

- read/modify configuration
- trigger network requests (SSRF) via webhook/test endpoints and potentially via inverter host
- upload CSV files to influence/overwrite stored history

Because of that, the safest stance is: **do not expose SunFlow to the internet without a reverse proxy + auth**.

## High-impact findings (summary)

### 1) Missing auth on write/admin endpoints
- Risk: anyone who can reach the port can change settings, import data, and potentially trigger network actions.
- Fix added: optional Bearer token protection for write/admin routes (`SUNFLOW_ADMIN_TOKEN`).

### 2) SSRF via Discord webhook handling
- Risk: `/api/test-notification` could be used to POST to arbitrary URLs if reachable.
- Fix added: webhook allowlist (HTTPS + Discord webhook host + `/api/webhooks/…`).

### 3) Overly-permissive CORS
- Risk: in a browser context, any site could call the API if user visits a malicious webpage, as long as the service is reachable.
- Fix added: secure-by-default CORS (prod requires explicit allowlist via `CORS_ORIGIN`; dev allows localhost:5173).

### 4) Unbounded CSV upload / parsing
- Risk: memory/CPU DoS with large uploads; JSON parsing exceptions could leak temp files.
- Fix added: Multer upload limits + safer parsing and cleanup.

### 5) Docker hardening
- Risk: running as root and using non-LTS Node image increases blast radius and operational risk.
- Fix added: switch to Node 22 LTS image, run as non-root, add healthcheck.

## Changes implemented in this branch

- Server hardening (see `server.js`):
  - `x-powered-by` disabled
  - optional `TRUST_PROXY`
  - CORS allowlist behavior
  - optional admin Bearer token on write routes
  - secret redaction in `/api/config` when admin token is set
  - Discord webhook allowlist
  - inverter host sanitization
  - upload limits and robust cleanup
  - fixed a runtime issue in `/api/forecast` outside daylight window

- Container hardening (see `docker/Dockerfile`):
  - Node 22 LTS
  - reproducible installs via lockfile
  - non-root execution (`USER node`)
  - healthcheck to `/api/info`

## Recommended deployment hardening (Compose)

Example additions to `docker-compose.yml`:

```yaml
services:
  sunflow:
    # If you use a reverse proxy in front, set TRUST_PROXY
    environment:
      - TRUST_PROXY=1
      # Optional: protect admin/write endpoints
      # - SUNFLOW_ADMIN_TOKEN=change-me-long-random
      # If you run the UI from another origin:
      # - CORS_ORIGIN=https://your-domain.example

    # Container hardening (verify compatibility in your setup)
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

Notes:
- `read_only: true` requires that all writes happen under the mounted `/app/data` volume and temp files use `/tmp` (tmpfs).
- If you expose the service beyond your LAN, put it behind a reverse proxy with TLS and authentication.

## Operational recommendations

- Prefer pinning images by version tag or digest in Compose (avoid `:latest` for predictable rollbacks).
- Keep secrets out of config responses when possible; if you set `SUNFLOW_ADMIN_TOKEN`, secrets are redacted for non-admin requests.

See also:
- Practical self-hosting checklist: [SECURITY.md](../SECURITY.md)
- Day-2 operations runbook: [OPERATIONS.md](OPERATIONS.md)

## Env var reference (added/used)

- `SUNFLOW_ADMIN_TOKEN`: if set, write/admin routes require `Authorization: Bearer <token>`.
- `SUNFLOW_PROTECT_SECRETS`: default `true` when `SUNFLOW_ADMIN_TOKEN` is set; set to `false` to disable redaction.
- `CORS_ORIGIN` / `SUNFLOW_CORS_ORIGIN`: comma-separated allowlist for browsers.
- `CORS_DISABLED` / `SUNFLOW_CORS_DISABLED`: set to `true` to disable CORS middleware entirely.
- `TRUST_PROXY`: set to `1`/`true` when behind a reverse proxy.
- `UPLOAD_MAX_BYTES`: CSV upload max size (default 15MB).
- `JSON_BODY_LIMIT`: JSON body size limit (default `1mb`).
