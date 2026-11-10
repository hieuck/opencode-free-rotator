import http from 'http';
import { Readable } from 'stream';
import { AccountManager, TokenError } from './AccountManager.mjs';

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB guard against unbounded bodies
const MODELS_CACHE_MS = 5 * 60 * 1000;

// Headers we must not copy verbatim from the upstream response.
const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
]);

/**
 * Gateway that pools OpenCode accounts against the hosted, OpenAI-compatible
 * inference API (`https://opencode.ai/inference/openai/v1`).
 *
 * It owns no child processes: every request is forwarded with the account's
 * bearer token, and quota comes from the provider's real usage endpoint.
 */
export class Gateway {
  constructor(configPath, options = {}) {
    this.manager = new AccountManager(configPath, options);
    this.server = null;
    this.modelsCache = null;
  }

  get gatewayConfig() {
    return this.manager.gateway;
  }

  get upstream() {
    return this.manager.upstream;
  }

  async start() {
    const status = await this.manager.init();
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
    console.log(`📊 Pooling ${status.totalAccounts} account(s) · ${status.available} available now\n`);

    if (status.available === 0) {
      console.warn(
        '⚠️  No account can serve a request right now. Check /status — the usual causes are an\n' +
          '    exhausted free quota (the provider reports a reset time) or a credential that needs\n' +
          '    `opencode auth login`.\n',
      );
    }

    this.setupDailyReset();
    return status;
  }

  /**
   * Handle one incoming request.
   */
  async handleRequest(req, res) {
    const startTime = Date.now();
    const pathname = (req.url || '/').split('?')[0];

    if (pathname === '/health') return this.handleHealth(req, res);
    if (pathname === '/status') return this.handleStatus(req, res);
    if (pathname === '/v1/models' && req.method === 'GET') return this.handleModels(req, res);

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
      if (this.manager.logging.logRequests !== false) {
        console.log(
          `✅ [${result.account.name}] ${requestData.model ?? 'unknown-model'} - ${duration}ms ` +
            `(${result.account.stats.requestsToday}/${this.manager.quotaFor(result.account)} today)`,
        );
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
          code: result.code || 'all_accounts_unavailable',
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

  upstreamUrl(pathname) {
    return `${this.upstream.baseUrl}${pathname}`;
  }

  /** POST one chat completion with an account's token, retrying once on 401. */
  async sendUpstream(account, requestData) {
    const { chatPath, timeoutMs } = this.upstream;

    const attempt = async () => {
      const auth = await this.manager.getAuth(account);
      return fetch(this.upstreamUrl(chatPath), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.manager.authHeaders(auth),
        },
        body: JSON.stringify(requestData),
        signal: AbortSignal.timeout(timeoutMs),
      });
    };

    let response = await attempt();
    if (response.status !== 401) return response;

    // The cached token was rejected: drop it and retry once with a fresh read/refresh.
    await response.text().catch(() => '');
    this.manager.tokenManager.invalidate(account.config);
    response = await attempt();
    return response;
  }

  /**
   * Forward a request to a selected account, failing over on auth/quota errors.
   * Every reservation is released exactly once.
   */
  async forwardRequest(requestData) {
    const { retryOnFailure = true, maxRetries = 3, cooldownOn429Ms = 60000 } = this.gatewayConfig;

    const attempts = retryOnFailure ? Math.max(1, maxRetries) : 1;
    const tried = new Set();
    let lastError = 'No account available';
    let lastStatus = 503;
    let lastCode = 'all_accounts_unavailable';

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const account = this.manager.selectAccount(tried);
      if (!account) {
        if (tried.size === 0) {
          const accounts = [...this.manager.accounts.values()];
          const limited = accounts.filter((a) => a.stats.limited === true || a.stats.fundsExhausted);
          const notReady = accounts.filter((a) => a.enabled && !a.ready);
          return {
            success: false,
            error:
              limited.length > 0
                ? `All accounts are out of free quota (${limited.map((a) => a.name).join(', ')}). ` +
                  'The provider resets the window automatically; add more accounts to keep going.'
                : notReady.length > 0
                  ? `No account has a usable credential: ${notReady.map((a) => `${a.name} (${a.error})`).join('; ')}`
                  : 'No account has remaining quota right now',
            code: limited.length > 0 ? 'quota_exhausted' : notReady.length > 0 ? 'auth_required' : 'no_account_available',
            statusCode: limited.length > 0 ? 429 : 503,
          };
        }
        break;
      }

      tried.add(account.name);
      let released = false;
      const release = (opts) => {
        if (released) return;
        released = true;
        this.manager.releaseAccount(account, opts);
      };

      try {
        const response = await this.sendUpstream(account, requestData);

        if (response.ok) {
          release({ consumed: true, status: response.status, error: null, limited: false });
          return { success: true, account, upstream: response };
        }

        const errorText = await response.text().catch(() => '');
        const detail = `${account.name} returned ${response.status}${errorText ? `: ${errorText.slice(0, 300)}` : ''}`;
        console.warn(`⚠️  ${detail}`);

        if (response.status === 429) {
          const kind = classifyLimit(errorText);
          const retryAfter = this.retryAfterMs(response, errorText, 0);
          const usageReset = account.stats.limitedResetsAt ? account.stats.limitedResetsAt - Date.now() : 0;
          const cooldown = Math.max(retryAfter, usageReset, kind ? 0 : cooldownOn429Ms) || cooldownOn429Ms;

          release({
            error: detail,
            errorCode: kind ? 'quota_exhausted' : 'rate_limited',
            status: 429,
            limited: true,
            cooldownMs: cooldown,
          });
          lastError = 'All accounts are rate limited';
          lastStatus = 429;
          lastCode = 'quota_exhausted';
          continue;
        }

        if (response.status === 401 || response.status === 403) {
          release({ error: detail, errorCode: 'auth_failed', status: response.status });
          account.ready = false;
          account.error = `Authentication failed (HTTP ${response.status}). Re-run \`opencode auth login\` for ${account.name}.`;
          lastError = account.error;
          lastStatus = 503;
          lastCode = 'auth_required';
          continue;
        }

        if (response.status === 402) {
          release({
            error: detail,
            errorCode: 'insufficient_funds',
            status: 402,
            cooldownMs: 24 * 60 * 60 * 1000,
          });
          account.stats.fundsExhausted = true;
          lastError = `${account.name} has insufficient account funds`;
          lastStatus = 402;
          lastCode = 'insufficient_funds';
          continue;
        }

        if (response.status >= 500) {
          release({ error: detail, errorCode: 'upstream_error', status: response.status });
          lastError = errorText || `Upstream returned ${response.status}`;
          lastStatus = response.status;
          lastCode = 'upstream_error';
          continue;
        }

        release({ error: detail, errorCode: 'upstream_error', status: response.status });
        return {
          success: false,
          error: errorText || `Upstream returned ${response.status}`,
          statusCode: response.status,
          code: 'upstream_error',
        };
      } catch (error) {
        const tokenProblem = error instanceof TokenError;
        release({
          error: error.message,
          errorCode: tokenProblem ? error.code : 'upstream_unreachable',
          status: 503,
        });
        lastError = error.message;
        lastStatus = tokenProblem ? 503 : 502;
        lastCode = tokenProblem ? 'auth_required' : 'upstream_unreachable';
        console.error(`❌ Account ${account.name} error: ${error.message}`);
        if (attempt < attempts) {
          console.log(`   Retrying with another account (${attempt}/${attempts})...`);
        }
      }
    }

    return {
      success: false,
      error: `All accounts failed: ${lastError}`,
      statusCode: lastStatus,
      code: lastCode,
    };
  }

  /** Honour Retry-After / retryAfterMs / resetsAt, otherwise fall back. */
  retryAfterMs(response, bodyText, fallbackMs) {
    const header = response.headers.get('retry-after');
    if (header) {
      const seconds = Number(header);
      if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
      const date = Date.parse(header);
      if (Number.isFinite(date) && date > Date.now()) return date - Date.now();
    }
    try {
      const parsed = JSON.parse(bodyText);
      const ms = Number(parsed?.retryAfterMs);
      if (Number.isFinite(ms) && ms > 0) return ms;
      const reset = parsed?.error?.resetsAt ? Date.parse(parsed.error.resetsAt) : NaN;
      if (Number.isFinite(reset) && reset > Date.now()) return reset - Date.now();
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

  /** Proxy the hosted model catalogue, cached briefly. */
  async handleModels(req, res) {
    if (this.modelsCache && Date.now() - this.modelsCache.at < MODELS_CACHE_MS) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT' });
      res.end(this.modelsCache.body);
      return;
    }

    const tried = new Set();
    for (;;) {
      const account = this.manager.selectAccount(tried);
      if (!account) break;
      tried.add(account.name);

      try {
        const auth = await this.manager.getAuth(account);
        const response = await fetch(this.upstreamUrl(this.upstream.modelsPath), {
          headers: this.manager.authHeaders(auth),
          signal: AbortSignal.timeout(20_000),
        });
        const body = await response.text();
        this.manager.releaseAccount(account, { status: response.status });

        if (response.ok) {
          this.modelsCache = { at: Date.now(), body };
          res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'MISS' });
          res.end(body);
          return;
        }
        console.warn(`⚠️  ${account.name} /models returned ${response.status}`);
      } catch (error) {
        this.manager.releaseAccount(account, { error: error.message, errorCode: 'upstream_unreachable' });
        console.warn(`⚠️  ${account.name} /models failed: ${error.message}`);
      }
    }

    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'No account could list models', type: 'gateway_error' } }));
  }

  handleHealth(req, res) {
    const status = this.manager.getStatus();
    const healthy = status.available > 0;

    res.writeHead(healthy ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: healthy ? 'ok' : 'degraded',
        gateway: {
          running: Boolean(this.server?.listening),
          upstream: `${this.upstream.baseUrl}${this.upstream.chatPath}`,
          ready: status.ready,
          available: status.available,
          total: status.totalAccounts,
        },
        accounts: status.accounts.map((a) => ({
          name: a.name,
          email: a.email,
          ready: a.ready,
          available: a.available,
          used: a.used,
          quota: `${a.used}/${a.quotaPerDay}`,
          limited: a.stats.limited,
          cooldownSeconds: Math.max(0, Math.round((a.stats.cooldownUntil - Date.now()) / 1000)),
          error: a.error,
        })),
      }),
    );
  }

  handleStatus(req, res) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(this.manager.getStatus(), null, 2));
  }

  setupDailyReset() {
    // Hosted quota is governed by the provider, so the local counter is only a
    // safety net. Reset it at UTC midnight (or gateway.quotaResetHour if set).
    const resetHour = this.gatewayConfig.quotaResetHour ?? 0;

    const now = new Date();
    const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), resetHour, 0, 0));
    if (nextReset <= now) nextReset.setUTCDate(nextReset.getUTCDate() + 1);

    const msUntilReset = nextReset - now;
    console.log(`⏰ Next local counter reset: ${nextReset.toISOString()} (in ${Math.round(msUntilReset / 1000 / 3600)} hours)\n`);

    this.resetTimer = setTimeout(() => {
      this.manager.resetDailyQuota({ reason: 'daily timer' });
      this.resetTimer = setInterval(() => this.manager.resetDailyQuota({ reason: 'daily timer' }), 24 * 60 * 60 * 1000);
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

    await this.manager.stop();
  }
}

/** Map a hosted-API error body to a quota cause. */
export function classifyLimit(bodyText) {
  if (!bodyText) return null;
  if (bodyText.includes('FreeUsageLimitError')) return 'free-limit';
  if (bodyText.includes('GoUsageLimitError')) return 'go-limit';
  if (bodyText.includes('BudgetLimitError')) return 'budget-limit';
  if (/rate.?limit/i.test(bodyText)) return 'rate-limit';
  return null;
}

export default Gateway;
