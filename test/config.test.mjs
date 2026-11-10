import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { AccountManager } from '../src/AccountManager.mjs';
import { createManager, silentLogger } from './helpers.mjs';

function writeConfig(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotator-cfg-'));
  const configPath = path.join(dir, 'config.yaml');
  fs.writeFileSync(configPath, JSON.stringify(config));
  return { configPath, dir };
}

function build(config) {
  const { configPath, dir } = writeConfig(config);
  try {
    return new AccountManager(configPath, { logger: silentLogger });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('config validation rejects duplicate account names', () => {
  const { configPath, dir } = writeConfig({
    accounts: [
      { name: 'A', token: 'st_a' },
      { name: 'A', token: 'st_b' },
    ],
    gateway: { port: 20130 },
  });
  assert.throws(() => new AccountManager(configPath, { logger: silentLogger }), /Duplicate account name/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config validation rejects a missing accounts list', () => {
  const { configPath, dir } = writeConfig({ gateway: { port: 20130 } });
  assert.throws(() => new AccountManager(configPath, { logger: silentLogger }), /accounts/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config validation rejects a missing gateway block', () => {
  const { configPath, dir } = writeConfig({ accounts: [{ name: 'A', token: 'st_a' }] });
  assert.throws(() => new AccountManager(configPath, { logger: silentLogger }), /gateway/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an account needs a db path or a static token', () => {
  assert.throws(() => build({ accounts: [{ name: 'A', email: 'a@b.c' }], gateway: {} }), /needs either "db"/);
});

test('an invalid quotaPerDay is rejected', () => {
  assert.throws(
    () => build({ accounts: [{ name: 'A', token: 'st_a', quotaPerDay: 0 }], gateway: {} }),
    /invalid quotaPerDay/,
  );
});

test('config with no enabled accounts is rejected', () => {
  assert.throws(
    () => build({ accounts: [{ name: 'A', token: 'st_a', enabled: false }], gateway: {} }),
    /No enabled accounts/,
  );
});

test('legacy "instances" configs still load so old setups do not break', () => {
  const manager = build({
    instances: [{ name: 'Legacy', port: 3001, db: '~/.local/share/opencode/opencode.db' }],
    gateway: { port: 20130 },
  });
  assert.equal(manager.accounts.size, 1);
  assert.ok(manager.accounts.get('Legacy').config.db.endsWith(path.join('.local', 'share', 'opencode', 'opencode.db')));
});

test('hosted upstream defaults are applied', () => {
  const manager = build({ accounts: [{ name: 'A', token: 'st_a' }], gateway: {} });
  assert.equal(manager.upstream.baseUrl, 'https://opencode.ai/inference/openai/v1');
  assert.equal(manager.upstream.chatPath, '/chat/completions');
  assert.equal(manager.upstream.usageUrl, 'https://opencode.ai/zen/go/v1/usage');
});

test('gateway.upstreamPath overrides chatPath', () => {
  const manager = build({
    accounts: [{ name: 'A', token: 'st_a' }],
    gateway: { upstreamPath: '/v1/chat/completions' },
  });
  assert.equal(manager.upstream.chatPath, '/v1/chat/completions');
});

test('quotaFor honours the per-account value and the gateway default', () => {
  const manager = createManager({ gateway: { port: 20130, defaultQuotaPerDay: 42, stateFile: null } });
  const account = manager.accounts.get('A');
  assert.equal(manager.quotaFor(account), 5);

  account.config.quotaPerDay = undefined;
  assert.equal(manager.quotaFor(account), 42);
  manager.cleanup();
});

test('authHeaders sends a bearer token, org id and user agent', () => {
  const manager = createManager();
  const headers = manager.authHeaders({ token: 'st_abc', orgId: 'wrk_1' });
  assert.equal(headers.Authorization, 'Bearer st_abc');
  assert.equal(headers['x-opencode-org-id'], 'wrk_1');
  assert.ok(headers['User-Agent']);
  manager.cleanup();
});

test('authHeaders omits the org header when the credential has no org', () => {
  const manager = createManager();
  const headers = manager.authHeaders({ token: 'st_abc', orgId: null });
  assert.equal('x-opencode-org-id' in headers, false);
  manager.cleanup();
});
