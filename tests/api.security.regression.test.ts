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

describe('Backend API (security regressions)', () => {
  let dataDir: string;
  let app: any;
  let shutdown: (exitProcess?: boolean) => void;

  const token = 'test-admin-token';

  beforeAll(async () => {
    // Force deterministic, secure-by-default CORS behavior.
    process.env.NODE_ENV = 'production';
    process.env.VITEST = '1';
    process.env.DISABLE_UPDATE_CHECK = '1';
    process.env.TZ = 'Europe/Berlin';

    process.env.SUNFLOW_ADMIN_TOKEN = token;

    // Only allow this origin.
    process.env.CORS_ORIGIN = 'https://allowed.example';

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflow-test-'));
    process.env.DATA_DIR = dataDir;

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
      delete process.env.CORS_ORIGIN;
      delete process.env.DATA_DIR;
    }
  });

  it('enforces CORS allowlist when configured', async () => {
    const allowed = await request(app).get('/api/info').set('Origin', 'https://allowed.example');
    expect(allowed.status).toBe(200);
    expect(allowed.headers['access-control-allow-origin']).toBe('https://allowed.example');

    const denied = await request(app).get('/api/info').set('Origin', 'https://evil.example');
    expect(denied.status).toBe(200);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('validates Discord webhook URL on /api/config and tests only persisted webhook', async () => {
    const badHttp = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: { discordWebhook: 'http://discord.com/api/webhooks/123/abc' } })
      .set('Content-Type', 'application/json');
    expect(badHttp.status).toBe(400);

    const badPath = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: { discordWebhook: 'https://discord.com/not-webhooks/123/abc' } })
      .set('Content-Type', 'application/json');
    expect(badPath.status).toBe(400);

    // Not configured => cannot test
    const notConfigured = await request(app)
      .post('/api/test-notification')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .set('Content-Type', 'application/json');
    expect(notConfigured.status).toBe(400);

    const okCfg = await request(app)
      .post('/api/config')
      .set('Authorization', `Bearer ${token}`)
      .send({ notifications: { discordWebhook: 'https://discord.com/api/webhooks/123/abc' } })
      .set('Content-Type', 'application/json');
    expect(okCfg.status).toBe(200);

    // Avoid log noise (this should be "allowed" but must not hit the network in tests)
    vi.mocked((axios as any).post).mockResolvedValueOnce({ status: 204, data: {} });

    const ok = await request(app)
      .post('/api/test-notification')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .set('Content-Type', 'application/json');
    expect(ok.status).toBe(200);
    expect(ok.body).toEqual({ success: true });

    expect((axios as any).post).toHaveBeenCalledTimes(1);
  });
});
