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
        // This file focuses on auth/config behavior; block accidental external calls.
        throw new Error(`Unexpected axios.get in tests: ${url}`);
      }),
      post: vi.fn(async (url: string) => {
        throw new Error(`Unexpected axios.post in tests: ${url}`);
      }),
    },
  };
});

describe('Backend API (auth/admin)', () => {
  let dataDir: string;
  let app: any;
  let shutdown: (exitProcess?: boolean) => void;

  const token = 'test-admin-token';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DISABLE_UPDATE_CHECK = '1';
    process.env.TZ = 'Europe/Berlin';

    process.env.SUNFLOW_ADMIN_TOKEN = token;
    process.env.SUNFLOW_PROTECT_SECRETS = 'true';

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
        // ignore cleanup issues
      }

      delete process.env.SUNFLOW_ADMIN_TOKEN;
      delete process.env.SUNFLOW_PROTECT_SECRETS;
      delete process.env.DATA_DIR;
    }
  });

  it('requires Authorization for POST /api/config', async () => {
    const res = await request(app)
      .post('/api/config')
      .send({ currency: 'CHF' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(401);
  });

  it('allows POST /api/config with Bearer token and redacts secrets for non-admin GET', async () => {
    const okRes = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({
        currency: 'CHF',
        solcastApiKey: 'secret-key',
        notifications: { discordWebhook: 'https://discord.com/api/webhooks/123/abc' },
      })
      .set('Content-Type', 'application/json');

    expect(okRes.status).toBe(200);
    expect(okRes.body).toEqual({ success: true });

    const getRes = await request(app).get('/api/config');
    expect(getRes.status).toBe(200);
    expect(getRes.body.currency).toBe('CHF');
    expect(getRes.body.solcastApiKey).toBe('');
    expect(getRes.body.notifications?.discordWebhook).toBe('');

    const getAdmin = await request(app).get('/api/config').set('Authorization', `Bearer ${token}`);
    expect(getAdmin.status).toBe(200);
    expect(getAdmin.body.solcastApiKey).toBe('secret-key');
    expect(getAdmin.body.notifications?.discordWebhook).toBe('https://discord.com/api/webhooks/123/abc');
  });

  it('rejects non-discord webhook URLs in config', async () => {
    const bad = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: { discordWebhook: 'https://example.com/api/webhooks/123/abc' } })
      .set('Content-Type', 'application/json');

    expect(bad.status).toBe(400);
  });

  it('protects tariff write endpoints and validates inputs', async () => {
    const get0 = await request(app).get('/api/tariffs');
    expect(get0.status).toBe(200);
    expect(Array.isArray(get0.body)).toBe(true);
    expect(get0.body.length).toBeGreaterThanOrEqual(1);

    const unauth = await request(app)
      .post('/api/tariffs')
      .send({ validFrom: '2026-01-01', costPerKwh: 0.5, feedInTariff: 0.1 })
      .set('Content-Type', 'application/json');
    expect(unauth.status).toBe(401);

    const badTypes = await request(app)
      .post('/api/tariffs')
      .set('Authorization', `Bearer ${token}`)
      .send({ validFrom: '2026-01-01', costPerKwh: '0.5', feedInTariff: 0.1 })
      .set('Content-Type', 'application/json');
    expect(badTypes.status).toBe(400);

    const ok = await request(app)
      .post('/api/tariffs')
      .set('Authorization', `Bearer ${token}`)
      .send({ validFrom: '2026-01-01', costPerKwh: 0.5, feedInTariff: 0.1 })
      .set('Content-Type', 'application/json');
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(Number.isFinite(ok.body.id)).toBe(true);

    // Deleting a tariff requires auth
    const delUnauth = await request(app).delete(`/api/tariffs/${ok.body.id}`);
    expect(delUnauth.status).toBe(401);

    // With auth it should succeed (and should not allow deleting the very last tariff)
    const delOk = await request(app)
      .delete(`/api/tariffs/${ok.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 400, 404]).toContain(delOk.status);
  });

  it('protects expense write endpoints and validates inputs', async () => {
    const get0 = await request(app).get('/api/expenses');
    expect(get0.status).toBe(200);
    expect(Array.isArray(get0.body)).toBe(true);

    const unauth = await request(app)
      .post('/api/expenses')
      .send({ name: 'Test', amount: 123, type: 'one_time', date: '2026-01-01' })
      .set('Content-Type', 'application/json');
    expect(unauth.status).toBe(401);

    const badTypes = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test', amount: '123', type: 'one_time', date: '2026-01-01' })
      .set('Content-Type', 'application/json');
    expect(badTypes.status).toBe(400);

    const ok = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test', amount: 123, type: 'one_time', date: '2026-01-01' })
      .set('Content-Type', 'application/json');
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(Number.isFinite(ok.body.id)).toBe(true);

    const delUnauth = await request(app).delete(`/api/expenses/${ok.body.id}`);
    expect(delUnauth.status).toBe(401);

    const delOk = await request(app)
      .delete(`/api/expenses/${ok.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect([200, 404]).toContain(delOk.status);
  });

  it('protects CSV preview/import and supports a happy-path import', async () => {
    const csv = [
      'timestamp,power_pv,power_load,power_grid,power_battery,soc',
      '2026-01-15T10:00:00Z,100,200,-50,0,80',
      '2026-01-15T10:01:00Z,110,210,-60,0,81',
    ].join('\n');

    const csvPath = path.join(dataDir, 'upload.csv');
    fs.writeFileSync(csvPath, csv, 'utf8');

    // When unauthenticated, the route should short-circuit before multer.
    // Avoid streaming a file body for this check to prevent connection resets.
    const previewUnauth = await request(app).post('/api/preview-csv');
    expect(previewUnauth.status).toBe(401);

    const previewOk = await request(app)
      .post('/api/preview-csv')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', csvPath);
    expect(previewOk.status).toBe(200);
    expect(Array.isArray(previewOk.body.headers)).toBe(true);
    expect(previewOk.body.headers).toContain('timestamp');
    expect(Array.isArray(previewOk.body.preview)).toBe(true);

    const importBadMapping = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', '{not-json')
      .attach('file', csvPath);
    expect(importBadMapping.status).toBe(400);

    const mapping = {
      timestamp: 'timestamp',
      power_pv: 'power_pv',
      power_load: 'power_load',
      power_grid: 'power_grid',
      power_battery: 'power_battery',
      soc: 'soc',
    };

    const importOk = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', JSON.stringify(mapping))
      .attach('file', csvPath);
    expect(importOk.status).toBe(200);
    expect(importOk.body.success).toBe(true);
    expect(importOk.body.imported).toBe(2);

    // Verify DB has data
    const dbPath = path.join(dataDir, 'solar_data.db');
    const db = new sqlite3.Database(dbPath);
    const count = await new Promise<number>((resolve, reject) => {
      db.get('SELECT COUNT(*) as c FROM energy_log', (err: any, row: any) => {
        if (err) return reject(err);
        resolve(Number(row?.c || 0));
      });
    });
    db.close();
    expect(count).toBeGreaterThanOrEqual(2);
  });
});
