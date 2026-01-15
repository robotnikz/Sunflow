// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const axiosPostMock = vi.fn(async () => ({ data: {} }));
const axiosGetMock = vi.fn(async (url: string) => {
  throw new Error(`Unexpected axios.get in tests: ${url}`);
});

vi.mock('axios', () => {
  return {
    default: {
      get: axiosGetMock,
      post: axiosPostMock,
    },
  };
});

describe('Security hardening (backend)', () => {
  let dataDir: string;
  let app: any;
  let shutdown: (exitProcess?: boolean) => void;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DISABLE_UPDATE_CHECK = '1';
    process.env.TZ = 'Europe/Berlin';

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflow-test-sec-'));
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

  it('sets a Content-Security-Policy header by default', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);

    // Helmet typically uses lowercase header names in supertest.
    expect(res.headers['content-security-policy']).toBeTruthy();
  });

  it('rejects non-Discord webhook URLs for test notification', async () => {
    const res = await request(app)
      .post('/api/test-notification')
      .send({ webhookUrl: 'https://example.com/api/webhooks/123/abc' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
    expect(res.body).toBeTypeOf('object');
    expect(String(res.body.error || '')).toMatch(/invalid webhook/i);
  });

  it('accepts Discord webhook URLs and posts to axios', async () => {
    axiosPostMock.mockClear();

    const res = await request(app)
      .post('/api/test-notification')
      .send({ webhookUrl: 'https://discord.com/api/webhooks/1234567890/abcdef' })
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(axiosPostMock).toHaveBeenCalledTimes(1);
  });

  it('blocks external inverter hosts from being fetched (SSRF guard)', async () => {
    // If this tried to call axios.get for Fronius, our mock would throw.
    await request(app)
      .post('/api/config')
      .send({ inverterIp: '8.8.8.8' })
      .set('Content-Type', 'application/json');

    const res = await request(app).get('/api/data');
    expect(res.status).toBe(200);
    expect(res.body).toBeTypeOf('object');
    expect(res.body.power).toBeTypeOf('object');
  });

  it('returns 400 for invalid Solcast credentials without calling axios.get', async () => {
    axiosGetMock.mockClear();

    await request(app)
      .post('/api/config')
      .send({ solcastApiKey: '!!!', solcastSiteId: '###' })
      .set('Content-Type', 'application/json');

    const res = await request(app).get('/api/forecast');
    expect(res.status).toBe(400);
    expect(axiosGetMock).not.toHaveBeenCalled();
  });

  it('preview-csv and import-csv accept a normal uploaded file', async () => {
    const csv = [
      'ts,power_pv,power_load,power_grid,power_battery,soc',
      '2025-01-01T00:00:00Z,100,200,-50,0,50',
    ].join('\n');

    const previewRes = await request(app)
      .post('/api/preview-csv')
      .attach('file', Buffer.from(csv, 'utf8'), 'test.csv');

    expect(previewRes.status).toBe(200);
    expect(Array.isArray(previewRes.body.headers)).toBe(true);
    expect(Array.isArray(previewRes.body.preview)).toBe(true);

    const mapping = {
      timestamp: 'ts',
      power_pv: 'power_pv',
      power_load: 'power_load',
      power_grid: 'power_grid',
      power_battery: 'power_battery',
      soc: 'soc',
    };

    const importRes = await request(app)
      .post('/api/import-csv')
      .field('mapping', JSON.stringify(mapping))
      .attach('file', Buffer.from(csv, 'utf8'), 'test.csv');

    expect(importRes.status).toBe(200);
    expect(importRes.body.success).toBe(true);
    expect(importRes.body.imported).toBe(1);
  });
});
