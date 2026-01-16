// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import axios from 'axios';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

describe('Backend API (compatibility / default mode)', () => {
  let dataDir: string;
  let app: any;
  let shutdown: (exitProcess?: boolean) => void;

  beforeAll(async () => {
    vi.resetModules();

    process.env.NODE_ENV = 'test';
    process.env.VITEST = '1';
    process.env.DISABLE_UPDATE_CHECK = '1';
    process.env.TZ = 'Europe/Berlin';

    // IMPORTANT: default mode means no admin token is set.
    delete process.env.SUNFLOW_ADMIN_TOKEN;
    delete process.env.SUNFLOW_PROTECT_SECRETS;

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflow-test-'));
    process.env.DATA_DIR = dataDir;

    // @ts-ignore importing JS module without types
    const mod = (await import('../server.js')) as unknown as ServerModule;
    ({ app, shutdown } = mod);
  });

  afterAll(async () => {
    try {
      shutdown?.(false);
    } finally {
      delete process.env.DATA_DIR;
      await rmDirWithRetries(dataDir);
    }
  });

  it('allows POST /api/config without Authorization when SUNFLOW_ADMIN_TOKEN is unset', async () => {
    const cfg = {
      currency: 'EUR',
      solcastApiKey: 'secret-key',
      solcastSiteId: 'siteid',
      notifications: { discordWebhook: 'https://discord.com/api/webhooks/123/abc' },
      inverterIp: '192.168.1.50',
    };

    const postRes = await request(app)
      .post('/api/config')
      .send(cfg)
      .set('Content-Type', 'application/json');

    expect(postRes.status).toBe(200);

    const getRes = await request(app).get('/api/config');
    expect(getRes.status).toBe(200);

    // In default mode, secrets are NOT redacted.
    expect(getRes.body.solcastApiKey).toBe('secret-key');
    expect(getRes.body.notifications?.discordWebhook).toBe('https://discord.com/api/webhooks/123/abc');
  });

  it('allows tariffs and expenses writes without Authorization when SUNFLOW_ADMIN_TOKEN is unset', async () => {
    const tariffRes = await request(app)
      .post('/api/tariffs')
      .send({ validFrom: '2026-01-01', costPerKwh: 0.5, feedInTariff: 0.1 })
      .set('Content-Type', 'application/json');
    expect(tariffRes.status).toBe(200);

    const expenseRes = await request(app)
      .post('/api/expenses')
      .send({ name: 'Test', amount: 10, type: 'one_time', date: '2026-01-01' })
      .set('Content-Type', 'application/json');
    expect(expenseRes.status).toBe(200);
  });

  it('allows CSV preview/import without Authorization when SUNFLOW_ADMIN_TOKEN is unset', async () => {
    const csv = [
      'timestamp,power_pv,power_load,power_grid,power_battery,soc',
      '2026-01-15T10:00:00Z,100,200,-50,0,80',
      '2026-01-15T10:01:00Z,110,210,-60,0,81',
    ].join('\n');

    const csvPath = path.join(dataDir, 'upload.csv');
    fs.writeFileSync(csvPath, csv, 'utf8');

    const previewRes = await request(app).post('/api/preview-csv').attach('file', csvPath);
    expect(previewRes.status).toBe(200);
    expect(previewRes.body.headers).toContain('timestamp');

    const mapping = {
      timestamp: 'timestamp',
      power_pv: 'power_pv',
      power_load: 'power_load',
      power_grid: 'power_grid',
      power_battery: 'power_battery',
      soc: 'soc',
    };

    const importRes = await request(app)
      .post('/api/import-csv')
      .field('mapping', JSON.stringify(mapping))
      .attach('file', csvPath);

    expect(importRes.status).toBe(200);
    expect(importRes.body.success).toBe(true);
    expect(importRes.body.imported).toBe(2);
  });

  it('tests notifications against persisted webhook and ignores request body webhookUrl (default mode)', async () => {
    const axiosPost = vi.mocked((axios as any).post);

    // Persist webhook in config
    const cfgRes = await request(app)
      .post('/api/config')
      .send({ notifications: { discordWebhook: 'https://discord.com/api/webhooks/123/abc' } })
      .set('Content-Type', 'application/json');
    expect(cfgRes.status).toBe(200);

    axiosPost.mockResolvedValueOnce({ status: 204, data: {} });

    const testRes = await request(app)
      .post('/api/test-notification')
      .send({ webhookUrl: 'https://discord.com/api/webhooks/999/zzz' })
      .set('Content-Type', 'application/json');

    expect(testRes.status).toBe(200);
    expect(testRes.body).toEqual({ success: true });

    // Should send only to the persisted webhook (123/abc), not the request body.
    expect(axiosPost).toHaveBeenCalledTimes(1);
    expect(axiosPost).toHaveBeenCalledWith(
      '/api/webhooks/123/abc',
      expect.any(Object),
    );
  });
});
