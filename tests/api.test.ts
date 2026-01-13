// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('Backend API (integration)', () => {
  let dataDir: string;
  let app: any;
  let shutdown: (exitProcess?: boolean) => void;

  beforeAll(async () => {
    // Ensure server.js behaves deterministically in tests.
    process.env.NODE_ENV = 'test';
    process.env.DISABLE_UPDATE_CHECK = '1';

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
});
