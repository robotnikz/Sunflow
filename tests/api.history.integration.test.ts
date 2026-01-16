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

describe('Backend API (history integration)', () => {
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

    // Server creates schema asynchronously in the sqlite open callback.
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

  it('returns high-res chart + stats for custom day from energy_log rows', async () => {
    // Two 1-minute points. The stats path integrates power over time.
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:00:00', 60000, 30000, 10000, -5000, 50, 1],
    );
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:01:00', 60000, 30000, 10000, -5000, 51, 1],
    );

    const res = await request(app).get('/api/history?range=custom&start=2026-01-01&end=2026-01-01');
    expect(res.status).toBe(200);

    expect(Array.isArray(res.body.chart)).toBe(true);
    expect(res.body.chart.length).toBe(2);

    // Chart is power (W) averages, rounded.
    expect(res.body.chart[0].timestamp).toBe('2026-01-01 00:00:00');
    expect(res.body.chart[0].production).toBe(60000);
    expect(res.body.chart[0].consumption).toBe(30000);
    expect(res.body.chart[0].grid).toBe(10000);
    expect(res.body.chart[0].battery).toBe(-5000);

    // Stats are kWh integrated; each minute at 60kW => 1kWh.
    expect(res.body.stats.production).toBeCloseTo(2.0, 5);
    expect(res.body.stats.consumption).toBeCloseTo(1.0, 5);
    expect(res.body.stats.imported).toBeCloseTo(0.333333, 5);
    expect(res.body.stats.exported).toBeCloseTo(0.0, 5);
  });

  it('excludes rows exactly at the end boundary (timestamp < end)', async () => {
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-02 00:00:00', 123, 456, 0, 0, 0, 1],
    );

    const res = await request(app).get('/api/history?range=custom&start=2026-01-01&end=2026-01-01');
    expect(res.status).toBe(200);
    expect(res.body.chart).toEqual([]);

    // Extra safety: confirm nothing leaked into stats.
    expect(res.body.stats.production).toBe(0);
    expect(res.body.stats.consumption).toBe(0);
  });

  it('uses energy_data rows directly for stats and includes them in high-res chart', async () => {
    await dbRun(
      dbPath,
      'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 02:00:00', 2000, 200, 0, 100, 0, 1000],
    );

    const res = await request(app).get('/api/history?range=custom&start=2026-01-01&end=2026-01-01');
    expect(res.status).toBe(200);

    expect(res.body.chart.length).toBe(1);
    expect(res.body.chart[0].timestamp).toBe('2026-01-01 02:00:00');

    // For energy_data in high-res view, Wh values are treated like average W.
    expect(res.body.chart[0].production).toBe(2000);
    expect(res.body.chart[0].consumption).toBe(1000);
    expect(res.body.chart[0].grid).toBe(200);

    // Stats from energy_data are kWh directly.
    expect(res.body.stats.production).toBeCloseTo(2.0, 5);
    expect(res.body.stats.consumption).toBeCloseTo(1.0, 5);
    expect(res.body.stats.imported).toBeCloseTo(0.2, 5);
    expect(res.body.stats.exported).toBeCloseTo(0.0, 5);
    expect(res.body.stats.batteryCharged).toBeCloseTo(0.1, 5);
    expect(res.body.stats.batteryDischarged).toBeCloseTo(0.0, 5);
  });

  it('orders unioned energy_log + energy_data rows by timestamp ASC', async () => {
    // Intentionally insert out of order.
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:01:00', 1, 1, 0, 0, 0, 1],
    );
    await dbRun(
      dbPath,
      'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:00:00', 10, 0, 0, 0, 0, 10],
    );

    const res = await request(app).get('/api/history?range=custom&start=2026-01-01&end=2026-01-01');
    expect(res.status).toBe(200);

    const timestamps = res.body.chart.map((p: any) => p.timestamp);
    expect(timestamps).toEqual(['2026-01-01 00:00:00', '2026-01-01 00:01:00']);

    // Sanity: union really returned both sources
    const raw = await dbAll(dbPath, 'SELECT COUNT(*) as c FROM energy_log');
    expect(Number(raw[0]?.c)).toBe(1);
  });

  it('de-duplicates overlapping timestamps, preferring energy_log over energy_data', async () => {
    // Same timestamp exists in both tables (possible around archive/import boundaries).
    // We want one point in the chart and no double-counting in stats.
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['2026-01-01 00:00:00', 60000, 10000, 5000, -2000, 50, 1],
    );
    await dbRun(
      dbPath,
      'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
      // Intentionally conflicting values; this row should be ignored on timestamp collision.
      ['2026-01-01 00:00:00', 9000, 3000, 0, 500, 0, 7000],
    );

    const res = await request(app).get('/api/history?range=custom&start=2026-01-01&end=2026-01-01');
    expect(res.status).toBe(200);

    expect(res.body.chart.length).toBe(1);
    expect(res.body.chart[0].timestamp).toBe('2026-01-01 00:00:00');

    // From energy_log high-res point (W), not energy_data Wh value.
    expect(res.body.chart[0].production).toBe(60000);
    expect(res.body.chart[0].consumption).toBe(10000);
    expect(res.body.chart[0].grid).toBe(5000);
    expect(res.body.chart[0].battery).toBe(-2000);

    // Stats should use only the energy_log contribution:
    // 60kW for 1 minute => 1kWh (default 1/60h integration for single point).
    expect(res.body.stats.production).toBeCloseTo(1.0, 5);

    // Also assert key flow stats are from energy_log (not the conflicting energy_data row).
    // 10kW load for 1 minute => 0.166666.. kWh
    expect(res.body.stats.consumption).toBeCloseTo(0.166666, 5);
    // 5kW grid import for 1 minute => 0.083333.. kWh
    expect(res.body.stats.imported).toBeCloseTo(0.083333, 5);
    expect(res.body.stats.exported).toBeCloseTo(0.0, 5);
    // -2kW battery means charging for 1 minute => 0.033333.. kWh charged
    expect(res.body.stats.batteryCharged).toBeCloseTo(0.033333, 5);
    expect(res.body.stats.batteryDischarged).toBeCloseTo(0.0, 5);
  });

  it('de-duplicates overlap for export case (negative grid), preferring energy_log', async () => {
    await dbRun(
      dbPath,
      'INSERT INTO energy_log (timestamp, power_pv, power_load, power_grid, power_battery, soc, status_code) VALUES (?, ?, ?, ?, ?, ?, ?)',
      // Export 4kW to grid for 1 minute; no import.
      ['2026-01-01 00:02:00', 60000, 10000, -4000, 0, 50, 1],
    );
    await dbRun(
      dbPath,
      'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
      // Conflicting row that would imply import; should be ignored on collision.
      ['2026-01-01 00:02:00', 1000, 5000, 0, 0, 0, 1000],
    );

    const res = await request(app).get('/api/history?range=custom&start=2026-01-01&end=2026-01-01');
    expect(res.status).toBe(200);

    // Find the point for 00:02:00 (other tests may insert earlier points).
    const point = res.body.chart.find((p: any) => p.timestamp === '2026-01-01 00:02:00');
    expect(point).toBeTruthy();

    expect(point.production).toBe(60000);
    expect(point.consumption).toBe(10000);
    expect(point.grid).toBe(-4000);

    // 4kW export for 1 minute => 0.066666.. kWh exported
    expect(res.body.stats.exported).toBeCloseTo(0.066666, 5);
    expect(res.body.stats.imported).toBeCloseTo(0.0, 5);
  });

  it('aggregates week range into daily bars (energy_data)', async () => {
    vi.useFakeTimers();
    try {
      // Thu, 2026-01-08 (Berlin). Week starts Mon, 2026-01-05.
      vi.setSystemTime(new Date('2026-01-08T12:00:00+01:00'));

      await dbRun(
        dbPath,
        'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['2026-01-06 12:00:00', 1000, 200, 0, 0, 0, 500],
      );
      await dbRun(
        dbPath,
        'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['2026-01-06 13:00:00', 500, 50, 0, 0, 0, 250],
      );

      const res = await request(app).get('/api/history?range=week&offset=0');
      expect(res.status).toBe(200);

      expect(res.body.chart.length).toBe(1);
      expect(res.body.chart[0].timestamp).toBe('2026-01-06 00:00:00');
      expect(res.body.chart[0].is_aggregated).toBe(true);

      // Chart bars are kWh (rounded to 2 decimals).
      expect(res.body.chart[0].production).toBe(1.5);
      expect(res.body.chart[0].consumption).toBe(0.75);
      expect(res.body.chart[0].grid).toBe(0.25);

      // Stats are kWh sums.
      expect(res.body.stats.production).toBeCloseTo(1.5, 5);
      expect(res.body.stats.consumption).toBeCloseTo(0.75, 5);
      expect(res.body.stats.imported).toBeCloseTo(0.25, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aggregates month range into daily bars (energy_data)', async () => {
    vi.useFakeTimers();
    try {
      // Feb 2026 (Berlin). Month starts 2026-02-01.
      vi.setSystemTime(new Date('2026-02-10T12:00:00+01:00'));

      await dbRun(
        dbPath,
        'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['2026-02-05 08:00:00', 2500, 500, 0, 0, 0, 1500],
      );

      const res = await request(app).get('/api/history?range=month&offset=0');
      expect(res.status).toBe(200);

      expect(res.body.chart.length).toBe(1);
      expect(res.body.chart[0].timestamp).toBe('2026-02-05 00:00:00');
      expect(res.body.chart[0].is_aggregated).toBe(true);

      expect(res.body.chart[0].production).toBe(2.5);
      expect(res.body.chart[0].consumption).toBe(1.5);
      expect(res.body.chart[0].grid).toBe(0.5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aggregates year range into monthly bars (energy_data)', async () => {
    vi.useFakeTimers();
    try {
      // 2026 calendar year.
      vi.setSystemTime(new Date('2026-06-15T12:00:00+02:00'));

      await dbRun(
        dbPath,
        'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['2026-03-15 12:00:00', 3000, 0, 0, 0, 0, 2000],
      );
      await dbRun(
        dbPath,
        'INSERT INTO energy_data (timestamp, production_wh, grid_consumption_wh, grid_feed_in_wh, battery_charge_wh, battery_discharge_wh, load_wh) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['2026-03-20 12:00:00', 1000, 0, 0, 0, 0, 500],
      );

      const res = await request(app).get('/api/history?range=year&offset=0');
      expect(res.status).toBe(200);

      expect(res.body.chart.length).toBe(1);
      expect(res.body.chart[0].timestamp).toBe('2026-03-01 00:00:00');
      expect(res.body.chart[0].is_aggregated).toBe(true);

      expect(res.body.chart[0].production).toBe(4.0);
      expect(res.body.chart[0].consumption).toBe(2.5);
      expect(res.body.stats.production).toBeCloseTo(4.0, 5);
      expect(res.body.stats.consumption).toBeCloseTo(2.5, 5);
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns 400 for invalid range', async () => {
    const res = await request(app).get('/api/history?range=wat');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid range' });
  });

  it('returns 400 for invalid offset', async () => {
    const res = await request(app).get('/api/history?range=day&offset=abc');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid offset' });
  });

  it('returns 400 when custom range is missing start/end', async () => {
    const res = await request(app).get('/api/history?range=custom&start=2026-01-01');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Missing start/end for custom range' });
  });

  it('returns 400 when custom range has invalid date', async () => {
    const res = await request(app).get('/api/history?range=custom&start=not-a-date&end=2026-01-01');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid start/end date' });
  });

  it('returns 400 when custom end is before start', async () => {
    const res = await request(app).get('/api/history?range=custom&start=2026-01-02&end=2026-01-01');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'End date must be >= start date' });
  });
});
