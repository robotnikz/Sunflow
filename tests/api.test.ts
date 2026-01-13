// @vitest-environment node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3').verbose();

vi.mock('axios', () => {
  return {
    default: {
      get: vi.fn(async (url: string) => {
        if (url.includes('api.awattar.de/v1/marketdata') || url.includes('api.awattar.at/v1/marketdata')) {
          const u = new URL(url);
          const start = Number(u.searchParams.get('start'));
          // Return 2 hours starting at the requested start.
          return {
            data: {
              data: [
                { start_timestamp: start, end_timestamp: start + 3600000, marketprice: 50, unit: 'Eur/MWh' },
                { start_timestamp: start + 3600000, end_timestamp: start + 7200000, marketprice: 100, unit: 'Eur/MWh' },
              ],
            },
          };
        }

        throw new Error(`Unexpected axios.get in tests: ${url}`);
      }),
    },
  };
});

describe('Backend API (integration)', () => {
  let dataDir: string;
  let app: any;
  let shutdown: (exitProcess?: boolean) => void;

  beforeAll(async () => {
    // Ensure server.js behaves deterministically in tests.
    process.env.NODE_ENV = 'test';
    process.env.DISABLE_UPDATE_CHECK = '1';
    process.env.TZ = 'Europe/Berlin';

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflow-test-'));
    process.env.DATA_DIR = dataDir;

    // Import after env vars are set so server.js picks them up.
    // @ts-ignore importing JS module without types for this dynamic import
    const mod = (await import('../server.js')) as unknown as {
      app: any;
      shutdown: (exitProcess?: boolean) => void;
    };
    ({ app, shutdown } = mod);
  });

  afterAll(async () => {
    try {
      shutdown?.(false);
    } finally {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup issues on Windows file locks
      }
    }
  });

  it('GET /api/config returns defaults with appliances + notifications', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);

    expect(res.body).toBeTypeOf('object');
    expect(res.body.currency).toBeTruthy();

    expect(Array.isArray(res.body.appliances)).toBe(true);
    expect(res.body.appliances.length).toBeGreaterThan(0);

    expect(res.body.notifications).toBeTypeOf('object');
    expect(res.body.notifications.triggers).toBeTypeOf('object');
  });

  it('POST /api/config persists config changes', async () => {
    const postRes = await request(app)
      .post('/api/config')
      .send({ currency: 'USD', inverterIp: '1.2.3.4' })
      .set('Content-Type', 'application/json');

    expect(postRes.status).toBe(200);
    expect(postRes.body).toEqual({ success: true });

    const getRes = await request(app).get('/api/config');
    expect(getRes.status).toBe(200);
    expect(getRes.body.currency).toBe('USD');
    expect(getRes.body.inverterIp).toBe('1.2.3.4');
  });

  it('GET /api/info does not require network in tests', async () => {
    const res = await request(app).get('/api/info');
    expect(res.status).toBe(200);

    expect(res.body).toBeTypeOf('object');
    expect(res.body.version).toBeTruthy();
    expect(res.body.latestVersion).toBeTruthy();
    expect(res.body.updateAvailable).toBeTypeOf('boolean');
  });

  it('GET /api/dynamic-pricing/awattar/compare returns a fixed vs dynamic delta', async () => {
    const dbPath = path.join(dataDir, 'solar_data.db');
    const db = new sqlite3.Database(dbPath);

    const run = (sql: string, params: any[] = []) =>
      new Promise<void>((resolve, reject) => {
        db.run(sql, params, (err: any) => (err ? reject(err) : resolve()));
      });

    await run(`CREATE TABLE IF NOT EXISTS energy_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp DATETIME UNIQUE,
      production_wh REAL,
      grid_feed_in_wh REAL,
      grid_consumption_wh REAL,
      battery_charge_wh REAL,
      battery_discharge_wh REAL,
      load_wh REAL
    )`);

    await run(
      `INSERT OR REPLACE INTO energy_data (timestamp, grid_consumption_wh, grid_feed_in_wh) VALUES (?, ?, ?)` ,
      ['2021-01-01 00:00:00', 1000, 0]
    );
    await run(
      `INSERT OR REPLACE INTO energy_data (timestamp, grid_consumption_wh, grid_feed_in_wh) VALUES (?, ?, ?)` ,
      ['2021-01-01 01:00:00', 2000, 0]
    );

    db.close();

    const res = await request(app).get(
      '/api/dynamic-pricing/awattar/compare?country=DE&from=2021-01-01&to=2021-01-02&surchargeCt=0&vatPercent=0'
    );
    expect(res.status).toBe(200);

    expect(res.body.provider).toBe('awattar');
    expect(res.body.coverage.hoursUsed).toBe(2);

    // Fixed default tariff should be 0.30 €/kWh (seeded), dynamic prices are 0.05 and 0.10 €/kWh.
    expect(res.body.totals.fixed.net).toBe(0.9);
    expect(res.body.totals.dynamic.net).toBe(0.25);
    expect(res.body.totals.delta.net).toBe(-0.65);
  });
});
