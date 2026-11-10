import fs from 'fs';
import os from 'os';
import path from 'path';
import { InstanceManager } from '../src/InstanceManager.mjs';

/**
 * Create an InstanceManager backed by a temporary config file, with fake
 * runtime state injected so selection logic can be tested without spawning
 * real opencode processes.
 */
export function createManager(overrides = {}, instanceOverrides = {}) {
  const config = {
    instances: [
      { name: 'A', port: 3001, db: '/tmp/a.db', quotaPerDay: 5, enabled: true },
      { name: 'B', port: 3002, db: '/tmp/b.db', quotaPerDay: 5, enabled: true },
      { name: 'C', port: 3003, db: '/tmp/c.db', quotaPerDay: 5, enabled: true },
    ],
    gateway: {
      port: 20130,
      host: '127.0.0.1',
      selectionStrategy: 'lowest-usage',
      retryOnFailure: true,
      maxRetries: 3,
      requestTimeout: 5000,
      upstreamPath: '/v1/chat/completions',
    },
    ...overrides,
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotator-test-'));
  const configPath = path.join(dir, 'config.yaml');
  fs.writeFileSync(configPath, JSON.stringify(config)); // JSON is valid YAML

  const manager = new InstanceManager(configPath);

  for (const instanceConfig of manager.config.instances) {
    manager.instances.set(instanceConfig.port, makeFakeInstance(instanceConfig, instanceOverrides));
  }

  manager.cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  return manager;
}

export function makeFakeInstance(instanceConfig, overrides = {}) {
  return {
    port: instanceConfig.port,
    child: { kill() {}, once() {} },
    config: instanceConfig,
    auth: { username: 'opencode', password: 'secret' },
    ready: true,
    exited: false,
    exitCode: null,
    exitSignal: null,
    spawnError: null,
    stats: {
      requestsToday: 0,
      inFlight: 0,
      failures: 0,
      lastReset: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      lastError: null,
      cooldownUntil: 0,
      limited: null,
      usage: null,
      lastQuotaAt: null,
      lastQuotaError: null,
      ...(overrides.stats || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'stats')),
  };
}
