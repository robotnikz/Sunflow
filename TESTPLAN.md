# Testplan (SunFlow)

Status: In Arbeit (Branch: `audit-2026-01-15-security-hardening`)

## 1) Funktionale Tests (Was soll die Software tun?)

Ziel: Erfüllt die Software die Anforderungen? „Tut das System genau das, was spezifiziert ist?“

### Kernfunktionen / Business-Logik (Use-Cases)

| Bereich | Use Case | Erwartung | Automatisiert? |
|---|---|---|---|
| Config | Config lesen/schreiben | GET liefert Defaults, POST persistiert, Validierung greift | teilweise |
| Realtime | Live-Daten abrufen | Bei fehlender IP -> Fehler; bei IP -> Datenmodell stabil | teilweise |
| Forecast | Solcast Forecast | Tagsüber cached, nachts keine Solcast-Calls, valide Fehlermeldungen | teilweise |
| Tarife | CRUD | Validierung, min. 1 Tariff bleibt, korrekte Statuscodes | geplant |
| Expenses | CRUD | Validierung, korrekte Statuscodes | geplant |
| CSV Import | Preview/Import | Preview liefert Header+Preview, Import schreibt DB, Cleanup tmp, Fehlpfade sauber | geplant |
| Notifications | Test notification | Nur erlaubte Discord Webhooks; Fehlerhandling sauber | geplant |
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

### c) Sicherheit
- AuthN/Z: Admin token enforced
- Input validation: invalid bodies/IDs
- Secrets: redaction wenn Admin token aktiv

## 6) Usability & UX

- Verständliche Texte, konsistente Validierung, klare Fehlermeldungen.

## 7) Kompatibilität & Umgebung

- Browser: Chromium/Firefox/WebKit (via Playwright)
- Deployment: Docker, Reverse Proxy (TRUST_PROXY), Windows/Linux

## 8) Regression

- Tests laufen bei jedem Release.

## 9) Deployment- & Betriebsszenarien

- Update/Rollback via Image Tags (kein `latest` in Produktion)
- DB persistiert via Volume

## 10) Doku & Tests

- README/Setup und Beispiele müssen mit aktuellem Behavior konsistent bleiben.

## How to run

- Unit/Integration: `npm run test:run`
- Typecheck: `npm run typecheck`
