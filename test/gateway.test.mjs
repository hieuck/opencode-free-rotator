import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createManager, makeGateway } from './helpers.mjs';

/** Start a throwaway HTTP upstream and return its origin. */
async function startUpstream(handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  return {
    port,
    origin: `http://127.0.0.1:${port}`,
    requests: [],
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Read a request body and collect headers so tests can assert on them. */
function readRequest(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve({ body, headers: req.headers }));
  });
}

function readJson(req) {
  return readRequest(req).then(({ body, headers }) => ({ headers, json: body ? JSON.parse(body) : null }));
}

async function withGateway(t, { upstreamHandler, accounts = ['A'], gateway = {}, upstream = {} } = {}) {
  const up = await startUpstream(upstreamHandler);
  const manager = createManager(
    {
      upstream: { baseUrl: up.origin, chatPath: '/v1/chat/completions', modelsPath: '/models', usageUrl: `${up.origin}/usage`, ...upstream },
      accounts: accounts.map((name) => ({
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
        requestTimeout: 3000,
        cooldownOn429Ms: 100,
        stateFile: null,
        ...gateway,
      },
    },
    { fetchImpl: fetch },
  );

  const gatewayInstance = await makeGateway(manager);
  t.after(async () => {
    await up.close();
    manager.cleanup();
  });
  return { gateway: gatewayInstance, manager, upstream: up };
}

async function serve(gateway) {
  const server = http.createServer((req, res) => gateway.handleRequest(req, res));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('successful forward uses a bearer token, org header and counts the request', async (t) => {
  let seen;
  const { gateway, manager } = await withGateway(t, {
    upstreamHandler: async (req, res) => {
      seen = await readRequest(req);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'chatcmpl-1', choices: [] }));
    },
  });

  const result = await gateway.forwardRequest({ model: 'm', messages: [] });

  assert.equal(result.success, true);
  assert.equal(seen.headers.authorization, 'Bearer st_a');
  assert.equal(seen.headers['x-opencode-org-id'], 'wrk_a');
  assert.ok(seen.headers['user-agent'], 'a User-Agent must be sent');
  assert.equal(seen.headers['content-type'], 'application/json');

  const account = manager.accounts.get('A');
  assert.equal(account.stats.inFlight, 0, 'inFlight must be released on success');
  assert.equal(account.stats.requestsToday, 1);

  await result.upstream.body?.cancel?.();
});

test('upstream 500 fails over and never consumes quota', async (t) => {
  const { gateway, manager } = await withGateway(t, {
    upstreamHandler: (req, res) => {
      req.resume();
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'boom' }));
    },
  });

  const result = await gateway.forwardRequest({ messages: [] });

  assert.equal(result.success, false);
  assert.equal(result.statusCode, 500);
  const account = manager.accounts.get('A');
  assert.equal(account.stats.inFlight, 0, 'inFlight must be released on failure');
  assert.equal(account.stats.requestsToday, 0);
  assert.equal(account.stats.failures, 1);
});

test('FreeUsageLimitError (429) falls through to the next account and marks it limited', async (t) => {
  const { gateway, manager } = await withGateway(t, {
    accounts: ['A', 'B'],
    upstreamHandler: async (req, res) => {
      const { headers } = await readRequest(req);
      if (headers.authorization === 'Bearer st_a') {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            type: 'error',
            error: { type: 'FreeUsageLimitError', message: 'Free usage limit reached.' },
          }),
        );
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    },
  });

  const result = await gateway.forwardRequest({ messages: [] });

  assert.equal(result.success, true, 'second account should serve the request');
  assert.equal(result.account.name, 'B');

  const limited = manager.accounts.get('A');
  assert.equal(limited.stats.inFlight, 0);
  assert.equal(limited.stats.limited, true);
  assert.equal(limited.stats.requestsToday, 0);
  assert.ok(limited.stats.cooldownUntil > Date.now(), 'a cooldown must be applied');

  await result.upstream.body?.cancel?.();
});

test('429 with Retry-After drives the cooldown', async (t) => {
  const { gateway, manager } = await withGateway(t, {
    accounts: ['A', 'B'],
    upstreamHandler: async (req, res) => {
      const { headers } = await readRequest(req);
      if (headers.authorization === 'Bearer st_a') {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '75' });
        res.end(JSON.stringify({ error: 'slow down' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    },
  });

  const result = await gateway.forwardRequest({ messages: [] });
  assert.equal(result.success, true);
  assert.ok(manager.accounts.get('A').stats.cooldownUntil > Date.now() + 60_000);
  await result.upstream.body?.cancel?.();
});

test('402 marks the account as out of funds and fails over', async (t) => {
  const { gateway, manager } = await withGateway(t, {
    accounts: ['A', 'B'],
    upstreamHandler: async (req, res) => {
      const { headers } = await readRequest(req);
      if (headers.authorization === 'Bearer st_a') {
        res.writeHead(402, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Insufficient account funds' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    },
  });

  const result = await gateway.forwardRequest({ messages: [] });
  assert.equal(result.success, true);
  assert.equal(result.account.name, 'B');
  assert.equal(manager.accounts.get('A').stats.fundsExhausted, true);
  assert.equal(manager.selectAccount(new Set(['B'])), null, 'fundless account must be skipped');
  await result.upstream.body?.cancel?.();
});

test('401 invalidates the token and retries once with a fresh one', async (t) => {
  let calls = 0;
  const { gateway, manager } = await withGateway(t, {
    upstreamHandler: async (req, res) => {
      calls++;
      await readRequest(req);
      if (calls === 1) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'token expired' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    },
  });

  const invalidated = [];
  const originalInvalidate = manager.tokenManager.invalidate.bind(manager.tokenManager);
  manager.tokenManager.invalidate = (account) => {
    invalidated.push(account.name);
    originalInvalidate(account);
  };

  const result = await gateway.forwardRequest({ messages: [] });
  assert.equal(result.success, true);
  assert.equal(calls, 2, 'the request must be retried exactly once');
  assert.deepEqual(invalidated, ['A']);
  assert.equal(manager.accounts.get('A').stats.requestsToday, 1);
  await result.upstream.body?.cancel?.();
});

test('persistent 401 disables the account instead of looping', async (t) => {
  const { gateway, manager } = await withGateway(t, {
    upstreamHandler: async (req, res) => {
      await readRequest(req);
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'token expired' }));
    },
  });

  const result = await gateway.forwardRequest({ messages: [] });
  assert.equal(result.success, false);
  assert.equal(result.code, 'auth_required');
  const account = manager.accounts.get('A');
  assert.equal(account.ready, false);
  assert.match(account.error, /auth login/i);
});

test('unreachable upstream returns 502 and releases the reservation', async (t) => {
  const dead = await startUpstream(() => {});
  await dead.close();

  const { gateway, manager } = await withGateway(t, {
    upstreamHandler: () => {},
    upstream: { baseUrl: dead.origin },
    gateway: { maxRetries: 2 },
  });

  const result = await gateway.forwardRequest({ messages: [] });
  assert.equal(result.success, false);
  assert.equal(result.statusCode, 502);
  const account = manager.accounts.get('A');
  assert.equal(account.stats.inFlight, 0);
  assert.equal(account.stats.failures, 1);
  assert.equal(account.stats.requestsToday, 0);
});

test('gateway never exceeds total quota across concurrent requests', async (t) => {
  const { gateway, manager } = await withGateway(t, {
    accounts: ['A', 'B'],
    gateway: { maxRetries: 1 },
    upstreamHandler: (req, res) => {
      req.resume();
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      }, 10);
    },
  });

  // 2 accounts x quota 5 = 10 slots.
  const results = await Promise.all(Array.from({ length: 25 }, () => gateway.forwardRequest({ messages: [] })));
  const ok = results.filter((r) => r.success);
  assert.equal(ok.length, 10, 'exactly 10 requests should succeed');

  for (const result of ok) await result.upstream.body?.cancel?.();
  for (const account of manager.accounts.values()) {
    assert.equal(account.stats.inFlight, 0);
    assert.equal(account.stats.requestsToday, 5);
  }
});

test('all accounts exhausted yields 429 quota_exhausted', async (t) => {
  const { gateway, manager } = await withGateway(t, {
    accounts: ['A'],
    upstreamHandler: (req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    },
  });

  manager.accounts.get('A').stats.limited = true;
  manager.accounts.get('A').stats.limitedResetsAt = Date.now() + 600_000;
  manager.accounts.get('A').stats.cooldownUntil = Date.now() + 600_000;

  const result = await gateway.forwardRequest({ messages: [] });
  assert.equal(result.success, false);
  assert.equal(result.code, 'quota_exhausted');
  assert.equal(result.statusCode, 429);
  assert.match(result.error, /out of free quota/i);
});

test('handleRequest rejects invalid JSON with 400', async (t) => {
  const { gateway } = await withGateway(t, {
    upstreamHandler: (req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    },
  });
  const server = await serve(gateway);
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{not json',
  });

  assert.equal(response.status, 400);
  await response.text();
});

test('handleRequest streams an SSE body straight through', async (t) => {
  const { gateway } = await withGateway(t, {
    upstreamHandler: (req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
      res.end('data: [DONE]\n\n');
    },
  });
  const server = await serve(gateway);
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: true }),
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  const text = await response.text();
  assert.match(text, /data: \{"choices"/);
  assert.match(text, /\[DONE\]/);
});

test('/health reports degraded when no account is usable', async (t) => {
  const { gateway, manager } = await withGateway(t, {
    upstreamHandler: (req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    },
  });
  for (const account of manager.accounts.values()) account.ready = false;

  const server = await serve(gateway);
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.port}/health`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.status, 'degraded');
  assert.equal(body.gateway.available, 0);
});

test('/health reports ok and lists quota when an account is usable', async (t) => {
  const { gateway } = await withGateway(t, {
    upstreamHandler: (req, res) => {
      req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    },
  });
  const server = await serve(gateway);
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.port}/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, 'ok');
  assert.equal(body.gateway.ready, 1);
  assert.equal(body.accounts[0].quota, '0/5');
});

test('/v1/models proxies the hosted catalogue and caches it', async (t) => {
  let calls = 0;
  const { gateway } = await withGateway(t, {
    upstreamHandler: async (req, res) => {
      calls++;
      const { headers } = await readRequest(req);
      assert.equal(headers.authorization, 'Bearer st_a');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'deepseek-v4.1-flash-free' }] }));
    },
  });
  const server = await serve(gateway);
  t.after(() => server.close());

  const first = await fetch(`http://127.0.0.1:${server.port}/v1/models`);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-cache'), 'MISS');
  assert.equal((await first.json()).data[0].id, 'deepseek-v4.1-flash-free');

  const second = await fetch(`http://127.0.0.1:${server.port}/v1/models`);
  assert.equal(second.headers.get('x-cache'), 'HIT');
  await second.text();

  assert.equal(calls, 1, 'the catalogue must be cached');
});
