// @vitest-environment node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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
  shutdown: (exitProcess?: boolean) => void | Promise<void>;
};

const rmDirWithRetries = async (dir: string) => {
  const attempts = 8;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e: any) {
      if (!['EPERM', 'ENOTEMPTY', 'EBUSY'].includes(e?.code)) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
};

const dbRun = async (dbPath: string, sql: string, params: any[] = []) => {
  const db = new sqlite3.Database(dbPath);
  try {
    await new Promise<void>((resolve, reject) => {
      db.run(sql, params, (err: any) => {
        if (err) return reject(err);
        resolve();
      });
    });
  } finally {
    db.close();
  }
};

const dbAll = async (dbPath: string, sql: string, params: any[] = []) => {
  const db = new sqlite3.Database(dbPath);
  try {
    return await new Promise<any[]>((resolve, reject) => {
      db.all(sql, params, (err: any, rows: any[]) => {
        if (err) return reject(err);
        resolve(rows);
      });
    });
  } finally {
    db.close();
  }
};

const waitForSchema = async (dbPath: string, timeoutMs = 1500) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const rows = await dbAll(
        dbPath,
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('energy_log','energy_data')",
      );
      const names = new Set(rows.map((r: any) => r.name));
      if (names.has('energy_log') && names.has('energy_data')) return;
    } catch {
      // ignore and retry
    }
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('Backend API (simulation-data integration)', () => {
  let dataDir: string;
  let dbPath: string;
  let app: any;
  let shutdown: (exitProcess?: boolean) => void | Promise<void>;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITEST = '1';
    process.env.DISABLE_UPDATE_CHECK = '1';
    process.env.TZ = 'Europe/Berlin';

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflow-test-'));
    process.env.DATA_DIR = dataDir;

    // Minimal config to avoid other endpoints failing during startup.
    fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ currency: 'EUR' }, null, 2));

    dbPath = path.join(dataDir, 'solar_data.db');

    // @ts-ignore importing JS module without types
    const mod = (await import('../server.js')) as unknown as ServerModule;
    ({ app, shutdown } = mod);

    await waitForSchema(dbPath);
  });

  afterAll(async () => {
    try {
      await Promise.resolve(shutdown?.(false));
    } finally {
      delete process.env.DATA_DIR;
      await rmDirWithRetries(dataDir);
    }
  });

  beforeEach(async () => {
    await waitForSchema(dbPath);
    await dbRun(dbPath, 'DELETE FROM energy_log');
    await dbRun(dbPath, 'DELETE FROM energy_data');
  });

  it('returns 200 and prefers energy_log over energy_data for overlapping hours', async () => {
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:00:00', 111, 222, -10, 5, 50, 1],
    );
    await dbRun(
      dbPath,
      'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:00:00', 9999, 0, 0, 0, 0, 9999],
    );

    const res = await request(app).get('/api/simulation-data');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const points = res.body.filter((p: any) => typeof p?.t === 'number');
    expect(points.length).toBe(1);

    expect(points[0].p).toBe(111);
    expect(points[0].l).toBe(222);
  });

  it('orders points by hour ASC', async () => {
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 01:00:00', 10, 20, 0, 0, 50, 1],
    );
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:00:00', 11, 21, 0, 0, 50, 1],
    );

    const res = await request(app).get('/api/simulation-data');
    expect(res.status).toBe(200);

    expect(res.body.length).toBe(2);
    expect(res.body[0].p).toBe(11);
    expect(res.body[1].p).toBe(10);
  });
});
