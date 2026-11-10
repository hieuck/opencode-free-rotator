import http from 'http';
import { Readable } from 'stream';
import { InstanceManager } from './InstanceManager.mjs';

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB guard against unbounded bodies

// Headers we must not copy verbatim from the upstream response.
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

/**
 * Gateway proxy that forwards OpenAI-style requests to OpenCode instances.
 */
export class Gateway {
  constructor(configPath) {
    this.manager = new InstanceManager(configPath);
    this.server = null;
  }

  get gatewayConfig() {
    return this.manager.config.gateway;
  }

  async start() {
    await this.manager.startAll();
    this.manager.startQuotaPolling();

    const { host = '127.0.0.1', port } = this.gatewayConfig;

    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((error) => {
        console.error('❌ Unhandled gateway error:', error.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: { message: 'Internal gateway error', type: 'gateway_error' } }));
      });
    });

    this.server.on('error', (error) => {
      console.error(`❌ Gateway server error: ${error.message}`);
    });

    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });

    console.log(`\n🌐 Gateway listening on http://${host}:${port}`);
    console.log(`📊 Forwarding to ${this.manager.instances.size} instances\n`);

    this.setupDailyReset();
    await this.warnAboutUpstream();
  }

  /**
   * Bug #3 guard: the upstream path the gateway forwards to may not exist on this
   * OpenCode build. Detect it at startup and say so loudly instead of returning
   * confusing per-request 404s. The translation layer is intentionally NOT
   * implemented here — see docs/OPENCODE_API_FINDINGS.md for the decision.
   */
  async warnAboutUpstream() {
    const upstreamPath = this.gatewayConfig.upstreamPath || '/v1/chat/completions';
    const instance = [...this.manager.instances.values()].find((i) => i.ready);
    if (!instance) return;

    const url = `${this.manager.baseUrl(instance)}${upstreamPath}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this.manager.authHeader(instance) },
        body: JSON.stringify({
          model: 'probe',
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: AbortSignal.timeout(8000),
      });
      const contentType = response.headers.get('content-type') || '';
      const reachable = contentType.includes('json');

      if (reachable) {
        console.log(`✅ Upstream ${upstreamPath} responded (HTTP ${response.status}, ${contentType})`);
      } else {
        this.logUpstreamWarning(upstreamPath, `HTTP ${response.status}, ${contentType || 'no content type'}`);
      }
    } catch (error) {
      this.logUpstreamWarning(upstreamPath, error.message);
    }
  }

  logUpstreamWarning(upstreamPath, detail) {
    console.warn(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚠️  UPSTREAM ENDPOINT NOT AVAILABLE                                 ║
╠══════════════════════════════════════════════════════════════════════╣
║  The gateway forwards to: ${upstreamPath.padEnd(42)}║
║  Result: ${String(detail).slice(0, 60).padEnd(60)}║
║                                                                      ║
║  OpenCode v2 does not expose an OpenAI-compatible endpoint.          ║
║  Chat requests will fail until a translation layer is added or       ║
║  gateway.upstreamPath is pointed at a supported endpoint.            ║
║  See docs/OPENCODE_API_FINDINGS.md.                                  ║
╚══════════════════════════════════════════════════════════════════════╝
`);
  }

  /**
   * Handle one incoming request.
   */
  async handleRequest(req, res) {
    const startTime = Date.now();
    const pathname = (req.url || '/').split('?')[0];

    if (pathname === '/health') return this.handleHealth(req, res);
    if (pathname === '/status') return this.handleStatus(req, res);

    if (pathname !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found', type: 'gateway_error' } }));
      return;
    }

    let body;
    try {
      body = await this.readBody(req);
    } catch (error) {
      res.writeHead(error.statusCode || 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error.message, type: 'invalid_request_error' } }));
      return;
    }

    let requestData;
    try {
      requestData = JSON.parse(body);
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: `Invalid JSON body: ${error.message}`, type: 'invalid_request_error' } }));
      return;
    }

    const result = await this.forwardRequest(requestData);

    if (result.success) {
      const duration = Date.now() - startTime;
      if (this.manager.config.logging?.logRequests !== false) {
        console.log(`✅ [${result.instance.config.name}] ${requestData.model ?? 'unknown-model'} - ${duration}ms`);
      }
      await this.pipeUpstream(result.upstream, res);
      return;
    }

    console.error(`❌ Request failed: ${result.error}`);
    res.writeHead(result.statusCode || 503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        error: {
          message: result.error,
          type: 'gateway_error',
          code: result.code || 'all_instances_unavailable',
        },
      }),
    );
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          const error = new Error(`Request body exceeds ${MAX_BODY_BYTES} bytes`);
          error.statusCode = 413;
          req.destroy();
          reject(error);
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  /**
   * Forward a request to a selected instance, retrying on other instances.
   * Every reservation is released exactly once.
   */
  async forwardRequest(requestData) {
    const {
      retryOnFailure = true,
      maxRetries = 3,
      requestTimeout = 60000,
      upstreamPath = '/v1/chat/completions',
      cooldownOn429Ms = 60000,
    } = this.gatewayConfig;

    const attempts = retryOnFailure ? Math.max(1, maxRetries) : 1;
    const tried = new Set();
    let lastError = 'No instance available';
    let lastStatus = 503;
    let lastCode = 'all_instances_unavailable';

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const instance = this.manager.selectInstance(tried);
      if (!instance) {
        if (tried.size === 0) {
          const allLimited = [...this.manager.instances.values()].some((i) => i.stats.limited === true);
          return {
            success: false,
            error: allLimited
              ? 'All instances report their OpenCode quota as exhausted'
              : 'No instance has remaining quota or is ready',
            code: allLimited ? 'quota_exhausted' : 'no_instance_available',
            statusCode: 429,
          };
        }
        break;
      }

      tried.add(instance.port);
      let released = false;
      const release = (opts) => {
        if (released) return;
        released = true;
        this.manager.releaseInstance(instance, opts);
      };

      try {
        const response = await fetch(`${this.manager.baseUrl(instance)}${upstreamPath}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...this.manager.authHeader(instance),
          },
          body: JSON.stringify(requestData),
          signal: AbortSignal.timeout(requestTimeout),
        });

        if (response.ok) {
          release({ consumed: true });
          return { success: true, instance, upstream: response };
        }

        const errorText = await response.text().catch(() => '');
        const detail = `${instance.config.name} returned ${response.status}${errorText ? `: ${errorText.slice(0, 300)}` : ''}`;
        console.warn(`⚠️  ${detail}`);

        if (response.status === 429) {
          const retryAfterMs = this.retryAfterMs(response, errorText, cooldownOn429Ms);
          release({ error: detail, cooldownMs: retryAfterMs });
          lastError = 'All instances are rate limited';
          lastStatus = 429;
          lastCode = 'quota_exhausted';
          continue;
        }

        release({ error: detail });
        return {
          success: false,
          error: errorText || `Instance returned ${response.status}`,
          statusCode: response.status,
          code: 'upstream_error',
        };
      } catch (error) {
        release({ error: error.message });
        lastError = error.message;
        lastStatus = 503;
        lastCode = 'upstream_unreachable';
        console.error(`❌ Instance ${instance.config.name} error: ${error.message}`);
        if (attempt < attempts) {
          console.log(`   Retrying with another instance (${attempt}/${attempts})...`);
        }
      }
    }

    return {
      success: false,
      error: `All instances failed: ${lastError}`,
      statusCode: lastStatus,
      code: lastCode,
    };
  }

  /** Honour Retry-After / retryAfterMs, otherwise use the configured cooldown. */
  retryAfterMs(response, bodyText, fallbackMs) {
    const header = response.headers.get('retry-after');
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    }
    try {
      const parsed = JSON.parse(bodyText);
      const ms = Number(parsed?.retryAfterMs);
      if (Number.isFinite(ms) && ms > 0) return ms;
    } catch {
      /* not JSON */
    }
    return fallbackMs;
  }

  /** Stream the upstream response through, preserving SSE/json bodies. */
  async pipeUpstream(upstream, res) {
    const headers = {};
    upstream.headers.forEach((value, key) => {
      if (!STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) headers[key] = value;
    });

    res.writeHead(upstream.status, headers);

    if (!upstream.body) {
      res.end();
      return;
    }

    const stream = Readable.fromWeb(upstream.body);
    stream.on('error', (error) => {
      console.error(`❌ Upstream stream error: ${error.message}`);
      res.destroy(error);
    });
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  }

  handleHealth(req, res) {
    const status = this.manager.getStatus();
    const anyReady = status.instances.some((i) => i.ready);

    res.writeHead(anyReady ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: anyReady ? 'ok' : 'degraded',
        gateway: {
          running: status.running,
          ready: status.instances.filter((i) => i.ready).length,
          total: status.totalInstances,
        },
        instances: status.instances.map((i) => ({
          name: i.name,
          running: i.running,
          ready: i.ready,
          limited: i.stats?.limited ?? null,
          quota: i.stats ? `${i.stats.requestsToday}/${i.quotaPerDay}` : `0/${i.quotaPerDay}`,
          inFlight: i.stats?.inFlight ?? 0,
        })),
      }),
    );
  }

  handleStatus(req, res) {
    const status = this.manager.getStatus();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
  }

  setupDailyReset() {
    const resetHour = this.gatewayConfig.quotaResetHour ?? 0;

    const now = new Date();
    const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), resetHour, 0, 0));
    if (nextReset <= now) nextReset.setUTCDate(nextReset.getUTCDate() + 1);

    const msUntilReset = nextReset - now;
    console.log(`⏰ Next quota reset: ${nextReset.toISOString()} (in ${Math.round(msUntilReset / 1000 / 3600)} hours)\n`);

    this.resetTimer = setTimeout(() => {
      this.manager.resetDailyQuota();
      this.resetTimer = setInterval(() => this.manager.resetDailyQuota(), 24 * 60 * 60 * 1000);
      this.resetTimer.unref?.();
    }, msUntilReset);
    this.resetTimer.unref?.();
  }

  async stop() {
    console.log('\n⏹️  Stopping gateway...\n');

    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      clearInterval(this.resetTimer);
    }

    if (this.server) {
      await new Promise((resolve) => this.server.close(resolve));
    }

    await this.manager.stopAll();
  }
}
