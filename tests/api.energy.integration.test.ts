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

describe('Backend API (energy integration)', () => {
  let dataDir: string;
  let dbPath: string;
  let app: any;
  let shutdown: (exitProcess?: boolean) => void;

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
      shutdown?.(false);
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

  it('de-duplicates overlapping timestamps, preferring energy_log in /api/energy', async () => {
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

    const res = await request(app).get('/api/energy?start=2026-01-01 00:00:00&end=2026-01-01 00:10:00');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    // Must return exactly one point for the overlapped timestamp.
    const points = res.body.filter((p: any) => p.timestamp === '2026-01-01 00:00:00');
    expect(points.length).toBe(1);

    // Must prefer energy_log (111) over energy_data (9999).
    expect(points[0]).toEqual({
      timestamp: '2026-01-01 00:00:00',
      production: 111,
      consumption: 222,
      grid: -10,
      battery: 5,
    });
  });

  it('does not leak internal fields (e.g., is_high_res) in /api/energy response', async () => {
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:01:00', 1, 2, 3, 4, 50, 1],
    );
    await dbRun(
      dbPath,
      'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:00:00', 10, 0, 0, 0, 0, 20],
    );

    const res = await request(app).get('/api/energy?start=2026-01-01 00:00:00&end=2026-01-01 00:10:00');
    expect(res.status).toBe(200);

    for (const p of res.body) {
      expect(p).toHaveProperty('timestamp');
      expect(p).toHaveProperty('production');
      expect(p).toHaveProperty('consumption');
      expect(p).toHaveProperty('grid');
      expect(p).toHaveProperty('battery');
      expect(p).not.toHaveProperty('is_high_res');
    }
  });

  it('returns points ordered by timestamp ASC and prefers energy_log on overlap', async () => {
    // Insert intentionally out of order across both tables.
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:02:00', 222, 0, 0, 0, 50, 1],
    );
    await dbRun(
      dbPath,
      'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:01:00', 111, 0, 0, 0, 0, 111],
    );
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:00:00', 10, 0, 0, 0, 50, 1],
    );
    // Overlap timestamp that should be de-duplicated in favor of energy_log (222, not 9999).
    await dbRun(
      dbPath,
      'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:02:00', 9999, 0, 0, 0, 0, 9999],
    );

    const res = await request(app).get('/api/energy?start=2026-01-01 00:00:00&end=2026-01-01 00:05:00');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const timestamps = res.body.map((p: any) => p.timestamp);
    expect(timestamps).toEqual(['2026-01-01 00:00:00', '2026-01-01 00:01:00', '2026-01-01 00:02:00']);

    const p2 = res.body.find((p: any) => p.timestamp === '2026-01-01 00:02:00');
    expect(p2.production).toBe(222);
  });

  it('returns ascending timestamps for default /api/energy (no start/end)', async () => {
    // Default path reads latest 288 rows in DESC order then reverses.
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:00:00', 1, 0, 0, 0, 50, 1],
    );
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:01:00', 2, 0, 0, 0, 50, 1],
    );
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:02:00', 3, 0, 0, 0, 50, 1],
    );

    const res = await request(app).get('/api/energy');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThanOrEqual(288);

    const timestamps = res.body.map((p: any) => p.timestamp);
    const expected = ['2026-01-01 00:00:00', '2026-01-01 00:01:00', '2026-01-01 00:02:00'];
    // It can include more points if other tests inserted data, but in this file we fully clear tables.
    expect(timestamps).toEqual(expected);
  });
});
