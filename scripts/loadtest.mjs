import process from 'node:process';

const parseArgs = (argv) => {
  const out = { url: null, duration: 10, connections: 25 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') out.url = argv[++i];
    else if (a === '--duration') out.duration = Number(argv[++i]);
    else if (a === '--connections') out.connections = Number(argv[++i]);
    else if (!a.startsWith('-') && !out.url) out.url = a;
  }
  return out;
};

const main = async () => {
  const { url, duration, connections } = parseArgs(process.argv.slice(2));
  const baseUrl = (url || process.env.SUNFLOW_URL || 'http://localhost:3000').replace(/\/$/, '');

  const durationSec = Number.isFinite(duration) && duration > 0 ? duration : 10;
  const connectionsNum = Number.isFinite(connections) && connections > 0 ? connections : 25;

  const mod = await import('autocannon');
  // autocannon is CJS; in ESM it may appear as default or as module itself.
  const autocannon = mod.default || mod;

  const targets = [
    { path: '/api/info', name: 'info' },
    { path: '/api/tariffs', name: 'tariffs' },
  ];

  console.log(`Sunflow load test (baseUrl=${baseUrl}, duration=${durationSec}s, connections=${connectionsNum})`);

  for (const t of targets) {
    const targetUrl = `${baseUrl}${t.path}`;
    console.log(`\n--- ${t.name}: ${targetUrl} ---`);

    await new Promise((resolve, reject) => {
      const instance = autocannon(
        {
          url: targetUrl,
          connections: connectionsNum,
          duration: durationSec,
          headers: { Accept: 'application/json' },
        },
        (err, result) => {
          if (err) return reject(err);
          console.log(autocannon.printResult(result));
          resolve(null);
        },
      );

      autocannon.track(instance, { renderProgressBar: true });
    });
  }

  console.log('\nDone.');
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
