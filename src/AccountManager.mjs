import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { TokenManager, TokenError, expandHome } from './TokenManager.mjs';

const DEFAULT_UPSTREAM = {
  // Hosted inference base. `/models` and `/chat/completions` live under it.
  baseUrl: 'https://opencode.ai/inference/openai/v1',
  chatPath: '/chat/completions',
  modelsPath: '/models',
  // Real per-org quota (rolling / weekly / monthly buckets).
  usageUrl: 'https://opencode.ai/zen/go/v1/usage',
  userAgent: 'opencode/2.2.6',
  timeoutMs: 120_000,
};

const DEFAULT_GATEWAY = {
  port: 20130,
  host: '127.0.0.1',
  defaultQuotaPerDay: 200,
  selectionStrategy: 'lowest-usage',
  retryOnFailure: true,
  maxRetries: 3,
  cooldownOn429Ms: 60_000,
  requestTimeout: 120_000,
  quotaRefreshMs: 300_000,
  stateFile: '.rotator-state.json',
};

const DEFAULT_TOKENS = {
  cacheTtlMs: 15_000,
  refreshSkewMs: 120_000,
  refreshTimeoutMs: 20_000,
  clientId: 'opencode-cli',
  writeBack: true,
};

const DEFAULT_LOGGING = { level: 'info', logRequests: true };

const utcDay = (date = new Date()) => date.toISOString().slice(0, 10);

/**
 * Pools OpenCode accounts that talk to the hosted API.
 *
 * Each account is a credential in an OpenCode SQLite database (or a static token
 * from config). The manager owns quota accounting, account selection and real
 * usage polling; it never spawns processes.
 */
export class AccountManager {
  constructor(configPath, options = {}) {
    this.configPath = configPath;
    this.config = null;
    this.upstream = { ...DEFAULT_UPSTREAM };
    this.tokenOptions = { ...DEFAULT_TOKENS };
    this.accounts = new Map(); // name -> account record
    this.roundRobinIndex = 0;
    this.quotaTimer = null;
    this.stateTimer = null;
    this.stateDirty = false;
    this.options = { logger: console, ...options };

    this.loadConfig();
    this.tokenManager = new TokenManager([], this.tokenOptions);
    this.loadState();
  }

  loadConfig() {
    const raw = fs.readFileSync(this.configPath, 'utf8');
    this.config = yaml.parse(raw) || {};

    if (!this.config.gateway || typeof this.config.gateway !== 'object') {
      throw new Error(`Config ${this.configPath} is missing a "gateway" block`);
    }

    // `instances` is the pre-hosted-pooling name; accept it so old configs still load.
    const accountList = this.config.accounts ?? this.config.instances;
    if (!Array.isArray(accountList)) {
      throw new Error(`Config ${this.configPath} is missing an "accounts" list`);
    }

    this.upstream = { ...DEFAULT_UPSTREAM, ...(this.config.upstream || {}) };
    if (this.config.gateway.upstreamPath) {
      this.upstream.chatPath = this.config.gateway.upstreamPath;
    }
    this.upstream.baseUrl = String(this.upstream.baseUrl).replace(/\/+$/, '');

    this.gateway = { ...DEFAULT_GATEWAY, ...this.config.gateway };
    this.tokens = { ...DEFAULT_TOKENS, ...(this.config.tokens || {}) };
    this.logging = { ...DEFAULT_LOGGING, ...(this.config.logging || {}) };
    this.tokenOptions = { ...this.tokens, logger: this.options.logger };

    const seen = new Set();
    for (const entry of accountList) {
      if (!entry || typeof entry !== 'object') {
        throw new Error('Every entry in "accounts" must be an object');
      }
      const { name, db, token, quotaPerDay } = entry;
      if (!name) throw new Error(`Account without a name: ${JSON.stringify(entry)}`);
      if (seen.has(name)) throw new Error(`Duplicate account name "${name}"`);
      seen.add(name);

      if (!db && !token) {
        throw new Error(`Account "${name}" needs either "db" (OpenCode SQLite path) or "token"`);
      }
      if (db && typeof db !== 'string') {
        throw new Error(`Account "${name}" has a non-string "db"`);
      }
      if (quotaPerDay !== undefined && (!Number.isFinite(Number(quotaPerDay)) || Number(quotaPerDay) < 1)) {
        throw new Error(`Account "${name}" has an invalid quotaPerDay: ${quotaPerDay}`);
      }
    }

    const enabled = accountList.filter((entry) => entry.enabled !== false);
    if (enabled.length === 0) {
      throw new Error('No enabled accounts — enable at least one entry in "accounts"');
    }

    this.accounts.clear();
    for (const entry of accountList) {
      this.accounts.set(entry.name, this.makeAccount(entry));
    }

    this.logger.log(`✅ Loaded config with ${accountList.length} accounts (${enabled.length} enabled)`);
    this.logger.log(`🔗 Hosted upstream: ${this.upstream.baseUrl}${this.upstream.chatPath}`);
  }

  get logger() {
    return this.options.logger;
  }

  makeAccount(entry) {
    const enabled = entry.enabled !== false;
    return {
      name: entry.name,
      config: { ...entry, db: entry.db ? expandHome(entry.db) : undefined },
      ready: false,
      enabled,
      error: null,
      auth: null,
      stats: {
        requestsToday: 0,
        inFlight: 0,
        failures: 0,
        lastReset: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        lastError: null,
        lastErrorCode: null,
        cooldownUntil: 0,
        limited: null, // null = unknown, true/false = from real usage API or a 429
        limitedResetsAt: null,
        fundsExhausted: false,
        usage: null,
        lastQuotaAt: null,
        lastQuotaError: null,
        lastStatus: null,
        lastUsedAt: null,
      },
    };
  }

  /** Quota for one account, in requests/day. */
  quotaFor(account) {
    const config = account?.config ?? account;
    return Number(config?.quotaPerDay ?? this.gateway.defaultQuotaPerDay ?? 200);
  }

  /** Resolve every account's token up front so /status is meaningful immediately. */
  async init() {
    const enabled = [...this.accounts.values()].filter((a) => a.enabled);
    this.tokenManager = new TokenManager(
      enabled.map((a) => a.config),
      this.tokenOptions,
    );

    await Promise.allSettled(
      enabled.map(async (account) => {
        try {
          const auth = await this.getAuth(account);
          account.ready = true;
          account.error = null;
          this.logger.log(
            `🔑 ${account.name}: ${auth.email || 'unknown email'} · org ${auth.orgId || 'n/a'} · token ${auth.tokenPreview}`,
          );
        } catch (error) {
          account.ready = false;
          account.error = error.message;
          this.logger.warn(`⚠️  ${account.name}: ${error.message}`);
        }
      }),
    );

    await this.refreshAllQuotas();
    return this.getStatus();
  }

  /** Return a bearer token (and org id) for one account, refreshing when needed. */
  async getAuth(account, { force = false } = {}) {
    const value = await this.tokenManager.getToken(account.config, { force });
    const auth = {
      token: value.token,
      orgId: value.orgId || null,
      email: value.email || account.config.email || null,
      type: value.type,
      tokenPreview: null,
    };
    account.auth = auth;
    return auth;
  }

  /** Build the headers the hosted API expects. */
  authHeaders(auth) {
    const headers = {
      Authorization: `Bearer ${auth.token}`,
      'User-Agent': this.upstream.userAgent,
    };
    if (auth.orgId) headers['x-opencode-org-id'] = auth.orgId;
    return headers;
  }

  /**
   * Read real quota for one account from the hosted usage endpoint.
   * Percentages and `limited` come from the provider, so the gateway stops
   * spending requests on an account that cannot serve them.
   */
  async refreshQuota(account) {
    if (!account?.enabled) return null;

    let auth;
    try {
      auth = await this.getAuth(account);
    } catch (error) {
      account.ready = false;
      account.error = error.message;
      account.stats.lastQuotaError = error.message;
      return null;
    }

    if (!auth.orgId) {
      account.stats.lastQuotaError = 'credential has no orgID, cannot read usage';
      return null;
    }

    try {
      const response = await (this.options.fetchImpl || globalThis.fetch)(this.upstream.usageUrl, {
        headers: this.authHeaders(auth),
        signal: AbortSignal.timeout(15_000),
      });

      if (response.status === 403) {
        account.stats.lastQuotaError = 'usage endpoint not available for this plan (403)';
        account.stats.lastQuotaAt = new Date().toISOString();
        return null;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const usage = normaliseUsage(payload?.usage);
      account.stats.usage = usage;
      account.stats.lastQuotaAt = new Date().toISOString();
      account.stats.lastQuotaError = null;

      const limited = [usage.rolling, usage.weekly, usage.monthly].some((bucket) => bucket?.limited === true);
      account.stats.limited = limited;
      account.stats.limitedResetsAt = limited ? latestReset([usage.rolling, usage.weekly, usage.monthly]) : null;

      if (limited) {
        const until = account.stats.limitedResetsAt || Date.now() + this.gateway.cooldownOn429Ms;
        account.stats.cooldownUntil = Math.max(account.stats.cooldownUntil, until);
        this.logger.warn(
          `⚠️  ${account.name} is quota-limited (rolling ${pct(usage.rolling)}, weekly ${pct(usage.weekly)}, monthly ${pct(usage.monthly)})` +
            (account.stats.limitedResetsAt ? ` until ${new Date(account.stats.limitedResetsAt).toISOString()}` : ''),
        );
      }

      return usage;
    } catch (error) {
      account.stats.lastQuotaError = error.message;
      this.logger.warn(`⚠️  Could not read usage for ${account.name}: ${error.message}`);
      return null;
    }
  }

  async refreshAllQuotas() {
    await Promise.allSettled([...this.accounts.values()].map((account) => this.refreshQuota(account)));
  }

  startQuotaPolling() {
    if (this.quotaTimer) return;
    const interval = Number(this.gateway.quotaRefreshMs);
    if (!Number.isFinite(interval) || interval <= 0) return;

    this.quotaTimer = setInterval(() => {
      this.refreshAllQuotas().catch(() => {});
    }, interval);
    this.quotaTimer.unref?.();
  }

  stopQuotaPolling() {
    if (this.quotaTimer) {
      clearInterval(this.quotaTimer);
      this.quotaTimer = null;
    }
  }

  /**
   * Atomically reserve one account for a request.
   * The `inFlight` increment happens synchronously, before any await, so two
   * concurrent requests can never be handed the same free slot.
   */
  selectAccount(excludeNames = new Set()) {
    const now = Date.now();
    const strategy = this.gateway.selectionStrategy || 'lowest-usage';
    const candidates = [];

    for (const account of this.accounts.values()) {
      if (!account.enabled || !account.ready) continue;
      if (excludeNames.has(account.name)) continue;
      if (account.stats.fundsExhausted) continue;
      if (account.stats.cooldownUntil > now) continue;

      // Recover automatically once a provider-reported limit window has passed.
      if (account.stats.limited === true) {
        const resetsAt = account.stats.limitedResetsAt;
        if (!resetsAt || resetsAt > now) continue;
        account.stats.limited = null;
        account.stats.limitedResetsAt = null;
      }

      const used = account.stats.requestsToday + account.stats.inFlight;
      if (used >= this.quotaFor(account)) continue;

      candidates.push({ account, used });
    }

    if (candidates.length === 0) return null;

    let chosen;
    if (strategy === 'round-robin') {
      chosen = candidates[this.roundRobinIndex % candidates.length].account;
      this.roundRobinIndex = (this.roundRobinIndex + 1) % candidates.length;
    } else {
      candidates.sort((a, b) => a.used - b.used || a.account.name.localeCompare(b.account.name));
      chosen = candidates[0].account;
    }

    chosen.stats.inFlight++; // reserve before returning
    return chosen;
  }

  /**
   * Release a reservation taken by selectAccount().
   * Must be called exactly once per request.
   */
  releaseAccount(account, { consumed = false, error = null, errorCode = null, cooldownMs = 0, limited = null, status = null } = {}) {
    if (!account) return;
    const target = this.accounts.get(account.name) || account;

    target.stats.inFlight = Math.max(0, target.stats.inFlight - 1);
    if (consumed) {
      target.stats.requestsToday++;
      target.stats.lastUsedAt = new Date().toISOString();
      this.markStateDirty();
    }
    if (status !== null) target.stats.lastStatus = status;
    if (error) {
      target.stats.failures++;
      target.stats.lastError = String(error).slice(0, 500);
      target.stats.lastErrorCode = errorCode;
    }
    if (limited !== null) target.stats.limited = limited;
    if (cooldownMs > 0) {
      target.stats.cooldownUntil = Math.max(target.stats.cooldownUntil, Date.now() + cooldownMs);
    }
  }

  getStatus() {
    const now = Date.now();
    const status = {
      upstream: { ...this.upstream },
      totalAccounts: this.accounts.size,
      ready: 0,
      available: 0,
      accounts: [],
    };

    for (const account of this.accounts.values()) {
      const quota = this.quotaFor(account);
      const used = account.stats.requestsToday + account.stats.inFlight;
      const cooling = account.stats.cooldownUntil > now;
      const available = account.enabled && account.ready && !cooling && !account.stats.fundsExhausted && account.stats.limited !== true && used < quota;

      if (account.enabled && account.ready) status.ready++;
      if (available) status.available++;

      status.accounts.push({
        name: account.name,
        email: account.auth?.email ?? account.config.email ?? null,
        orgId: account.auth?.orgId ?? account.config.orgId ?? null,
        enabled: account.enabled,
        ready: account.ready,
        available,
        error: account.error,
        token: this.tokenManager?.describe(account.config) ?? null,
        quotaPerDay: quota,
        used,
        remaining: Math.max(0, quota - used),
        stats: account.stats,
      });
    }

    return status;
  }

  resetDailyQuota({ reason = 'scheduled' } = {}) {
    this.logger.log(`\n🔄 Resetting daily request counters (${reason})...`);
    for (const account of this.accounts.values()) {
      const before = account.stats.requestsToday;
      account.stats.requestsToday = 0;
      account.stats.lastReset = new Date().toISOString();
      if (before > 0) this.logger.log(`  ${account.name}: ${before} requests yesterday`);
    }
    this.markStateDirty();
  }

  // --- small persistence layer: keeps counters across restarts ---------------

  get statePath() {
    const file = this.gateway.stateFile;
    if (!file) return null;
    return path.isAbsolute(file) ? file : path.join(path.dirname(this.configPath), file);
  }

  loadState() {
    const file = this.statePath;
    if (!file || !fs.existsSync(file)) return;
    try {
      const state = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (state?.date !== utcDay()) return; // counters belong to a previous day
      for (const [name, saved] of Object.entries(state.accounts || {})) {
        const account = this.accounts.get(name);
        if (!account) continue;
        if (Number.isFinite(saved.requestsToday)) account.stats.requestsToday = saved.requestsToday;
        if (Number.isFinite(saved.failures)) account.stats.failures = saved.failures;
        if (typeof saved.lastUsedAt === 'string') account.stats.lastUsedAt = saved.lastUsedAt;
      }
    } catch (error) {
      this.logger.warn(`⚠️  Ignoring unreadable state file ${file}: ${error.message}`);
    }
  }

  markStateDirty() {
    this.stateDirty = true;
    if (this.stateTimer) return;
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.persistState();
    }, 1000);
    this.stateTimer.unref?.();
  }

  persistState() {
    const file = this.statePath;
    if (!file || !this.stateDirty) return;
    this.stateDirty = false;

    const payload = {
      version: 1,
      date: utcDay(),
      updatedAt: new Date().toISOString(),
      accounts: Object.fromEntries(
        [...this.accounts.values()].map((account) => [
          account.name,
          {
            requestsToday: account.stats.requestsToday,
            failures: account.stats.failures,
            lastUsedAt: account.stats.lastUsedAt,
          },
        ]),
      ),
    };

    try {
      fs.writeFileSync(file, JSON.stringify(payload, null, 2));
    } catch (error) {
      this.logger.warn(`⚠️  Could not persist state to ${file}: ${error.message}`);
    }
  }

  async stop() {
    this.stopQuotaPolling();
    if (this.stateTimer) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }
    this.persistState();
    this.tokenManager?.close();
  }
}

function normaliseUsage(usage) {
  const bucket = (value) => {
    if (!value || typeof value !== 'object') return null;
    const resetsAt = value.resetsAt ? Date.parse(value.resetsAt) : null;
    return {
      percent: Number.isFinite(value.percent) ? value.percent : null,
      limited: value.status === 'rate-limited' || value.limited === true,
      status: value.status ?? null,
      resetsAt: Number.isFinite(resetsAt) ? resetsAt : null,
    };
  };
  return {
    rolling: bucket(usage?.rolling),
    weekly: bucket(usage?.weekly),
    monthly: bucket(usage?.monthly),
  };
}

function latestReset(buckets) {
  const stamps = buckets.map((b) => b?.resetsAt).filter((v) => Number.isFinite(v));
  return stamps.length ? Math.max(...stamps) : null;
}

function pct(bucket) {
  return bucket?.percent === null || bucket?.percent === undefined ? 'n/a' : `${bucket.percent}%`;
}

export { TokenError };
export default AccountManager;
