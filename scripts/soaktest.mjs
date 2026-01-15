#!/usr/bin/env node
/*
  Simple stability/soak test for SunFlow.

  Usage:
    npm run soaktest -- --url http://localhost:3000 --duration 3600 --interval 2

  Notes:
    - Uses Node 20+ global fetch.
    - Intended as a lightweight long-run smoke (no assertions, logs failures + latency).
*/

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const idx = args.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const v = args[idx + 1];
  return v === undefined ? fallback : v;
};

const baseUrl = String(getArg('url', 'http://localhost:3000')).replace(/\/$/, '');
const durationSec = Number(getArg('duration', '3600'));
const intervalSec = Number(getArg('interval', '2'));

if (!Number.isFinite(durationSec) || durationSec <= 0) {
  console.error('Invalid --duration (seconds)');
  process.exit(2);
}
if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
  console.error('Invalid --interval (seconds)');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const endpoints = [
  '/api/info',
  '/api/config',
  '/api/tariffs',
  '/api/expenses',
  '/api/history?range=week',
];

const start = Date.now();
const end = start + durationSec * 1000;

let ok = 0;
let fail = 0;
let i = 0;

const fetchJson = async (url) => {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await res.text();
  const ms = Date.now() - t0;

  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  return { status: res.status, ms, json, text };
};

console.log(`Soaktest starting: baseUrl=${baseUrl} duration=${durationSec}s interval=${intervalSec}s`);
console.log(`Endpoints: ${endpoints.join(', ')}`);

while (Date.now() < end) {
  i += 1;
  for (const ep of endpoints) {
    const url = `${baseUrl}${ep}`;
    try {
      const r = await fetchJson(url);
      const isOk = r.status >= 200 && r.status < 300;
      if (isOk) {
        ok += 1;
      } else {
        fail += 1;
        console.error(`[${new Date().toISOString()}] FAIL ${r.status} ${r.ms}ms ${url}`);
        if (r.text) console.error(`  body: ${r.text.slice(0, 500)}`);
      }
    } catch (e) {
      fail += 1;
      console.error(`[${new Date().toISOString()}] ERROR ${url}: ${(e && e.message) || String(e)}`);
    }
  }

  if (i % 10 === 0) {
    const elapsedSec = Math.round((Date.now() - start) / 1000);
    console.log(`Progress: ${elapsedSec}s ok=${ok} fail=${fail}`);
  }

  await sleep(intervalSec * 1000);
}

const total = ok + fail;
console.log(`Soaktest finished: total=${total} ok=${ok} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
