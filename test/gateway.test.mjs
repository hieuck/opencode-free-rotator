import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { Gateway } from '../src/Gateway.mjs';
import { createManager } from './helpers.mjs';

/** Start a throwaway HTTP upstream and return its port. */
async function startUpstream(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Build a Gateway whose manager points at the given fake upstream ports. */
function makeGateway(ports, gatewayOverrides = {}) {
  const manager = createManager(
    {
      instances: ports.map((port, index) => ({
        name: `Fake${index + 1}`,
        port,
        db: `/tmp/fake${index + 1}.db`,
        quotaPerDay: 5,
        enabled: true,
      })),
      gateway: {
        port: 20130,
        host: '127.0.0.1',
        selectionStrategy: 'lowest-usage',
        retryOnFailure: true,
        maxRetries: 3,
        requestTimeout: 3000,
        upstreamPath: '/v1/chat/completions',
        cooldownOn429Ms: 100,
        ...gatewayOverrides,
      },
    },
  );

  const gateway = new Gateway(manager.configPath);
  gateway.manager = manager;
  return { gateway, manager };
}

test('successful forward releases its reservation and counts the request', async () => {
  const upstream = await startUpstream((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'chatcmpl-1', choices: [] }));
    });
  });

  const { gateway, manager } = makeGateway([upstream.port]);
  const result = await gateway.forwardRequest({ model: 'm', messages: [] });

  assert.equal(result.success, true);
  const instance = manager.instances.get(upstream.port);
  assert.equal(instance.stats.inFlight, 0, 'inFlight must be released on success');
  assert.equal(instance.stats.requestsToday, 1);

  await result.upstream.body?.cancel?.();
  await upstream.close();
  manager.cleanup();
});

test('upstream 500 releases its reservation without consuming quota', async () => {
  const upstream = await startUpstream((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'boom' }));
  });

  const { gateway, manager } = makeGateway([upstream.port]);
  const result = await gateway.forwardRequest({ messages: [] });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 500);
  const instance = manager.instances.get(upstream.port);
  assert.equal(instance.stats.inFlight, 0, 'inFlight must be released on failure');
  assert.equal(instance.stats.requestsToday, 0);

  await upstream.close();
  manager.cleanup();
});

test('429 falls through to the next instance and applies a cooldown', async () => {
  const limited = await startUpstream((req, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        _tag: 'ProviderRequestError',
        reason: 'rate_limit',
        message: 'Free usage limit reached.',
        retryAfterMs: 75000,
      }),
    );
  });

  const healthy = await startUpstream((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });

  const { gateway, manager } = makeGateway([limited.port, healthy.port]);
  const result = await gateway.forwardRequest({ messages: [] });

  assert.equal(result.success, true, 'second instance should serve the request');
  assert.equal(result.instance.port, healthy.port);

  const limitedInstance = manager.instances.get(limited.port);
  assert.equal(limitedInstance.stats.inFlight, 0);
  assert.ok(limitedInstance.stats.cooldownUntil > Date.now() + 60000, 'retryAfterMs should drive the cooldown');

  await result.upstream.body?.cancel?.();
  await limited.close();
  await healthy.close();
  manager.cleanup();
});

test('unreachable upstream returns 503 and releases the reservation', async () => {
  const upstream = await startUpstream(() => {});
  const deadPort = upstream.port;
  await upstream.close();

  const { gateway, manager } = makeGateway([deadPort], { maxRetries: 2, retryOnFailure: true });
  const result = await gateway.forwardRequest({ messages: [] });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 503);
  const instance = manager.instances.get(deadPort);
  assert.equal(instance.stats.inFlight, 0, 'inFlight must be released when the instance is unreachable');
  // The dead instance is excluded after the first attempt, so it is tried once, not twice.
  assert.equal(instance.stats.failures, 1);

  manager.cleanup();
});

test('gateway never exceeds total quota across concurrent requests', async () => {
  const upstreamA = await startUpstream((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, 10);
  });
  const upstreamB = await startUpstream((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    }, 10);
  });

  const { gateway, manager } = makeGateway([upstreamA.port, upstreamB.port], { maxRetries: 1 });
  // 2 instances x quota 5 = 10 slots.
  const results = await Promise.all(Array.from({ length: 25 }, () => gateway.forwardRequest({ messages: [] })));

  const ok = results.filter((r) => r.success);
  assert.equal(ok.length, 10, 'exactly 10 requests should succeed');

  for (const result of ok) await result.upstream.body?.cancel?.();
  for (const instance of manager.instances.values()) {
    assert.equal(instance.stats.inFlight, 0);
    assert.equal(instance.stats.requestsToday, 5);
  }

  await upstreamA.close();
  await upstreamB.close();
  manager.cleanup();
});

test('handleRequest rejects invalid JSON with 400', async () => {
  const upstream = await startUpstream((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });

  const { gateway, manager } = makeGateway([upstream.port]);
  const server = http.createServer((req, res) => gateway.handleRequest(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });

  assert.equal(response.status, 400);
  await response.text();

  await new Promise((resolve) => server.close(resolve));
  await upstream.close();
  manager.cleanup();
});

test('handleRequest streams upstream JSON through the gateway', async () => {
  const upstream = await startUpstream((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'chatcmpl-42', choices: [{ message: { content: 'hi' } }] }));
  });

  const { gateway, manager } = makeGateway([upstream.port]);
  const server = http.createServer((req, res) => gateway.handleRequest(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }] }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/json');
  const payload = await response.json();
  assert.equal(payload.id, 'chatcmpl-42');

  await new Promise((resolve) => server.close(resolve));
  await upstream.close();
  manager.cleanup();
});

test('/health reports degraded when no instance is ready', async () => {
  const upstream = await startUpstream((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });

  const { gateway, manager } = makeGateway([upstream.port]);
  for (const instance of manager.instances.values()) instance.ready = false;

  const server = http.createServer((req, res) => gateway.handleRequest(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const response = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, 'degraded');

  await new Promise((resolve) => server.close(resolve));
  await upstream.close();
  manager.cleanup();
});
