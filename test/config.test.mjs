import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { InstanceManager } from '../src/InstanceManager.mjs';
import { createManager } from './helpers.mjs';

test('config validation rejects duplicate ports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotator-cfg-'));
  const configPath = path.join(dir, 'config.yaml');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      instances: [
        { name: 'A', port: 3001, db: '/tmp/a.db' },
        { name: 'B', port: 3001, db: '/tmp/b.db' },
      ],
      gateway: { port: 20130 },
    }),
  );

  assert.throws(() => new InstanceManager(configPath), /Duplicate port 3001/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config validation rejects a missing instances list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotator-cfg-'));
  const configPath = path.join(dir, 'config.yaml');
  fs.writeFileSync(configPath, JSON.stringify({ gateway: { port: 20130 } }));

  assert.throws(() => new InstanceManager(configPath), /instances/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('config validation rejects invalid ports', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotator-cfg-'));
  const configPath = path.join(dir, 'config.yaml');
  fs.writeFileSync(
    configPath,
    JSON.stringify({ instances: [{ name: 'A', port: 'three-thousand', db: '/tmp/a.db' }], gateway: {} }),
  );

  assert.throws(() => new InstanceManager(configPath), /invalid port/i);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('health path defaults to /api/info, not the HTML /health route', () => {
  const manager = createManager();
  assert.equal(manager.opencode.healthPath, '/api/info');
  manager.cleanup();
});

test('quotaFor honours the per-instance value and the gateway default', () => {
  const manager = createManager({ gateway: { port: 20130, defaultQuotaPerDay: 42 } });
  const instance = manager.instances.get(3001);
  assert.equal(manager.quotaFor(instance), 5);

  manager.config.instances[0].quotaPerDay = undefined;
  assert.equal(manager.quotaFor(manager.instances.get(3001)), 42);
  manager.cleanup();
});

test('authHeader produces HTTP Basic credentials for opencode serve', () => {
  const manager = createManager();
  const header = manager.authHeader(manager.instances.get(3001));
  assert.equal(header.Authorization, 'Basic ' + Buffer.from('opencode:secret').toString('base64'));
  manager.cleanup();
});
