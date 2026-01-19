# Contributing to SunFlow

Thanks for contributing to SunFlow!

These instructions are for developers. If you just want to run SunFlow, follow the Docker instructions in README.

## Recommended environment

- Linux (recommended)
- Node.js + npm (see `package.json` for the supported versions)

## Project info (tech stack)

- Frontend: React + TypeScript (Vite)
- Backend: Node.js (Express)
- Storage: SQLite under `/app/data` (bind-mounted by default via `./sunflow-data:/app/data`)
- E2E: Playwright
- Unit/Integration: Vitest

Related docs:
- Test strategy & scenarios: [docs/TESTPLAN.md](docs/TESTPLAN.md)
- Quick manual UI checklist: [docs/UX_CHECKLIST.md](docs/UX_CHECKLIST.md)
- Day-2 operations: [docs/OPERATIONS.md](docs/OPERATIONS.md)
- Self-hosting hardening: [SECURITY.md](SECURITY.md)
- Security/architecture notes: [docs/AUDIT.md](docs/AUDIT.md)

## Install & run (local dev)

```bash
npm ci
npm run dev
```

Open:
- UI (Vite): http://localhost:5173/
- API (Express): http://localhost:3000/

## Quality checks

```bash
npm run test:run
npm run typecheck
npm run lint
```

## Testing

This repo uses:

- Unit/Integration tests: Vitest
- E2E tests: Playwright

For the overall regression strategy and scenarios, see [docs/TESTPLAN.md](docs/TESTPLAN.md). For a quick manual UI checklist, see [docs/UX_CHECKLIST.md](docs/UX_CHECKLIST.md).

### Unit/Integration (Vitest)

```bash
npm run test:run
```

### TypeScript typecheck

```bash
npm run typecheck
```

### Lint

```bash
npm run lint
```

### E2E (Playwright)

1. Install browsers (first time only):

```bash
npm run playwright:install
```

2. Run E2E tests:

```bash
npm run test:e2e
```

Run only the fully mocked suite:

```bash
npm run test:e2e -- e2e/everything-mocked.spec.ts
```

### Load / soak (manual)

```bash
npm run loadtest -- --url http://localhost:3000 --duration 10 --connections 25
npm run soaktest -- --url http://localhost:3000 --duration 3600 --interval 2
```

## CI expectations (recommended)

- On every PR: `npm ci`, `npm run typecheck`, `npm run test:run`
- Optional/nightly: `npm run test:e2e`

## Windows / PowerShell note (optional)

If you see an error like "npm.ps1 cannot be loaded because script execution is disabled", either:

- run commands via `npm.cmd` (e.g. `npm.cmd ci`)

or set an execution policy for your user:

- `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

## Pull requests

- Keep changes focused and scoped.
- Prefer adding/adjusting tests for behavior changes.
- Ensure `npm run test:run` and `npm run typecheck` pass.
