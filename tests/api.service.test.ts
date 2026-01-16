// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getAwattarComparison,
  getHistory,
  importCsv,
  previewCsv,
  saveConfig,
} from '../services/api';

const fetchMock = vi.mocked(global.fetch);

describe('services/api.ts (unit)', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('builds history URL for non-custom range', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn(async () => ({ ok: true })),
    } as any);

    await getHistory('day', undefined, undefined, 7);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/history?range=day&offset=7');
  });

  it('builds history URL for custom range including start/end', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn(async () => ({ ok: true })),
    } as any);

    await getHistory('custom', '2026-01-01', '2026-01-02', 0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/history?range=custom&offset=0&start=2026-01-01&end=2026-01-02');
  });

  it('saveConfig POSTs JSON and throws on non-OK', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false } as any);

    await expect(saveConfig({} as any)).rejects.toThrow('API call failed');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/config');
    expect(opts).toMatchObject({ method: 'POST' });
    expect((opts as any).headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('previewCsv sends multipart form-data with file', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn(async () => ({ headers: ['a'], preview: [] })),
    } as any);

    const file = new File(['a,b\n1,2'], 'test.csv', { type: 'text/csv' });
    const res = await previewCsv(file);

    expect(res.headers).toEqual(['a']);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/preview-csv');
    expect((opts as any).method).toBe('POST');
    expect((opts as any).body).toBeInstanceOf(FormData);

    const body = (opts as any).body as FormData;
    expect(body.get('file')).toBe(file);
  });

  it('importCsv sends multipart form-data with file + mapping JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn(async () => ({ success: true, imported: 1, failed: 0 })),
    } as any);

    const file = new File(['timestamp,power\n2026-01-01T00:00:00Z,1'], 'test.csv', { type: 'text/csv' });
    const mapping = { timestamp: 'timestamp', power_pv: 'power' };

    const res = await importCsv(file, mapping);
    expect(res).toEqual({ success: true, imported: 1, failed: 0 });

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/import-csv');
    expect((opts as any).method).toBe('POST');

    const body = (opts as any).body as FormData;
    expect(body.get('file')).toBe(file);
    expect(body.get('mapping')).toBe(JSON.stringify(mapping));
  });

  it('getAwattarComparison builds query string and returns JSON', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: vi.fn(async () => ({ ok: true })),
    } as any);

    await getAwattarComparison({
      period: 'today',
      country: 'DE',
      surchargeCt: 2.5,
      vatPercent: 19,
    } as any);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    const parsed = new URL(url, 'http://localhost');

    expect(parsed.pathname).toBe('/api/dynamic-pricing/awattar/compare');
    expect(parsed.searchParams.get('period')).toBe('today');
    expect(parsed.searchParams.get('country')).toBe('DE');
    expect(parsed.searchParams.get('surchargeCt')).toBe('2.5');
    expect(parsed.searchParams.get('vatPercent')).toBe('19');
  });

  it('getAwattarComparison throws API error message when provided', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: vi.fn(async () => ({ error: 'boom' })),
    } as any);

    await expect(getAwattarComparison({ period: 'today' } as any)).rejects.toThrow('boom');
  });
});
