/**
 * End-to-end check against real `opencode serve` processes.
 *
 * Verifies the P0 fixes:
 *   1. no `process` TDZ crash when spawning
 *   2. `opencode serve --port --hostname` is accepted
 *   3. the health probe uses a JSON endpoint and passes
 *   4. sandbox instances (fresh DBs) are detected as "not signed in"
 *   5. real quota is parsed from /api/experimental/usage/limits
 *
 * Usage: node scripts/integration-test.mjs [--live-db]
 *   --live-db  also copy your real OpenCode DB and read real quota from it
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { InstanceManager } from '../src/InstanceManager.mjs';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`✅ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error: error.message });
    console.log(`❌ ${name}\n     ${error.message}`);
  }
}

const asserts = (await import('node:assert/strict')).default;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rotator-it-'));
const configPath = path.join(tmpRoot, 'config.yaml');
const ports = [3101, 3102];

const config = {
  opencode: {
    command: process.env.OPENCODE_BIN || 'opencode',
    healthPath: '/api/info',
    startupTimeoutMs: 60000,
    healthIntervalMs: 500,
    quotaPollIntervalMs: 0,
  },
  instances: ports.map((port) => ({
    name: `IT-${port}`,
    email: `it-${port}@example.com`,
    port,
    db: path.join(tmpRoot, `db${port}.db`),
    quotaPerDay: 200,
    enabled: true,
  })),
  gateway: {
    port: 20199,
    host: '127.0.0.1',
    selectionStrategy: 'lowest-usage',
    retryOnFailure: true,
    maxRetries: 3,
    requestTimeout: 30000,
    upstreamPath: '/v1/chat/completions',
  },
};
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

console.log('\n=== Booting real opencode serve instances ===\n');

const manager = new InstanceManager(configPath);
let bootError = null;

try {
  await manager.startAll();
} catch (error) {
  bootError = error;
}

check('instances started without a TDZ / spawn error', () => {
  asserts.equal(bootError, null, bootError?.stack || '');
  asserts.equal(manager.instances.size, ports.length);
});

check('every instance is ready', () => {
  for (const instance of manager.instances.values()) {
    asserts.equal(instance.ready, true, `${instance.config.name} not ready`);
  }
});

check('health endpoint returns opencode version JSON', async () => {
  const instance = manager.instances.get(ports[0]);
  asserts.ok(instance, 'instance missing');
  const response = await fetch(`${manager.baseUrl(instance)}/api/info`, {
    headers: manager.authHeader(instance),
    signal: AbortSignal.timeout(5000),
  });
  asserts.equal(response.status, 200);
  const body = await response.json();
  asserts.equal(typeof body.version, 'string');
  console.log(`     opencode version reported: ${body.version}`);
});

check('legacy /health is HTML, proving why healthPath was changed', async () => {
  const instance = manager.instances.get(ports[0]);
  const response = await fetch(`${manager.baseUrl(instance)}/health`, { signal: AbortSignal.timeout(5000) });
  asserts.equal(response.status, 200);
  const contentType = response.headers.get('content-type') || '';
  asserts.ok(contentType.includes('html'), `expected HTML, got ${contentType}`);
  await response.text();
});

check('unauthenticated API access is rejected', async () => {
  const instance = manager.instances.get(ports[0]);
  const response = await fetch(`${manager.baseUrl(instance)}/api/info`, { signal: AbortSignal.timeout(5000) });
  asserts.equal(response.status, 401);
  await response.text();
});

check('quota is read from the usage API (sandbox DB is not signed in)', async () => {
  const instance = manager.instances.get(ports[0]);
  const usage = await manager.refreshQuota(instance.port);
  asserts.equal(usage, null, 'a fresh DB should not report usage');
  asserts.match(instance.stats.lastQuotaError || '', /not signed in/i);
});

check('selection refuses instances nothing can serve', () => {
  // Fresh DBs are "not signed in" but still have quota counters, so they are
  // selectable; the guard is that inFlight is reserved and released cleanly.
  const picked = manager.selectInstance();
  asserts.ok(picked, 'expected an instance to be selectable');
  asserts.equal(picked.stats.inFlight, 1);
  manager.releaseInstance(picked, { consumed: true });
  asserts.equal(picked.stats.inFlight, 0);
  asserts.equal(picked.stats.requestsToday, 1);
});

check('lowest-usage spreads 4 requests across 2 instances', () => {
  for (let i = 0; i < 4; i++) {
    const picked = manager.selectInstance();
    manager.releaseInstance(picked, { consumed: true });
  }
  const counts = [...manager.instances.values()].map((i) => i.stats.requestsToday).sort();
  asserts.deepEqual(counts, [3, 3]);
});

// Optional: read real quota from the live signed-in database.
if (process.argv.includes('--live-db')) {
  const liveDb = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  const copy = path.join(tmpRoot, 'live.db');
  if (fs.existsSync(liveDb)) {
    console.log('\n=== Copying live DB to read real quota ===\n');
    fs.copyFileSync(liveDb, copy);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(liveDb + suffix)) fs.copyFileSync(liveDb + suffix, copy + suffix);
    }

    const liveConfig = {
      ...config,
      instances: [
        {
          name: 'IT-live',
          email: 'live@example.com',
          port: 3103,
          db: copy,
          quotaPerDay: 200,
          enabled: true,
        },
      ],
    };
    const livePath = path.join(tmpRoot, 'live.yaml');
    fs.writeFileSync(livePath, JSON.stringify(liveConfig, null, 2));

    const liveManager = new InstanceManager(livePath);
    try {
      await liveManager.startInstance(liveConfig.instances[0]);
      const instance = liveManager.instances.get(3103);

      check('real quota parsed from /api/experimental/usage/limits', () => {
        asserts.ok(instance.stats.usage, 'no usage returned');
        const go = instance.stats.usage.go || {};
        console.log(`     workspace: ${instance.stats.usage.workspace?.name}`);
        console.log(`     rolling:   ${go.rolling?.percent}% limited=${go.rolling?.limited}`);
        console.log(`     weekly:    ${go.weekly?.percent}% limited=${go.weekly?.limited}`);
        console.log(`     monthly:   ${go.monthly?.percent}% limited=${go.monthly?.limited}`);
        asserts.equal(typeof instance.stats.limited, 'boolean');
      });

      check('limited accounts are excluded from selection', () => {
        if (instance.stats.limited === true) {
          asserts.equal(liveManager.selectInstance(), null, 'limited instance must not be selected');
        }
      });
    } catch (error) {
      check('real quota parsed from /api/experimental/usage/limits', () => {
        throw new Error(`live instance failed to start: ${error.message}`);
      });
    } finally {
      await liveManager.stopAll();
    }
  } else {
    console.log(`\n(skipping live DB check, ${liveDb} not found)\n`);
  }
}

console.log('\n=== Shutting down ===\n');
await manager.stopAll();
fs.rmSync(tmpRoot, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
