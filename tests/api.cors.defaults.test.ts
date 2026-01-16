// @vitest-environment node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3').verbose();

vi.mock('axios', () => {
  const get = vi.fn(async (url: string) => {
    throw new Error(`Unexpected axios.get in tests: ${url}`);
  });
  const post = vi.fn(async (url: string) => {
    throw new Error(`Unexpected axios.post in tests: ${url}`);
  });
  return {
    default: {
      get,
      post,
      create: vi.fn(() => ({ get, post })),
    },
  };
});

type ServerModule = {
  app: any;
  shutdown: (exitProcess?: boolean) => void;
};

const rmDirWithRetries = async (dir: string) => {
  const attempts = 8;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e: any) {
      if (e?.code !== 'EPERM') throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
};

const loadServer = async (env: Record<string, string | undefined>) => {
  vi.resetModules();

  // Reset relevant env vars first
  delete process.env.CORS_ORIGIN;
  delete process.env.SUNFLOW_CORS_ORIGIN;
  delete process.env.CORS_DISABLED;
  delete process.env.SUNFLOW_CORS_DISABLED;

  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflow-test-'));
  process.env.DATA_DIR = dataDir;

  // Pre-seed a minimal DB so the server's async "seed initial tariff" path doesn't
  // run (avoids SQLITE_MISUSE noise when shutting down quickly in this test file).
  const dbPath = path.join(dataDir, 'solar_data.db');
  await new Promise<void>((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err: any) => {
      if (err) return reject(err);

      db.serialize(() => {
        db.run(
          'CREATE TABLE IF NOT EXISTS tariffs (id INTEGER PRIMARY KEY AUTOINCREMENT, valid_from DATE NOT NULL, cost_per_kwh REAL NOT NULL, feed_in_tariff REAL NOT NULL)',
        );
        db.run(
          'INSERT INTO tariffs (valid_from, cost_per_kwh, feed_in_tariff) VALUES (?, ?, ?)',
          ['2000-01-01', 0.3, 0.08],
        );
        db.close((cErr: any) => (cErr ? reject(cErr) : resolve()));
      });
    });
  });

  // @ts-ignore importing JS module without types
  const mod = (await import('../server.js')) as unknown as ServerModule;

  return {
    app: mod.app,
    shutdown: mod.shutdown,
    dataDir,
  };
};

describe('Backend API (CORS defaults)', () => {
  let app: any;
  let shutdown: (exitProcess?: boolean) => void;
  let dataDir: string;

  afterEach(async () => {
    try {
      shutdown?.(false);
    } finally {
      delete process.env.DATA_DIR;
      if (dataDir) await rmDirWithRetries(dataDir);
    }
  });

  it('dev/test default allows localhost:5173 origin (no allowlist configured)', async () => {
    ({ app, shutdown, dataDir } = await loadServer({
      NODE_ENV: 'test',
      VITEST: '1',
      DISABLE_UPDATE_CHECK: '1',
      TZ: 'Europe/Berlin',
    }));

    const res = await request(app).get('/api/info').set('Origin', 'http://localhost:5173');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('production default does not allow cross-origin unless allowlist is set', async () => {
    ({ app, shutdown, dataDir } = await loadServer({
      NODE_ENV: 'production',
      VITEST: '1',
      DISABLE_UPDATE_CHECK: '1',
      TZ: 'Europe/Berlin',
      CORS_ORIGIN: undefined,
    }));

    const res = await request(app).get('/api/info').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('production honors explicit CORS allowlist', async () => {
    ({ app, shutdown, dataDir } = await loadServer({
      NODE_ENV: 'production',
      VITEST: '1',
      DISABLE_UPDATE_CHECK: '1',
      TZ: 'Europe/Berlin',
      CORS_ORIGIN: 'https://allowed.example',
    }));

    const allowed = await request(app).get('/api/info').set('Origin', 'https://allowed.example');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://allowed.example');

    const denied = await request(app).get('/api/info').set('Origin', 'https://evil.example');
    expect(denied.status).toBe(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
