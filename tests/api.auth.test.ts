// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
});
