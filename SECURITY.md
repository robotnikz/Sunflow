# SunFlow Security Checklist (Self-hosting)

This checklist is meant as a practical “before you expose it beyond your LAN” guide.

If you only run SunFlow on a trusted home LAN, you can skip some items — but **do not publish the container port directly to the internet without authentication**.

## 1) Network exposure

- Prefer binding to LAN only (or use a VPN). Avoid public port-forwarding.
- If exposed beyond your LAN, put SunFlow behind a reverse proxy with:
  - TLS
  - authentication (Basic Auth / SSO / OAuth2 / forward-auth)
  - rate limiting (proxy-level, optional)
- Use firewall rules to limit who can reach the service.

## 2) Required environment hardening

- Set an admin token:
  - `SUNFLOW_ADMIN_TOKEN` to a long, random value
  - Call write endpoints with `Authorization: Bearer <token>`
- Set a CORS allowlist for browser access from non-localhost origins:
  - `CORS_ORIGIN=https://your-domain.example` (comma-separated list)
- If running behind a reverse proxy, set:
  - `TRUST_PROXY=1`

Verification steps:
- Without `Authorization: Bearer …`, write endpoints should return `401`.
- `GET /api/config` should redact secrets when admin token protection is enabled.

## 3) Discord webhook SSRF guard

- Only configure Discord webhook URLs from Discord.
- Avoid “generic webhook relays” or self-hosted endpoints.
- If you keep notifications disabled, you can leave the webhook empty.

Verification steps:
- Calling the test-notification endpoint with a non-Discord URL must be rejected.

## 4) Container & Compose hardening (optional but recommended)

The image runs as non-root and includes a healthcheck.

You can further harden Docker Compose:

```yaml
services:
  sunflow:
    read_only: true
    tmpfs:
      - /tmp
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
```

Notes:
- `read_only: true` requires all writes to happen under the mounted `/app/data` data directory and temp files to use `/tmp`.

## 5) Updates & rollback strategy

- Pin production to a version tag (or digest), not only `:latest`.
- Keep the last known-good tag available for rollback.
- Practice rollback once (see [docs/OPERATIONS.md](docs/OPERATIONS.md)).

## 6) Backups

- Back up the whole data directory (config + DB + uploads).
- Perform a restore drill at least once.

See [docs/OPERATIONS.md](docs/OPERATIONS.md) for backup/restore commands.
