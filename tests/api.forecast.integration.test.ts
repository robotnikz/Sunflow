// @vitest-environment node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import axios from 'axios';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type ServerModule = {
  app: any;
  shutdown: (exitProcess?: boolean) => void;
};

vi.mock('axios', () => {
  const get = vi.fn();
  const post = vi.fn();
  return {
    default: {
      get,
      post,
      create: vi.fn(() => ({ get, post })),
    },
  };
});

const axiosMock = vi.mocked(axios);
const axiosGet = axiosMock.get as unknown as any;
const axiosPost = axiosMock.post as unknown as any;

const writeConfig = (dataDir: string, cfg: any) => {
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(cfg, null, 2));
};

const rmDirWithRetries = async (dir: string) => {
  const attempts = 8;
  for (let i = 0; i < attempts; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return;
    } catch (e: any) {
      // On Windows, sqlite can keep a handle briefly after shutdown.
      if (e?.code !== 'EPERM') throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  // Last attempt, surface the error if it still fails.
  fs.rmSync(dir, { recursive: true, force: true });
};

describe('Backend API (forecast integration)', () => {
  let dataDir: string;
  let app: any;
  let shutdown: (exitProcess?: boolean) => void;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.VITEST = '1';
    process.env.DISABLE_UPDATE_CHECK = '1';
    process.env.TZ = 'Europe/Berlin';

    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sunflow-test-'));
    process.env.DATA_DIR = dataDir;

    // Start with no Solcast config.
    writeConfig(dataDir, { currency: 'EUR' });

    // @ts-ignore importing JS module without types
    const mod = (await import('../server.js')) as unknown as ServerModule;
    ({ app, shutdown } = mod);
  });

  afterAll(async () => {
    try {
      shutdown?.(false);
    } finally {
      vi.useRealTimers();
      delete process.env.DATA_DIR;
      delete process.env.SUNFLOW_ADMIN_TOKEN;
      delete process.env.SUNFLOW_PROTECT_SECRETS;
      await rmDirWithRetries(dataDir);
    }
  });

  beforeEach(() => {
    axiosGet.mockReset();
    axiosPost.mockReset();
  });

  it('returns 400 when Solcast not configured', async () => {
    const res = await request(app).get('/api/forecast');
    expect(res.status).toBe(400);
    expect(res.body?.error).toBe('Solcast not configured');
  });

  it('at night with empty cache, returns empty forecasts and does not call Solcast', async () => {
    const cfg = {
      solcastApiKey: 'k',
      solcastSiteId: 'site',
    };

    const save = await request(app)
      .post('/api/config')
      .set('Content-Type', 'application/json')
      .send(cfg);
    expect(save.status).toBe(200);
    expect(save.body?.success).toBe(true);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T02:00:00+01:00'));

    const night = await request(app).get('/api/forecast');
    expect(night.status).toBe(200);
    expect(night.body).toEqual({ forecasts: [] });
    expect(axiosGet).toHaveBeenCalledTimes(0);
  });

  it('fetches Solcast during daytime and serves cache afterwards (no second axios call)', async () => {
    axiosGet.mockResolvedValue({
      data: { forecasts: [{ period_end: '2026-01-15T10:30:00Z', pv_estimate: 1.23 }] },
    } as any);

    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T10:00:00+01:00'));

    const r1 = await request(app).get('/api/forecast');
    expect(r1.status).toBe(200);
    expect(r1.body?.forecasts?.length).toBe(1);
    expect(axiosGet).toHaveBeenCalledTimes(1);

    const r2 = await request(app).get('/api/forecast');
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual(r1.body);
    expect(axiosGet).toHaveBeenCalledTimes(1);
  });

  it('does not call Solcast at night; returns cached data if available', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T02:00:00+01:00'));

    const night = await request(app).get('/api/forecast');
    expect(night.status).toBe(200);
    expect(night.body?.forecasts?.length).toBe(1);
    expect(axiosGet).toHaveBeenCalledTimes(0);
  });
});
