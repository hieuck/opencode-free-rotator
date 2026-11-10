import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { TokenManager, TokenError, maskToken, consoleBase } from '../src/TokenManager.mjs';

const quiet = { log() {}, warn() {}, error() {} };

function makeDb(value, { integrationId = 'opencode', active = 1 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotator-db-'));
  const dbPath = path.join(dir, 'opencode.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE credential (
      id TEXT PRIMARY KEY,
      integration_id TEXT,
      label TEXT,
      active INTEGER,
      value TEXT,
      time_created INTEGER,
      time_updated INTEGER
    );
  `);
  db.prepare(
    'INSERT INTO credential (id, integration_id, label, active, value, time_created, time_updated) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run('cred_1', integrationId, 'user@example.test', active, JSON.stringify(value), Date.now(), Date.now());
  db.close();
  return { dbPath, dir, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const oauthValue = (overrides = {}) => ({
  type: 'oauth',
  methodID: 'device',
  refresh: 'rt_live',
  access: 'st_live',
  expires: Date.now() + 3600_000,
  metadata: {
    server: 'https://opencode.ai/console',
    accountID: 'acc_1',
    email: 'user@example.test',
    orgID: 'wrk_1',
    orgName: 'Example',
  },
  ...overrides,
});

const fakeResponse = (status, payload) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
});

test('reads an OAuth credential, including email and org id', async () => {
  const fixture = makeDb(oauthValue());
  const manager = new TokenManager([{ name: 'A', db: fixture.dbPath }], { logger: quiet });

  const token = await manager.getToken({ name: 'A', db: fixture.dbPath });
  assert.equal(token.token, 'st_live');
  assert.equal(token.type, 'oauth');
  assert.equal(token.email, 'user@example.test');
  assert.equal(token.orgId, 'wrk_1');
  assert.equal(token.refresh, 'rt_live');

  const described = manager.describe({ name: 'A' });
  assert.equal(described.orgName, 'Example');
  assert.equal(described.refreshable, true);
  assert.match(described.tokenPreview, /^st_liv…/);

  manager.close();
  fixture.cleanup();
});

test('reads a key-type credential', async () => {
  const fixture = makeDb({ type: 'key', key: 'sk-key-123' });
  const manager = new TokenManager([], { logger: quiet });

  const token = await manager.getToken({ name: 'A', db: fixture.dbPath });
  assert.equal(token.type, 'key');
  assert.equal(token.token, 'sk-key-123');
  assert.equal(token.expiresAt, null);

  manager.close();
  fixture.cleanup();
});

test('caches the credential row and re-reads after the TTL', async () => {
  const fixture = makeDb(oauthValue());
  const manager = new TokenManager([], { logger: quiet, cacheTtlMs: 60_000 });
  const account = { name: 'A', db: fixture.dbPath };

  assert.equal((await manager.getToken(account)).token, 'st_live');

  // Simulate `opencode` refreshing the row behind our back.
  const db = new Database(fixture.dbPath);
  db.prepare('UPDATE credential SET value = ? WHERE id = ?').run(
    JSON.stringify(oauthValue({ access: 'st_rotated_by_app' })),
    'cred_1',
  );
  db.close();

  assert.equal((await manager.getToken(account)).token, 'st_live', 'cached value must be used inside the TTL');

  manager.options.cacheTtlMs = 0;
  assert.equal((await manager.getToken(account)).token, 'st_rotated_by_app', 'TTL expiry must pick up the new token');

  manager.close();
  fixture.cleanup();
});

test('invalidate() forces a re-read', async () => {
  const fixture = makeDb(oauthValue());
  const manager = new TokenManager([], { logger: quiet, cacheTtlMs: 60_000 });
  const account = { name: 'A', db: fixture.dbPath };

  await manager.getToken(account);

  const db = new Database(fixture.dbPath);
  db.prepare('UPDATE credential SET value = ? WHERE id = ?').run(JSON.stringify(oauthValue({ access: 'st_new' })), 'cred_1');
  db.close();

  manager.invalidate(account);
  assert.equal((await manager.getToken(account)).token, 'st_new');

  manager.close();
  fixture.cleanup();
});

test('a missing database raises db_unavailable', async () => {
  const manager = new TokenManager([], { logger: quiet });
  await assert.rejects(
    () => manager.getToken({ name: 'A', db: path.join(os.tmpdir(), 'does-not-exist-opencode.db') }),
    (error) => error instanceof TokenError && error.code === 'db_unavailable',
  );
  manager.close();
});

test('a database without an opencode credential raises missing_credential', async () => {
  const fixture = makeDb(oauthValue(), { integrationId: 'something-else' });
  const manager = new TokenManager([], { logger: quiet });
  await assert.rejects(
    () => manager.getToken({ name: 'A', db: fixture.dbPath }),
    (error) => error instanceof TokenError && error.code === 'missing_credential',
  );
  manager.close();
  fixture.cleanup();
});

test('malformed credential JSON raises malformed_credential', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotator-db-'));
  const dbPath = path.join(dir, 'opencode.db');
  const db = new Database(dbPath);
  db.exec('CREATE TABLE credential (id TEXT PRIMARY KEY, integration_id TEXT, label TEXT, active INTEGER, value TEXT, time_updated INTEGER)');
  db.prepare('INSERT INTO credential VALUES (?, ?, ?, ?, ?, ?)').run('c1', 'opencode', 'x', 1, '{not json', Date.now());
  db.close();

  const manager = new TokenManager([], { logger: quiet });
  await assert.rejects(
    () => manager.getToken({ name: 'A', db: dbPath }),
    (error) => error instanceof TokenError && error.code === 'malformed_credential',
  );
  manager.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an expired token is refreshed and the rotated pair is written back', async () => {
  const fixture = makeDb(oauthValue({ expires: Date.now() - 1000 }));
  const calls = [];
  const manager = new TokenManager([], {
    logger: quiet,
    writeBack: true,
    refreshSkewMs: 60_000,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return fakeResponse(200, { access_token: 'st_fresh', refresh_token: 'rt_fresh', expires_in: 3600, org_id: 'wrk_2' });
    },
  });

  const token = await manager.getToken({ name: 'A', db: fixture.dbPath });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://opencode.ai/console/auth/device/token');
  assert.deepEqual(calls[0].body, { grant_type: 'refresh_token', refresh_token: 'rt_live', client_id: 'opencode-cli' });

  assert.equal(token.token, 'st_fresh');
  assert.equal(token.refresh, 'rt_fresh');
  assert.equal(token.orgId, 'wrk_2');
  assert.ok(token.expiresAt > Date.now() + 3_000_000);

  // The DB row must hold the rotated pair so the desktop app stays logged in.
  const db = new Database(fixture.dbPath, { readonly: true });
  const stored = JSON.parse(db.prepare('SELECT value FROM credential WHERE id = ?').get('cred_1').value);
  db.close();
  assert.equal(stored.access, 'st_fresh');
  assert.equal(stored.refresh, 'rt_fresh');
  assert.equal(stored.metadata.email, 'user@example.test', 'metadata must survive the write-back');
  assert.equal(stored.metadata.orgID, 'wrk_2');

  manager.close();
  fixture.cleanup();
});

test('writeBack: false leaves the database untouched', async () => {
  const fixture = makeDb(oauthValue({ expires: Date.now() - 1000 }));
  const manager = new TokenManager([], {
    logger: quiet,
    writeBack: false,
    fetchImpl: async () => fakeResponse(200, { access_token: 'st_fresh', refresh_token: 'rt_fresh', expires_in: 3600 }),
  });

  const token = await manager.getToken({ name: 'A', db: fixture.dbPath });
  assert.equal(token.token, 'st_fresh');

  const db = new Database(fixture.dbPath, { readonly: true });
  const stored = JSON.parse(db.prepare('SELECT value FROM credential WHERE id = ?').get('cred_1').value);
  db.close();
  assert.equal(stored.access, 'st_live');

  manager.close();
  fixture.cleanup();
});

test('a rejected refresh raises reauth_required with actionable text', async () => {
  const fixture = makeDb(oauthValue({ expires: Date.now() - 1000 }));
  const manager = new TokenManager([], {
    logger: quiet,
    fetchImpl: async () =>
      fakeResponse(400, { _tag: 'DeviceTokenError', error: 'invalid_grant', error_description: 'The grant is invalid' }),
  });

  await assert.rejects(
    () => manager.getToken({ name: 'A', db: fixture.dbPath }),
    (error) => {
      assert.ok(error instanceof TokenError);
      assert.equal(error.code, 'reauth_required');
      assert.match(error.message, /The grant is invalid/);
      assert.match(error.message, /auth login/);
      return true;
    },
  );

  manager.close();
  fixture.cleanup();
});

test('an expired credential without a refresh token cannot be used', async () => {
  const fixture = makeDb(oauthValue({ expires: Date.now() - 1000, refresh: undefined }));
  const manager = new TokenManager([], { logger: quiet });

  await assert.rejects(
    () => manager.getToken({ name: 'A', db: fixture.dbPath }),
    (error) => error instanceof TokenError && error.code === 'expired_no_refresh',
  );

  manager.close();
  fixture.cleanup();
});

test('concurrent refreshes are de-duplicated into one HTTP call', async () => {
  const fixture = makeDb(oauthValue({ expires: Date.now() - 1000 }));
  let calls = 0;
  const manager = new TokenManager([], {
    logger: quiet,
    fetchImpl: async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return fakeResponse(200, { access_token: 'st_once', refresh_token: 'rt_once', expires_in: 3600 });
    },
  });

  const account = { name: 'A', db: fixture.dbPath };
  const [a, b, c] = await Promise.all([manager.getToken(account), manager.getToken(account), manager.getToken(account)]);
  assert.equal(calls, 1, 'three concurrent callers must share one refresh');
  assert.equal(a.token, 'st_once');
  assert.equal(b.token, 'st_once');
  assert.equal(c.token, 'st_once');

  manager.close();
  fixture.cleanup();
});

test('a static token account never touches SQLite', async () => {
  const manager = new TokenManager([], { logger: quiet });
  const token = await manager.getToken({ name: 'CI', token: 'st_static', orgId: 'wrk_ci', email: 'ci@example.test' });
  assert.equal(token.token, 'st_static');
  assert.equal(token.orgId, 'wrk_ci');
  assert.equal(token.type, 'key');
  assert.equal(token.dbPath, null);
  manager.close();
});

test('maskToken never reveals the whole token', () => {
  assert.equal(maskToken('st_3dc589c2-645b-43f1-bdcb-771021349273'), 'st_3dc…9273');
  assert.equal(maskToken('abc'), 'abc…');
  assert.equal(maskToken(null), null);
});

test('consoleBase normalises the legacy console host', () => {
  assert.equal(consoleBase({ server: 'https://console.opencode.ai' }), 'https://opencode.ai/console');
  assert.equal(consoleBase({ server: 'https://opencode.ai/console/' }), 'https://opencode.ai/console');
  assert.equal(consoleBase({}), 'https://opencode.ai/console');
});
