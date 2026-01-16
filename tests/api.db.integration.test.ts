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

const dbGet = async (dbPath: string, sql: string, params: any[] = []) => {
  const db = new sqlite3.Database(dbPath);
  try {
    return await new Promise<any>((resolve, reject) => {
      db.get(sql, params, (err: any, row: any) => {
        if (err) return reject(err);
        resolve(row);
      });
    });
  } finally {
    db.close();
  }
};

const waitForTariffs = async (app: any, timeoutMs = 1500) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get('/api/tariffs');
    if (res.status === 200 && Array.isArray(res.body) && res.body.length >= 1) return res;
    await new Promise((r) => setTimeout(r, 25));
  }
  return request(app).get('/api/tariffs');
};

const listFiles = (dir: string) => {
  try {
    return fs.readdirSync(dir).sort();
  } catch {
    return [];
  }
};

describe('Backend API (DB integration)', () => {
  const token = 'test-admin-token';

  let dataDir: string;
  let dbPath: string;
  let app: any;
  let shutdown: (exitProcess?: boolean) => void;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITEST = '1';
    process.env.DISABLE_UPDATE_CHECK = '1';
    process.env.TZ = 'Europe/Berlin';

    process.env.SUNFLOW_ADMIN_TOKEN = token;

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflow-test-'));
    process.env.DATA_DIR = dataDir;

    dbPath = path.join(dataDir, 'solar_data.db');

    // Seed config values used by tariff seeding.
    fs.writeFileSync(
      path.join(dataDir, 'config.json'),
      JSON.stringify({ currency: 'EUR', costPerKwh: 0.42, feedInTariff: 0.09 }, null, 2),
    );

    // @ts-ignore importing JS module without types
    const mod = (await import('../server.js')) as unknown as ServerModule;
    ({ app, shutdown } = mod);
  });

  afterAll(async () => {
    try {
      shutdown?.(false);
    } finally {
      delete process.env.SUNFLOW_ADMIN_TOKEN;
      delete process.env.DATA_DIR;
      await rmDirWithRetries(dataDir);
    }
  });

  it('seeds initial tariff from config and prevents deleting the last tariff', async () => {
    const get0 = await waitForTariffs(app);
    expect(get0.status).toBe(200);
    expect(Array.isArray(get0.body)).toBe(true);
    expect(get0.body.length).toBeGreaterThanOrEqual(1);

    const first = get0.body[0];
    expect(first.validFrom).toBe('2000-01-01');
    expect(first.costPerKwh).toBeCloseTo(0.42);
    expect(first.feedInTariff).toBeCloseTo(0.09);

    const delLast = await request(app)
      .delete(`/api/tariffs/${first.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delLast.status).toBe(400);
    expect(delLast.body?.error).toBe('Cannot delete the last tariff.');

    const row = await dbGet(dbPath, 'SELECT COUNT(*) as c FROM tariffs');
    expect(Number(row?.c)).toBeGreaterThanOrEqual(1);
  });

  it('supports creating and deleting tariffs (while keeping at least one)', async () => {
    const add = await request(app)
      .post('/api/tariffs')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ validFrom: '2026-01-01', costPerKwh: 0.5, feedInTariff: 0.1 });

    expect(add.status).toBe(200);
    expect(add.body.success).toBe(true);

    const count2 = await dbGet(dbPath, 'SELECT COUNT(*) as c FROM tariffs');
    expect(Number(count2?.c)).toBeGreaterThanOrEqual(2);

    const del = await request(app)
      .delete(`/api/tariffs/${add.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(del.status).toBe(200);
    expect(del.body.success).toBe(true);

    const count1 = await dbGet(dbPath, 'SELECT COUNT(*) as c FROM tariffs');
    expect(Number(count1?.c)).toBeGreaterThanOrEqual(1);
  });

  it('validates tariff delete IDs (400) and returns 404 for missing when more than one tariff exists', async () => {
    // Ensure we can hit the 404 branch (delete is only allowed when more than one tariff exists).
    const add = await request(app)
      .post('/api/tariffs')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ validFrom: '2026-02-01', costPerKwh: 0.55, feedInTariff: 0.12 });
    expect(add.status).toBe(200);

    const bad1 = await request(app)
      .delete('/api/tariffs/abc')
      .set('Authorization', `Bearer ${token}`);
    expect(bad1.status).toBe(400);

    const bad2 = await request(app)
      .delete('/api/tariffs/0')
      .set('Authorization', `Bearer ${token}`);
    expect(bad2.status).toBe(400);

    const bad3 = await request(app)
      .delete('/api/tariffs/-1')
      .set('Authorization', `Bearer ${token}`);
    expect(bad3.status).toBe(400);

    const bad4 = await request(app)
      .delete('/api/tariffs/1.5')
      .set('Authorization', `Bearer ${token}`);
    expect(bad4.status).toBe(400);

    const missing = await request(app)
      .delete('/api/tariffs/999999')
      .set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);

    // Cleanup: delete the extra tariff we created.
    const del = await request(app)
      .delete(`/api/tariffs/${add.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
  });

  it('supports creating and deleting expenses', async () => {
    const add = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: 'Test Expense', amount: 123, type: 'one_time', date: '2026-01-01' });

    expect(add.status).toBe(200);
    expect(add.body.success).toBe(true);

    const row1 = await dbGet(dbPath, 'SELECT COUNT(*) as c FROM expenses');
    expect(Number(row1?.c)).toBeGreaterThanOrEqual(1);

    const del = await request(app)
      .delete(`/api/expenses/${add.body.id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(del.status).toBe(200);

    const row0 = await dbGet(dbPath, 'SELECT COUNT(*) as c FROM expenses');
    expect(Number(row0?.c)).toBe(0);
  });

  it('validates expense delete IDs (400) and returns 404 for missing', async () => {
    const add = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ name: 'Delete Edge', amount: 1, type: 'one_time', date: '2026-01-02' });

    expect(add.status).toBe(200);
    expect(add.body.success).toBe(true);

    const bad1 = await request(app)
      .delete('/api/expenses/abc')
      .set('Authorization', `Bearer ${token}`);
    expect(bad1.status).toBe(400);

    const bad2 = await request(app)
      .delete('/api/expenses/0')
      .set('Authorization', `Bearer ${token}`);
    expect(bad2.status).toBe(400);

    const bad3 = await request(app)
      .delete('/api/expenses/-1')
      .set('Authorization', `Bearer ${token}`);
    expect(bad3.status).toBe(400);

    const bad4 = await request(app)
      .delete('/api/expenses/1.5')
      .set('Authorization', `Bearer ${token}`);
    expect(bad4.status).toBe(400);

    const missing = await request(app)
      .delete('/api/expenses/999999')
      .set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);

    const del = await request(app)
      .delete(`/api/expenses/${add.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
  });

  it('returns 400 for preview/import when no file uploaded (authorized)', async () => {
    const preview = await request(app)
      .post('/api/preview-csv')
      .set('Authorization', `Bearer ${token}`);
    expect(preview.status).toBe(400);
    expect(preview.body?.error).toBe('No file uploaded');

    const imp = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', '{}');
    expect(imp.status).toBe(400);
    expect(imp.body?.error).toBe('No file uploaded');
  });

  it('imports 0 rows from an empty CSV (headers only)', async () => {
    const csv = ['timestamp,power_pv,power_load,power_grid,power_battery,soc'].join('\n');
    const csvPath = path.join(dataDir, 'empty.csv');
    fs.writeFileSync(csvPath, csv, 'utf8');

    const mapping = {
      timestamp: 'timestamp',
      power_pv: 'power_pv',
      power_load: 'power_load',
      power_grid: 'power_grid',
      power_battery: 'power_battery',
      soc: 'soc',
    };

    const res = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', JSON.stringify(mapping))
      .attach('file', csvPath);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.imported).toBe(0);
  });

  it('does not write to DB and cleans up upload temp file on invalid mapping', async () => {
    const uploadsDir = path.join(dataDir, 'uploads');

    const beforeUploads = listFiles(uploadsDir);
    const beforeCountRow = await dbGet(dbPath, 'SELECT COUNT(*) as c FROM energy_log');
    const beforeCount = Number(beforeCountRow?.c || 0);

    const csv = [
      'timestamp,power_pv',
      '2026-01-15T10:00:00Z,100',
    ].join('\n');
    const csvPath = path.join(dataDir, 'bad-mapping.csv');
    fs.writeFileSync(csvPath, csv, 'utf8');

    // Case 1: mapping is invalid JSON
    const badJson = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', '{not-json')
      .attach('file', csvPath);
    expect(badJson.status).toBe(400);

    // Case 2: mapping missing timestamp
    const missingTs = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', JSON.stringify({ power_pv: 'power_pv' }))
      .attach('file', csvPath);
    expect(missingTs.status).toBe(400);

    // Case 3: mapping is an array
    const mappingArray = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', '[]')
      .attach('file', csvPath);
    expect(mappingArray.status).toBe(400);

    const afterCountRow = await dbGet(dbPath, 'SELECT COUNT(*) as c FROM energy_log');
    const afterCount = Number(afterCountRow?.c || 0);
    expect(afterCount).toBe(beforeCount);

    // Uploaded temp file should always be cleaned up on these 400 paths.
    const afterUploads = listFiles(uploadsDir);
    expect(afterUploads).toEqual(beforeUploads);
  });
});
