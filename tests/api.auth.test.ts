// @vitest-environment node

import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import axios from 'axios';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const sqlite3 = require('sqlite3').verbose();

const waitForTariffs = async (app: any, timeoutMs = 1500) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get('/api/tariffs');
    if (res.status === 200 && Array.isArray(res.body) && res.body.length >= 1) return res;
    await new Promise((r) => setTimeout(r, 25));
  }
  return request(app).get('/api/tariffs');
};

vi.mock('axios', () => {
  const get = vi.fn(async (url: string) => {
    // This file focuses on auth/config behavior; block accidental external calls.
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

describe('Backend API (auth/admin)', () => {
  let dataDir: string;
  let app: any;
  let shutdown: (exitProcess?: boolean) => void;

  const token = 'test-admin-token';

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DISABLE_UPDATE_CHECK = '1';
    process.env.TZ = 'Europe/Berlin';

    // Keep JSON body behavior testable (exercise 413 path)
    process.env.JSON_BODY_LIMIT = '1kb';

    // Keep upload tests deterministic and fast
    process.env.UPLOAD_MAX_BYTES = '1024';

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
      delete process.env.UPLOAD_MAX_BYTES;
      delete process.env.JSON_BODY_LIMIT;
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

  it('validates /api/config payload shapes and types', async () => {
    const badArray = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send([])
      .set('Content-Type', 'application/json');
    expect(badArray.status).toBe(400);

    const badNotificationsType = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: 'nope' })
      .set('Content-Type', 'application/json');
    expect(badNotificationsType.status).toBe(400);

    const badWebhookType = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: { discordWebhook: 123 } })
      .set('Content-Type', 'application/json');
    expect(badWebhookType.status).toBe(400);

    const badNotificationsArray = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: [] })
      .set('Content-Type', 'application/json');
    expect(badNotificationsArray.status).toBe(400);

    const clearWebhook = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: { discordWebhook: '' } })
      .set('Content-Type', 'application/json');
    expect(clearWebhook.status).toBe(200);

    const clearWebhookNull = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: { discordWebhook: null } })
      .set('Content-Type', 'application/json');
    expect(clearWebhookNull.status).toBe(200);

    const getAdmin = await request(app).get('/api/config').set('Authorization', `Bearer ${token}`);
    expect(getAdmin.status).toBe(200);
    expect(getAdmin.body.notifications?.discordWebhook).toBe('');
  });

  it('returns 413 when JSON body is too large', async () => {
    const big = 'x'.repeat(3 * 1024);
    const res = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send({ big });

    expect(res.status).toBe(413);
    expect(String(res.body?.error || '')).toContain('too large');
  });

  it('requires auth and a configured webhook for /api/test-notification', async () => {
    const unauth = await request(app)
      .post('/api/test-notification')
      .send({})
      .set('Content-Type', 'application/json');
    expect(unauth.status).toBe(401);

    const notConfigured = await request(app)
      .post('/api/test-notification')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .set('Content-Type', 'application/json');
    expect(notConfigured.status).toBe(400);
  });

  it('sends /api/test-notification with an allowed webhook (mocked axios)', async () => {
    const webhookUrl = 'https://discord.com/api/webhooks/123/abc';

    const cfgRes = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: { discordWebhook: webhookUrl } })
      .set('Content-Type', 'application/json');
    expect(cfgRes.status).toBe(200);

    // Enable exactly this outbound call path; everything else still fails loudly.
    vi.mocked((axios as any).post).mockResolvedValueOnce({ status: 204, data: {} });

    const res = await request(app)
      .post('/api/test-notification')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });

    expect((axios as any).post).toHaveBeenCalledTimes(1);
    expect((axios as any).post).toHaveBeenCalledWith(
      '/api/webhooks/123/abc',
      expect.objectContaining({
        embeds: [
          expect.objectContaining({
            title: '🔔 Test Notification',
            description: expect.stringContaining('SunFlow notifications'),
            footer: { text: 'SunFlow Gen24' },
            timestamp: expect.any(String),
          }),
        ],
      })
    );
  });

  it('validates /api/config inverterIp hardening', async () => {
    const bad = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ inverterIp: 'http://example.com:80' })
      .set('Content-Type', 'application/json');

    expect(bad.status).toBe(400);

    const ok = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ inverterIp: '192.168.1.10:80' })
      .set('Content-Type', 'application/json');
    expect(ok.status).toBe(200);

    const getRes = await request(app).get('/api/config');
    expect(getRes.status).toBe(200);
    expect(getRes.body.inverterIp).toBe('192.168.1.10:80');
  });

  it('rejects invalid JSON and non-JSON content-types on JSON write endpoints', async () => {
    const badJson = await request(app)
      .post('/api/tariffs')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/json')
      .send('{"validFrom":"2026-01-01",')
      .buffer(true);

    expect(badJson.status).toBe(400);
    expect(badJson.body?.error).toBeDefined();

    const plain = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'text/plain')
      .send('hello');

    expect(plain.status).toBe(400);
    expect(plain.body?.error).toBeDefined();
  });

  it('protects tariff write endpoints and validates inputs', async () => {
    const get0 = await waitForTariffs(app);
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

  it('rejects invalid tariff payloads (date format and negative values)', async () => {
    const badDate = await request(app)
      .post('/api/tariffs')
      .set('Authorization', `Bearer ${token}`)
      .send({ validFrom: '2026-13-01', costPerKwh: 0.5, feedInTariff: 0.1 })
      .set('Content-Type', 'application/json');
    expect(badDate.status).toBe(400);

    const badNegative = await request(app)
      .post('/api/tariffs')
      .set('Authorization', `Bearer ${token}`)
      .send({ validFrom: '2026-01-01', costPerKwh: -0.5, feedInTariff: 0.1 })
      .set('Content-Type', 'application/json');
    expect(badNegative.status).toBe(400);
  });

  it('validates tariff delete IDs (400) and returns 404 for missing (authorized)', async () => {
    const created = await request(app)
      .post('/api/tariffs')
      .set('Authorization', `Bearer ${token}`)
      .send({ validFrom: '2026-01-02', costPerKwh: 0.51, feedInTariff: 0.11 })
      .set('Content-Type', 'application/json');
    expect(created.status).toBe(200);

    const bad1 = await request(app).delete('/api/tariffs/abc').set('Authorization', `Bearer ${token}`);
    expect(bad1.status).toBe(400);

    const bad2 = await request(app).delete('/api/tariffs/0').set('Authorization', `Bearer ${token}`);
    expect(bad2.status).toBe(400);

    const bad3 = await request(app).delete('/api/tariffs/-1').set('Authorization', `Bearer ${token}`);
    expect(bad3.status).toBe(400);

    const bad4 = await request(app).delete('/api/tariffs/1.5').set('Authorization', `Bearer ${token}`);
    expect(bad4.status).toBe(400);

    const missing = await request(app).delete('/api/tariffs/999999').set('Authorization', `Bearer ${token}`);
    expect([400, 404]).toContain(missing.status);

    // Cleanup: best-effort delete the created one (may fail if something else deleted it).
    await request(app).delete(`/api/tariffs/${created.body.id}`).set('Authorization', `Bearer ${token}`);
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

  it('rejects invalid expense payloads (name/date/amount)', async () => {
    const badName = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ', amount: 123, type: 'one_time', date: '2026-01-01' })
      .set('Content-Type', 'application/json');
    expect(badName.status).toBe(400);

    const badDate = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test', amount: 123, type: 'one_time', date: '2026-02-30' })
      .set('Content-Type', 'application/json');
    expect(badDate.status).toBe(400);

    const badNegative = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test', amount: -1, type: 'one_time', date: '2026-01-01' })
      .set('Content-Type', 'application/json');
    expect(badNegative.status).toBe(400);
  });

  it('validates expense delete IDs (400) and returns 404 for missing (authorized)', async () => {
    const created = await request(app)
      .post('/api/expenses')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'ToDelete', amount: 1, type: 'one_time', date: '2026-01-01' })
      .set('Content-Type', 'application/json');
    expect(created.status).toBe(200);

    const bad1 = await request(app).delete('/api/expenses/abc').set('Authorization', `Bearer ${token}`);
    expect(bad1.status).toBe(400);

    const bad2 = await request(app).delete('/api/expenses/0').set('Authorization', `Bearer ${token}`);
    expect(bad2.status).toBe(400);

    const bad3 = await request(app).delete('/api/expenses/-1').set('Authorization', `Bearer ${token}`);
    expect(bad3.status).toBe(400);

    const bad4 = await request(app).delete('/api/expenses/1.5').set('Authorization', `Bearer ${token}`);
    expect(bad4.status).toBe(400);

    const missing = await request(app).delete('/api/expenses/999999').set('Authorization', `Bearer ${token}`);
    expect(missing.status).toBe(404);

    const del = await request(app)
      .delete(`/api/expenses/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(del.status).toBe(200);
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

    const importMissingMapping = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', csvPath);
    expect(importMissingMapping.status).toBe(400);

    const importMappingWrongType = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', '123')
      .attach('file', csvPath);
    expect(importMappingWrongType.status).toBe(400);

    const importMappingArray = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', '[]')
      .attach('file', csvPath);
    expect(importMappingArray.status).toBe(400);

    const importMappingNoTimestamp = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', JSON.stringify({ power_pv: 'power_pv' }))
      .attach('file', csvPath);
    expect(importMappingNoTimestamp.status).toBe(400);

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

  it('rejects non-CSV uploads (fileFilter) with a clean 400', async () => {
    const badPath = path.join(dataDir, 'upload.json');
    fs.writeFileSync(badPath, JSON.stringify({ hello: 'world' }), 'utf8');

    const res = await request(app)
      .post('/api/preview-csv')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', badPath, { filename: 'evil.json', contentType: 'application/json' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Only CSV uploads are allowed' });
  });

  it('returns 413 when uploaded CSV exceeds size limit', async () => {
    const bigRows = Array.from({ length: 400 }, (_, i) => `2026-01-15T10:${String(i % 60).padStart(2, '0')}:00Z,1`);
    const bigCsv = ['timestamp,power_pv', ...bigRows].join('\n');

    const bigPath = path.join(dataDir, 'big.csv');
    fs.writeFileSync(bigPath, bigCsv, 'utf8');

    const res = await request(app)
      .post('/api/preview-csv')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', bigPath);

    expect(res.status).toBe(413);
    expect(String(res.body?.error || '')).toMatch(/too large|file/i);

    const importRes = await request(app)
      .post('/api/import-csv')
      .set('Authorization', `Bearer ${token}`)
      .field('mapping', JSON.stringify({ timestamp: 'timestamp', power_pv: 'power_pv' }))
      .attach('file', bigPath);
    expect(importRes.status).toBe(413);
    expect(String(importRes.body?.error || '')).toMatch(/too large|file/i);
  });
});
