import test from 'node:test';
import assert from 'node:assert/strict';
import { createManager } from './helpers.mjs';

test('selectInstance returns null when nothing is running', () => {
  const manager = createManager();
  manager.instances.clear();
  assert.equal(manager.selectInstance(), null);
  manager.cleanup();
});

test('selectInstance reserves a slot immediately (no double-booking)', () => {
  const manager = createManager();
  // Quota 5 per instance x 3 instances = 15 slots total.
  const picks = [];
  for (let i = 0; i < 20; i++) {
    const instance = manager.selectInstance();
    if (instance) picks.push(instance);
  }

  assert.equal(picks.length, 15, 'only 15 slots may be reserved');

  const perPort = new Map();
  for (const instance of picks) {
    perPort.set(instance.port, (perPort.get(instance.port) || 0) + 1);
  }
  for (const [port, count] of perPort) {
    assert.equal(count, 5, `port ${port} reserved more than its quota`);
    assert.equal(manager.instances.get(port).stats.inFlight, 5);
  }

  assert.equal(manager.selectInstance(), null, 'a 16th reservation must fail');
  manager.cleanup();
});

test('concurrent reservations never exceed quota', async () => {
  const manager = createManager();
  const totalSlots = 15;

  const results = await Promise.all(
    Array.from({ length: 60 }, async () => {
      // Yield first so every task interleaves like real requests would.
      await new Promise((resolve) => setImmediate(resolve));
      const instance = manager.selectInstance();
      if (!instance) return 0;
      await new Promise((resolve) => setImmediate(resolve));
      manager.releaseInstance(instance, { consumed: true });
      return 1;
    }),
  );

  const granted = results.reduce((sum, n) => sum + n, 0);
  assert.equal(granted, totalSlots, `expected ${totalSlots} granted requests, got ${granted}`);

  for (const instance of manager.instances.values()) {
    assert.equal(instance.stats.requestsToday, 5);
    assert.equal(instance.stats.inFlight, 0, 'every reservation must be released');
  }
  manager.cleanup();
});

test('lowest-usage spreads load evenly across instances', () => {
  const manager = createManager();

  for (let i = 0; i < 9; i++) {
    const instance = manager.selectInstance();
    assert.ok(instance);
    manager.releaseInstance(instance, { consumed: true });
  }

  const counts = [...manager.instances.values()].map((i) => i.stats.requestsToday).sort();
  assert.deepEqual(counts, [3, 3, 3]);
  manager.cleanup();
});

test('round-robin rotates through every available instance', () => {
  const manager = createManager({
    gateway: { port: 20130, selectionStrategy: 'round-robin' },
  });

  const order = [];
  for (let i = 0; i < 6; i++) {
    const instance = manager.selectInstance();
    order.push(instance.port);
    manager.releaseInstance(instance);
  }

  assert.deepEqual(order.slice(0, 3).sort(), [3001, 3002, 3003]);
  assert.deepEqual(order.slice(3, 6).sort(), [3001, 3002, 3003]);
  manager.cleanup();
});

test('instances reported limited by the usage API are skipped', () => {
  const manager = createManager();
  manager.instances.get(3001).stats.limited = true;

  for (let i = 0; i < 10; i++) {
    const instance = manager.selectInstance();
    if (!instance) break;
    assert.notEqual(instance.port, 3001, 'limited instance must never be selected');
    manager.releaseInstance(instance, { consumed: true });
  }

  assert.equal(manager.instances.get(3001).stats.requestsToday, 0);
  manager.cleanup();
});

test('instances inside a 429 cooldown are skipped until it expires', () => {
  const manager = createManager();
  manager.instances.get(3001).stats.cooldownUntil = Date.now() + 60_000;

  const picked = manager.selectInstance();
  assert.notEqual(picked.port, 3001);
  manager.releaseInstance(picked);

  manager.instances.get(3001).stats.cooldownUntil = Date.now() - 1;
  const ports = new Set();
  for (let i = 0; i < 15; i++) {
    const instance = manager.selectInstance();
    if (!instance) break;
    ports.add(instance.port);
    manager.releaseInstance(instance);
  }
  assert.ok(ports.has(3001), 'instance should return to the pool after cooldown');
  manager.cleanup();
});

test('not-ready instances are skipped', () => {
  const manager = createManager();
  for (const instance of manager.instances.values()) instance.ready = false;
  assert.equal(manager.selectInstance(), null);
  manager.cleanup();
});

test('excludePorts prevents retrying the same instance', () => {
  const manager = createManager();
  const exclude = new Set([3001, 3002]);
  const instance = manager.selectInstance(exclude);
  assert.equal(instance.port, 3003);
  manager.releaseInstance(instance);
  manager.cleanup();
});

test('releaseInstance decrements inFlight and clamps at zero', () => {
  const manager = createManager();
  const instance = manager.instances.get(3001);

  manager.releaseInstance(instance, { consumed: true });
  assert.equal(instance.stats.inFlight, 0);
  assert.equal(instance.stats.requestsToday, 1);

  const reserved = manager.selectInstance(new Set([3002, 3003]));
  assert.equal(reserved.stats.inFlight, 1);
  manager.releaseInstance(reserved);
  assert.equal(reserved.stats.inFlight, 0);
  assert.equal(reserved.stats.requestsToday, 1);
  manager.cleanup();
});

test('releaseInstance records failures and cooldowns', () => {
  const manager = createManager();
  const instance = manager.instances.get(3001);

  manager.releaseInstance(instance, { error: 'boom', cooldownMs: 5000 });
  assert.equal(instance.stats.failures, 1);
  assert.equal(instance.stats.lastError, 'boom');
  assert.ok(instance.stats.cooldownUntil > Date.now());
  manager.cleanup();
});
