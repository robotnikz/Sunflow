# SunFlow Operations Runbook

This document focuses on day-2 operations: backups, upgrades, rollbacks, and basic troubleshooting.

## Recommended deployment defaults

- Pin production deployments to a version tag (or digest), not only `:latest`.
- Persist data via a bind mount (`./sunflow-data:/app/data`).
- If exposed beyond your LAN, use a reverse proxy with TLS and authentication.

## Data persistence layout

SunFlow stores state in the directory configured as `DATA_DIR` (Docker image default: `/app/data`).

Typical files:

- `config.json` (runtime configuration)
- `solar_data.db` (SQLite database)
- `uploads/` (temporary upload files)

If you see `SQLITE_READONLY: attempt to write a readonly database`, the container user likely cannot write to your bind-mounted data directory (common after upgrading from an older image that ran as root). Fix the host folder permissions/attributes, then restart the container.

## Backup & restore

### Backup (Docker Compose)

SunFlow stores its data in the `./sunflow-data/` folder next to your `docker-compose.yml` (mounted to `/app/data` in the container).

#### Backup

1. Stop the container (recommended to avoid copying a changing DB):

   - `docker compose stop`

2. Copy the entire data directory:

   - `cp -r ./sunflow-data ./sunflow-data.backup-YYYYMMDD`

3. Start the container again:

   - `docker compose start`

### Restore (Docker Compose)

#### Restore

1. Stop the container:

   - `docker compose stop`

2. Replace the data directory with a backup:

   - `rm -rf ./sunflow-data`
   - `cp -r ./sunflow-data.backup-YYYYMMDD ./sunflow-data`

3. Start the container:

   - `docker compose start`

Notes:

- If you use filesystem snapshots (NAS), prefer snapshots over file copies.
- If you must back up while running, copy the whole directory and validate the DB on restore.

## Upgrade & rollback

### Upgrade

Upgrade keeps your DB/history as long as you keep your `./sunflow-data/` folder and the mount `./sunflow-data:/app/data` unchanged.

1. Update the image tag in `docker-compose.yml`.

   Example:

   - `ghcr.io/robotnikz/sunflow:1.11.0`

2. Pull and restart:

   - `docker compose pull`
   - `docker compose up -d`

### Rollback

1. Switch the image tag back to the last known-good version.
2. Pull and restart:

   - `docker compose pull`
   - `docker compose up -d`

## Health checks & monitoring

### Container health

The official image includes a Docker `HEALTHCHECK` against `GET /api/info`.

Check status:

- `docker ps` (look for `healthy`)
- `docker inspect sunflow --format '{{json .State.Health}}'`

### Logs

- `docker logs -f sunflow`

### Basic resource monitoring

- CPU/memory: `docker stats sunflow`
- Disk usage:
   - monitor the `sunflow-data/` directory growth over time

## Reverse proxy notes

If you run SunFlow behind a reverse proxy (nginx, Traefik, Caddy):

- Set `TRUST_PROXY=1` so rate limiting and IP logic behave correctly.
- Avoid exposing the raw container port publicly without auth.

## Common failure modes

### 1) UI loads but charts are empty

- Verify the data directory is mounted correctly (`./sunflow-data:/app/data`).
- Check logs for SQLite errors.

### 2) Forecast fails

- Ensure Solcast is configured.
- Nighttime behavior is expected to skip Solcast calls.

### 3) CSV import fails

- Verify upload size limits (`UPLOAD_MAX_BYTES`).
- Check logs for validation errors.

## Stability exercises (manual)

- Restart/resume: run a soak test (see [CONTRIBUTING.md](CONTRIBUTING.md)) and execute `docker compose restart` during the run.
- Network outage: temporarily block inverter access and confirm the process stays alive and the UI remains usable.

## 24h stability checklist (manual)

This is a practical long-run validation to catch leaks, unhandled errors, and “slow degradation” issues.

### Before you start

- Use a persistent bind mount (`./sunflow-data:/app/data`).
- Ensure the container is healthy:
   - `docker ps` (should show `healthy`)
   - `docker logs --tail 200 sunflow` (no crash loop)

### Run

1. Start the container:

    - `docker compose up -d`

2. Start a lightweight soak against the running service:

   - Run the soak test script (see [CONTRIBUTING.md](CONTRIBUTING.md)).

3. During the 24h period, perform these exercises:

    - Restart/resume: `docker compose restart`
    - Stop/start: `docker compose stop` then `docker compose start`
    - Network outage simulation: make the inverter IP unreachable for ~5-10 minutes (router rule / firewall), then restore connectivity

### What to monitor

- Health status stays `healthy` (no flapping).
- Logs:
   - no repeated unhandled exceptions
   - no repeated DB “busy/locked” errors
- Resource usage:
   - `docker stats sunflow` (CPU/memory does not grow without bound)
- Disk:
   - data directory growth is plausible for your retention settings

### Expected outcome

- No sustained 5xx responses during normal operation.
- After restart or network outage, the service recovers without manual intervention.
- UI stays usable (even if live data temporarily fails).
