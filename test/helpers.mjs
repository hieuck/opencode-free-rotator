import fs from 'fs';
import os from 'os';
import path from 'path';
import { AccountManager } from '../src/AccountManager.mjs';

/** Keeps test output readable; assertions carry the signal. */
export const silentLogger = {
  log() {},
  warn() {},
  error() {},
  info() {},
};

/**
 * Create an AccountManager backed by a temporary config file.
 *
 * Accounts use static `token` credentials so no SQLite database is needed.
 * Runtime state is injected directly, so selection logic can be tested without
 * touching the network.
 */
export function createManager(configOverrides = {}, options = {}) {
  const { ready = true, stats = {}, fetchImpl = globalThis.fetch, accountNames = ['A', 'B', 'C'] } = options;

  const config = {
    upstream: {
      baseUrl: 'http://127.0.0.1:1',
      chatPath: '/v1/chat/completions',
      modelsPath: '/models',
      usageUrl: 'http://127.0.0.1:1/usage',
      timeoutMs: 5000,
    },
    accounts: accountNames.map((name) => ({
      name,
      email: `${name.toLowerCase()}@example.test`,
      token: `st_${name.toLowerCase()}`,
      orgId: `wrk_${name.toLowerCase()}`,
      quotaPerDay: 5,
      enabled: true,
    })),
    gateway: {
      port: 20130,
      host: '127.0.0.1',
      selectionStrategy: 'lowest-usage',
      retryOnFailure: true,
      maxRetries: 3,
      requestTimeout: 5000,
      cooldownOn429Ms: 100,
      stateFile: null,
    },
    ...configOverrides,
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotator-test-'));
  const configPath = path.join(dir, 'config.yaml');
  fs.writeFileSync(configPath, JSON.stringify(config)); // JSON is valid YAML

  const manager = new AccountManager(configPath, { logger: silentLogger, fetchImpl });

  if (ready) {
    for (const account of manager.accounts.values()) {
      account.ready = true;
      account.error = null;
      account.auth = {
        token: `st_${account.name.toLowerCase()}`,
        orgId: `wrk_${account.name.toLowerCase()}`,
        email: `${account.name.toLowerCase()}@example.test`,
        type: 'key',
        tokenPreview: 'st_test…',
      };
      Object.assign(account.stats, structuredClone(stats));
    }
  }

  manager.cleanup = () => {
    try {
      manager.tokenManager?.close();
    } catch {
      /* ignore */
    }
    fs.rmSync(dir, { recursive: true, force: true });
  };
  return manager;
}

/** Build a Gateway around an already-created (fake-state) manager. */
export function makeGateway(manager, options = {}) {
  // Imported lazily so helpers stay usable by AccountManager-only tests.
  return import('../src/Gateway.mjs').then(({ Gateway }) => {
    const gateway = new Gateway(manager.configPath, { logger: silentLogger, ...options });
    gateway.manager = manager;
    return gateway;
  });
}
