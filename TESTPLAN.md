# Testplan (SunFlow)

Status: In Arbeit (Branch: `audit-2026-01-15-security-hardening`) — Fokus: Regression-Sicherheit + Betriebsszenarien.

## 1) Funktionale Tests (Was soll die Software tun?)

Ziel: Erfüllt die Software die Anforderungen? „Tut das System genau das, was spezifiziert ist?“

### Kernfunktionen / Business-Logik (Use-Cases)

| Bereich | Use Case | Erwartung | Automatisiert? |
|---|---|---|---|
| Config | Config lesen/schreiben | GET liefert Defaults, POST persistiert, Validierung greift | teilweise |
| Realtime | Live-Daten abrufen | Bei fehlender IP -> Fehler; bei IP -> Datenmodell stabil | teilweise |
| Forecast | Solcast Forecast | Tagsüber cached, nachts keine Solcast-Calls, valide Fehlermeldungen | teilweise |
| Tarife | CRUD | Validierung, min. 1 Tariff bleibt, korrekte Statuscodes | vorhanden |
| Expenses | CRUD | Validierung, korrekte Statuscodes | vorhanden |
| CSV Import | Preview/Import | Preview liefert Header+Preview, Import schreibt DB, Cleanup tmp, Fehlpfade sauber | vorhanden |
| Notifications | Test notification | Nur erlaubte Discord Webhooks; Fehlerhandling sauber | vorhanden |
| Update Check | /api/info | Keine Netz-Abhängigkeit in Tests; latestVersion/updateAvailable gesetzt | vorhanden |

### Grenzfälle
- Leere Eingaben (z.B. `mapping` fehlt/invalid)
- Maximalwerte (Upload-Größe, JSON Body Limit)
- Ungültige Daten (IDs, Dates, negative Werte außerhalb Clamp)

### Fehlermeldungen & Exception-Handling
- Jede API liefert konsistente JSON-Errors und passende Statuscodes.

### Berechtigungen & Rollen
- Optional: `SUNFLOW_ADMIN_TOKEN` aktiviert Admin-only Verhalten für mutierende Endpunkte.

## 2) Unit Tests

Ziel: Einzelne Funktionen isoliert testen (schnell, CI-geeignet).

- `services/api.ts`: QueryString-Building, Fehlerpfade bei `!res.ok`, Parsing.

## 3) Integrationstests

Ziel: Zusammenspiel Komponenten.

- Backend ↔ SQLite (temp data dir)
- Backend ↔ externe APIs via mocks (axios)

## 4) Systemtests / E2E

Ziel: UI ↔ Backend als Ganzes.

- Playwright Smoke: App lädt, Dashboard sichtbar, Settings öffnen.

## 5) Nicht-funktionale Tests

### a) Performance & Last
- Manuell/optional automatisiert mit `autocannon` gegen `/api/info` und `/api/history`.

### b) Stabilität & Zuverlässigkeit
- Long-run (24h): polling, retention, restart/resume, DB file growth.
- Soak (leichtgewichtig, automatisierbar): `npm run soaktest -- --url http://localhost:3000 --duration 3600 --interval 2`
	- Erwartung: keine 5xx, keine Timeouts, Statuscodes bleiben stabil.
	- Für Docker-Setup: `docker compose up -d` und dann soaktest gegen den veröffentlichten Port.
	- Optional: währenddessen `docker compose restart` ausführen und beobachten, ob der Service sauber wieder hochkommt.

### c) Sicherheit
- AuthN/Z: Admin token enforced
- Input validation: invalid bodies/IDs
- Secrets: redaction wenn Admin token aktiv
- Automated regressions: siehe Tests in `tests/api.security.regression.test.ts` (CORS-Allowlist + Webhook-SSRF-Guard).

## 6) Usability & UX

- Verständliche Texte, konsistente Validierung, klare Fehlermeldungen.

## 7) Kompatibilität & Umgebung

- Browser (E2E): Chromium/Firefox/WebKit (via Playwright)
- OS: Windows & Linux (Tests sind Windows-tauglich; Tempfile-Cleanup berücksichtigt EPERM-Retries)
- Node.js: via `package.json` getestet; empfohlen LTS (z.B. Node 20/22)
- Deployment: Docker, Reverse Proxy (TRUST_PROXY), Windows/Linux
- Storage: SQLite DB persistiert via Volume (`/app/data`)

## 8) Regression

Ziel: Regressionen früh erkennen, ohne CI unnötig zu verlangsamen.

Empfohlene Pipeline (Dokumentation, nicht zwingend exakt der aktuelle CI-Stand):

- Bei jedem PR/Push: `npm ci`, `npm run typecheck`, `npm run test:run`
- Optional/Nightly: `npm run test:e2e` (Playwright; braucht `npm run playwright:install` in CI)
- Release: wie PR/Push, zusätzlich Container Build/Publish

Hinweis: E2E kann als nightly laufen, um Flakiness zu entkoppeln.

## 9) Deployment- & Betriebsszenarien

- Update/Rollback via Image Tags (Pinning empfohlen)
	- Empfehlung: Produktions-Deployments auf Version taggen (`ghcr.io/robotnikz/sunflow:<version>`), nicht ausschließlich `latest`.
	- Update: Tag wechseln, Container neu starten.
	- Rollback: vorherigen Tag wieder eintragen und neu starten.
- DB persistiert via Volume
	- Docker Compose: `./sunflow-data:/app/data`
	- Backup: `sunflow-data/solar_data.db` sichern (bei gestopptem Container oder per Copy).
	- Monitoring: DB Growth, CPU/RAM (insb. bei langem Polling/Soak)

Manuelle Betriebsszenarien (kurz):
- Restart/Resume: `docker compose restart` während `npm run soaktest` läuft
- Netzwerk-Unterbrechung: Inverter-IP temporär nicht erreichbar → API darf nicht crashen; UI bleibt bedienbar

## 10) Doku & Tests

- README/Setup und Beispiele müssen mit aktuellem Behavior konsistent bleiben.
- Referenzen:
	- Security: `AUDIT.md`
	- Tests: dieser Testplan + `npm run test:run` / `npm run test:e2e`

## How to run

- Unit/Integration: `npm run test:run`
- Typecheck: `npm run typecheck`
- Loadtest (manuell): `npm run loadtest -- --url http://localhost:3000 --duration 10 --connections 25`
- Soak/Stability (manuell): `npm run soaktest -- --url http://localhost:3000 --duration 3600 --interval 2`
