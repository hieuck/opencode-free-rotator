import test from 'node:test';
import assert from 'node:assert/strict';
import { createManager } from './helpers.mjs';

const usageBody = (overrides = {}) => ({
  usage: {
    rolling: { status: 'ok', percent: 0, resetsAt: '2026-11-10T08:00:00.000Z' },
    weekly: { status: 'ok', percent: 6, resetsAt: '2026-11-16T00:00:00.000Z' },
    monthly: { status: 'ok', percent: 12, resetsAt: '2026-11-16T14:00:00.000Z' },
    ...overrides,
  },
});

const fakeFetch = (status, payload) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => payload,
  text: async () => JSON.stringify(payload),
});

test('refreshQuota stores the provider buckets and builds a cooldown when limited', async () => {
  const monthlyReset = Date.now() + 6 * 86400_000;
  const manager = createManager(
    {},
    {
      fetchImpl: fakeFetch(
        200,
        usageBody({
          rolling: { status: 'ok', percent: 0, resetsAt: new Date(Date.now() + 3600_000).toISOString() },
          monthly: { status: 'rate-limited', percent: 100, resetsAt: new Date(monthlyReset).toISOString() },
        }),
      ),
    },
  );

  const account = manager.accounts.get('A');
  const usage = await manager.refreshQuota(account);

  assert.equal(usage.monthly.percent, 100);
  assert.equal(usage.monthly.limited, true);
  assert.equal(usage.weekly.limited, false);
  assert.equal(account.stats.limited, true);
  assert.ok(Math.abs(account.stats.limitedResetsAt - monthlyReset) < 1000, 'reset time comes from the limited bucket');
  assert.ok(account.stats.cooldownUntil >= monthlyReset, 'cooldown must last until the provider window resets');
  assert.ok(account.stats.lastQuotaAt);

  manager.cleanup();
});

test('refreshQuota clears the limited flag when the provider reports healthy buckets', async () => {
  const manager = createManager({}, { fetchImpl: fakeFetch(200, usageBody()) });
  const account = manager.accounts.get('A');
  account.stats.limited = true;
  account.stats.limitedResetsAt = Date.now() + 1000;

  await manager.refreshQuota(account);

  assert.equal(account.stats.limited, false);
  assert.equal(account.stats.limitedResetsAt, null);
  assert.equal(account.stats.usage.weekly.percent, 6);
  manager.cleanup();
});

test('a 403 from the usage endpoint is reported but not fatal', async () => {
  const manager = createManager({}, { fetchImpl: fakeFetch(403, {}) });
  const account = manager.accounts.get('A');

  const usage = await manager.refreshQuota(account);
  assert.equal(usage, null);
  assert.match(account.stats.lastQuotaError, /403/);
  assert.equal(account.stats.limited, null, 'unknown stays unknown');
  assert.equal(account.ready, true, 'the account remains usable');
  manager.cleanup();
});

test('a network error while polling usage is recorded and swallowed', async () => {
  const manager = createManager(
    {},
    {
      fetchImpl: async () => {
        throw new Error('ECONNRESET');
      },
    },
  );
  const account = manager.accounts.get('A');

  const usage = await manager.refreshQuota(account);
  assert.equal(usage, null);
  assert.match(account.stats.lastQuotaError, /ECONNRESET/);
  assert.equal(account.ready, true);
  manager.cleanup();
});

test('an account without an org id cannot be polled', async () => {
  const manager = createManager();
  const account = manager.accounts.get('A');
  account.auth = { ...account.auth, orgId: null };

  const usage = await manager.refreshQuota(account);
  assert.equal(usage, null);
  assert.match(account.stats.lastQuotaError, /orgID/);
  manager.cleanup();
});

test('refreshAllQuotas polls every account', async () => {
  let calls = 0;
  const manager = createManager(
    {},
    {
      fetchImpl: async () => {
        calls++;
        return { ok: true, status: 200, json: async () => usageBody(), text: async () => '{}' };
      },
    },
  );

  await manager.refreshAllQuotas();
  assert.equal(calls, 3);
  for (const account of manager.accounts.values()) assert.ok(account.stats.lastQuotaAt);
  manager.cleanup();
});
