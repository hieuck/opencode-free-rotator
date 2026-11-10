import test from 'node:test';
import assert from 'node:assert/strict';
import { createManager } from './helpers.mjs';

test('selectAccount returns null when no account is ready', () => {
  const manager = createManager();
  for (const account of manager.accounts.values()) account.ready = false;
  assert.equal(manager.selectAccount(), null);
  manager.cleanup();
});

test('selectAccount reserves a slot immediately (no double-booking)', () => {
  const manager = createManager();
  // Quota 5 per account x 3 accounts = 15 slots total.
  const picks = [];
  for (let i = 0; i < 20; i++) {
    const account = manager.selectAccount();
    if (account) picks.push(account);
  }

  assert.equal(picks.length, 15, 'only 15 slots may be reserved');

  const perAccount = new Map();
  for (const account of picks) {
    perAccount.set(account.name, (perAccount.get(account.name) || 0) + 1);
  }
  for (const [name, count] of perAccount) {
    assert.equal(count, 5, `account ${name} reserved more than its quota`);
    assert.equal(manager.accounts.get(name).stats.inFlight, 5);
  }

  assert.equal(manager.selectAccount(), null, 'a 16th reservation must fail');
  manager.cleanup();
});

test('concurrent reservations never exceed quota', async () => {
  const manager = createManager();
  const totalSlots = 15;

  const results = await Promise.all(
    Array.from({ length: 60 }, async () => {
      // Yield first so every task interleaves like real requests would.
      await new Promise((resolve) => setImmediate(resolve));
      const account = manager.selectAccount();
      if (!account) return 0;
      await new Promise((resolve) => setImmediate(resolve));
      manager.releaseAccount(account, { consumed: true });
      return 1;
    }),
  );

  const granted = results.reduce((sum, n) => sum + n, 0);
  assert.equal(granted, totalSlots, `expected ${totalSlots} granted requests, got ${granted}`);

  for (const account of manager.accounts.values()) {
    assert.equal(account.stats.requestsToday, 5);
    assert.equal(account.stats.inFlight, 0, 'every reservation must be released');
  }
  manager.cleanup();
});

test('lowest-usage spreads load evenly across accounts', () => {
  const manager = createManager();

  for (let i = 0; i < 9; i++) {
    const account = manager.selectAccount();
    assert.ok(account);
    manager.releaseAccount(account, { consumed: true });
  }

  const counts = [...manager.accounts.values()].map((a) => a.stats.requestsToday).sort();
  assert.deepEqual(counts, [3, 3, 3]);
  manager.cleanup();
});

test('round-robin rotates through every available account', () => {
  const manager = createManager({
    gateway: { port: 20130, selectionStrategy: 'round-robin', stateFile: null },
  });

  const order = [];
  for (let i = 0; i < 6; i++) {
    const account = manager.selectAccount();
    order.push(account.name);
    manager.releaseAccount(account);
  }

  assert.deepEqual(order.slice(0, 3).sort(), ['A', 'B', 'C']);
  assert.deepEqual(order.slice(3, 6).sort(), ['A', 'B', 'C']);
  manager.cleanup();
});

test('accounts the provider reports as limited are skipped', () => {
  const manager = createManager();
  manager.accounts.get('A').stats.limited = true;
  manager.accounts.get('A').stats.limitedResetsAt = Date.now() + 60_000;

  for (let i = 0; i < 10; i++) {
    const account = manager.selectAccount();
    if (!account) break;
    assert.notEqual(account.name, 'A', 'limited account must never be selected');
    manager.releaseAccount(account, { consumed: true });
  }

  assert.equal(manager.accounts.get('A').stats.requestsToday, 0);
  manager.cleanup();
});

test('a limited account returns to the pool once its reset time passes', () => {
  const manager = createManager();
  const account = manager.accounts.get('A');
  account.stats.limited = true;
  account.stats.limitedResetsAt = Date.now() - 1;

  const picked = manager.selectAccount(new Set(['B', 'C']));
  assert.equal(picked.name, 'A');
  assert.equal(account.stats.limited, null, 'expired limit must be cleared');
  manager.releaseAccount(picked);
  manager.cleanup();
});

test('accounts with insufficient funds are skipped permanently', () => {
  const manager = createManager();
  manager.accounts.get('A').stats.fundsExhausted = true;

  const picked = manager.selectAccount();
  assert.notEqual(picked.name, 'A');
  manager.releaseAccount(picked);
  manager.cleanup();
});

test('accounts inside a 429 cooldown are skipped until it expires', () => {
  const manager = createManager();
  manager.accounts.get('A').stats.cooldownUntil = Date.now() + 60_000;

  const picked = manager.selectAccount();
  assert.notEqual(picked.name, 'A');
  manager.releaseAccount(picked);

  manager.accounts.get('A').stats.cooldownUntil = Date.now() - 1;
  const names = new Set();
  for (let i = 0; i < 15; i++) {
    const account = manager.selectAccount();
    if (!account) break;
    names.add(account.name);
    manager.releaseAccount(account);
  }
  assert.ok(names.has('A'), 'account should return to the pool after cooldown');
  manager.cleanup();
});

test('disabled accounts are never selected', () => {
  const manager = createManager();
  manager.accounts.get('A').enabled = false;
  for (let i = 0; i < 15; i++) {
    const account = manager.selectAccount();
    if (!account) break;
    assert.notEqual(account.name, 'A');
    manager.releaseAccount(account);
  }
  manager.cleanup();
});

test('excludeNames prevents retrying the same account', () => {
  const manager = createManager();
  const account = manager.selectAccount(new Set(['A', 'B']));
  assert.equal(account.name, 'C');
  manager.releaseAccount(account);
  manager.cleanup();
});

test('releaseAccount decrements inFlight and counts consumed requests', () => {
  const manager = createManager();
  const account = manager.accounts.get('A');

  manager.releaseAccount(account, { consumed: true });
  assert.equal(account.stats.inFlight, 0);
  assert.equal(account.stats.requestsToday, 1);

  const reserved = manager.selectAccount(new Set(['B', 'C']));
  assert.equal(reserved.stats.inFlight, 1);
  manager.releaseAccount(reserved);
  assert.equal(reserved.stats.inFlight, 0);
  assert.equal(reserved.stats.requestsToday, 1);
  manager.cleanup();
});

test('releaseAccount records failures and cooldowns', () => {
  const manager = createManager();
  const account = manager.accounts.get('A');

  manager.releaseAccount(account, { error: 'boom', errorCode: 'upstream_error', cooldownMs: 5000 });
  assert.equal(account.stats.failures, 1);
  assert.equal(account.stats.lastError, 'boom');
  assert.equal(account.stats.lastErrorCode, 'upstream_error');
  assert.ok(account.stats.cooldownUntil > Date.now());
  manager.cleanup();
});

test('getStatus reports available accounts and remaining quota', () => {
  const manager = createManager();
  const first = manager.selectAccount();
  manager.releaseAccount(first, { consumed: true });

  const status = manager.getStatus();
  assert.equal(status.totalAccounts, 3);
  assert.equal(status.ready, 3);
  assert.equal(status.available, 3);
  const entry = status.accounts.find((a) => a.name === first.name);
  assert.equal(entry.used, 1);
  assert.equal(entry.remaining, 4);
  manager.cleanup();
});
