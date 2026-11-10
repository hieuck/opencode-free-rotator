import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import yaml from 'yaml';
import { buildSpawn } from './resolveCommand.mjs';

/**
 * Defaults for talking to a locally spawned `opencode serve` process.
 * All values can be overridden through the `opencode:` block in config.yaml.
 */
const DEFAULT_OPENCODE = {
  // Executable. Override when opencode is not on PATH (e.g. in Docker).
  command: 'opencode',
  // Bind address for spawned instances.
  hostname: '127.0.0.1',
  // Health/readiness endpoint. `/api/info` returns JSON; `/health` returns the web UI HTML.
  healthPath: '/api/info',
  // How long to wait for a new instance to answer the health check.
  startupTimeoutMs: 30000,
  healthIntervalMs: 500,
  // `opencode serve` protects /api/* with HTTP Basic auth.
  username: 'opencode',
  // Fixed password for every instance. "auto" lets opencode generate one (parsed from stdout).
  // An empty value makes the rotator generate a distinct random password per instance.
  password: '',
  // Extra CLI args appended to `serve --port ... --hostname ...`.
  extraArgs: [],
  // Where to read real quota from: "auto" (probe the API), "local" (counter only), "off".
  quotaSource: 'auto',
  quotaPath: '/api/experimental/usage/limits',
  quotaPollIntervalMs: 60000,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class InstanceManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = null;
    this.opencode = { ...DEFAULT_OPENCODE };
    this.instances = new Map(); // port -> instance record
    this.roundRobinIndex = 0;
    this.quotaTimer = null;
    this.loadConfig();
  }

  loadConfig() {
    const configFile = fs.readFileSync(this.configPath, 'utf8');
    this.config = yaml.parse(configFile) || {};
    this.opencode = {
      ...DEFAULT_OPENCODE,
      ...(this.config.opencode || {}),
    };

    if (!Array.isArray(this.config.instances)) {
      throw new Error(`Config ${this.configPath} is missing an "instances" list`);
    }
    if (!this.config.gateway || typeof this.config.gateway !== 'object') {
      throw new Error(`Config ${this.configPath} is missing a "gateway" block`);
    }

    const seen = new Set();
    for (const instance of this.config.instances) {
      if (!instance || typeof instance !== 'object') {
        throw new Error('Every entry in "instances" must be an object');
      }
      const { name, port, db } = instance;
      if (!name) throw new Error(`Instance without a name: ${JSON.stringify(instance)}`);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Instance "${name}" has an invalid port: ${port}`);
      }
      if (seen.has(port)) {
        throw new Error(`Duplicate port ${port} (instance "${name}")`);
      }
      seen.add(port);
      if (typeof db !== 'string' || !db.trim()) {
        throw new Error(`Instance "${name}" is missing "db"`);
      }
    }

    console.log(`✅ Loaded config with ${this.config.instances.length} instances`);
  }

  /** Quota for one instance, in requests/day. */
  quotaFor(instance) {
    return Number(instance.config.quotaPerDay ?? this.config.gateway.defaultQuotaPerDay ?? 200);
  }

  /** Build the HTTP Basic header used by `opencode serve`. */
  authHeader(instance) {
    const { username, password } = instance.auth;
    if (!password) return {};
    return {
      Authorization: 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64'),
    };
  }

  baseUrl(instance) {
    return `http://${this.opencode.hostname}:${instance.config.port}`;
  }

  async startAll() {
    console.log('\n🚀 Starting OpenCode instances...\n');

    const enabled = this.config.instances.filter((i) => i.enabled !== false);
    const results = [];

    for (const instanceConfig of enabled) {
      try {
        await this.startInstance(instanceConfig);
        results.push({ name: instanceConfig.name, status: 'started' });
      } catch (error) {
        console.error(`❌ Failed to start ${instanceConfig.name}:`, error.message);
        results.push({ name: instanceConfig.name, status: 'failed', error: error.message });
      }
    }

    console.log('\n📊 Start Summary:');
    results.forEach((r) => {
      const icon = r.status === 'started' ? '✅' : '❌';
      console.log(`  ${icon} ${r.name}: ${r.status}`);
      if (r.error) console.log(`      Error: ${r.error}`);
    });

    return results;
  }

  /**
   * Start a single `opencode serve` instance and wait until it is healthy.
   */
  async startInstance(instanceConfig) {
    const { name, port, db } = instanceConfig;

    if (this.instances.has(port)) {
      throw new Error(`Port ${port} is already managed by this rotator`);
    }

    const dbPath = db.replace(/^~/, os.homedir());
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`📁 Created DB directory: ${dbDir}`);
    }

    const password = await this.resolvePassword(instanceConfig);

    const args = [
      'serve',
      '--port', String(port),
      '--hostname', this.opencode.hostname,
      ...(this.opencode.extraArgs || []),
    ];

    const env = {
      ...process.env,
      OPENCODE_DB: dbPath,
      OPENCODE_SERVER_USERNAME: this.opencode.username,
    };
    if (password !== 'auto') {
      env.OPENCODE_SERVER_PASSWORD = password;
    } else {
      delete env.OPENCODE_SERVER_PASSWORD;
    }

    console.log(`⏳ Starting: ${name}${instanceConfig.email ? ` (${instanceConfig.email})` : ''}`);
    console.log(`   Port: ${port}`);
    console.log(`   DB: ${dbPath}`);

    // NOTE: `child` (not `process`) — naming it `process` shadowed the global and
    // triggered "Cannot access 'process' before initialization" in the env spread.
    // buildSpawn() resolves npm's Windows .cmd shims, which spawn() cannot execute directly.
    const launch = buildSpawn(this.opencode.command, args);
    const child = spawn(launch.command, launch.args, {
      ...launch.options,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: false,
    });

    const instance = {
      port,
      child,
      config: { ...instanceConfig, db: dbPath },
      auth: { username: this.opencode.username, password: password === 'auto' ? null : password },
      ready: false,
      exited: false,
      exitCode: null,
      exitSignal: null,
      spawnError: null,
      stats: {
        requestsToday: 0,
        inFlight: 0,
        failures: 0,
        lastReset: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        lastError: null,
        cooldownUntil: 0,
        limited: null, // null = unknown, true = API says quota is exhausted
        usage: null,
        lastQuotaAt: null,
        lastQuotaError: null,
      },
    };

    this.instances.set(port, instance);

    child.on('error', (error) => {
      instance.spawnError = error;
      console.error(`[${name}] ❌ spawn failed: ${error.message}`);
    });

    child.stdout.on('data', (data) => {
      for (const line of data.toString().split(/\r?\n/)) {
        const msg = line.trim();
        if (!msg) continue;
        if (!instance.auth.password) {
          const generated = msg.match(/^server password\s+(\S+)$/);
          if (generated) {
            instance.auth.password = generated[1];
            console.log(`[${name}] 🔑 Captured generated server password`);
            continue;
          }
        }
        console.log(`[${name}] ${msg}`);
      }
    });

    child.stderr.on('data', (data) => {
      for (const line of data.toString().split(/\r?\n/)) {
        const msg = line.trim();
        if (msg) console.error(`[${name}] ⚠️  ${msg}`);
      }
    });

    child.on('exit', (code, signal) => {
      instance.exited = true;
      instance.exitCode = code;
      instance.exitSignal = signal;
      instance.ready = false;
      // Only remove this exact record so a restarted instance on the same port survives.
      if (this.instances.get(port) === instance) {
        this.instances.delete(port);
      }
      console.log(`[${name}] Process exited (code ${code}${signal ? `, signal ${signal}` : ''})`);
    });

    try {
      await this.waitForHealth(port, name);
    } catch (error) {
      await this.stopInstance(port);
      throw error;
    }

    console.log(`✅ Started: ${name}\n`);
    return instance;
  }

  /** Resolve the Basic auth password for an instance. */
  async resolvePassword(instanceConfig) {
    const configured = instanceConfig.password ?? this.opencode.password;
    if (configured === 'auto') return 'auto';
    if (configured) return configured;
    return crypto.randomBytes(24).toString('base64url');
  }

  /**
   * Poll the readiness endpoint until it returns a valid JSON payload.
   * `opencode serve` answers /api/* with 401 until the Basic auth header is supplied,
   * and everything outside /api/* with the web UI HTML.
   */
  async waitForHealth(port, name, opts = {}) {
    const instance = this.instances.get(port);
    if (!instance) throw new Error(`${name} is not running`);

    const maxAttempts = opts.maxAttempts ?? Math.max(1, Math.ceil(this.opencode.startupTimeoutMs / this.opencode.healthIntervalMs));
    const intervalMs = opts.intervalMs ?? this.opencode.healthIntervalMs;
    const url = `${this.baseUrl(instance)}${this.opencode.healthPath}`;

    let lastDetail = 'no response yet';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (instance.spawnError) {
        throw new Error(`Failed to spawn "${this.opencode.command}": ${instance.spawnError.message}`);
      }
      if (instance.exited) {
        throw new Error(
          `${name} exited during startup (code ${instance.exitCode}${instance.exitSignal ? `, signal ${instance.exitSignal}` : ''})`,
        );
      }

      // Password may still be arriving on stdout when using password: "auto".
      if (!instance.auth.password) {
        await sleep(intervalMs);
        continue;
      }

      try {
        const response = await fetch(url, {
          headers: this.authHeader(instance),
          signal: AbortSignal.timeout(Math.min(2000, intervalMs + 1000)),
        });

        if (response.ok) {
          const contentType = response.headers.get('content-type') || '';
          if (!contentType.includes('json')) {
            throw new Error(
              `Health path ${this.opencode.healthPath} returned ${contentType || 'unknown content type'}, not JSON. ` +
                `Point opencode.healthPath at an API endpoint such as /api/info.`,
            );
          }
          const data = await response.json();
          if (!data || typeof data !== 'object') {
            lastDetail = 'health endpoint returned an unexpected payload';
          } else {
            instance.ready = true;
            instance.stats.lastError = null;
            console.log(`[${name}] ❤️  healthy${data.version ? ` (opencode v${data.version})` : ''}`);
            await this.refreshQuota(port);
            return true;
          }
        } else if (response.status === 401) {
          lastDetail = 'HTTP 401 — wrong OPENCODE_SERVER_USERNAME/PASSWORD';
        } else {
          lastDetail = `HTTP ${response.status}`;
        }
      } catch (error) {
        if (error.message?.includes('not JSON') || error.message?.includes('health path')) {
          throw error; // configuration error, retrying will not help
        }
        lastDetail = error.message;
      }

      await sleep(intervalMs);
    }

    throw new Error(`${name} did not become healthy after ${maxAttempts} attempts (${lastDetail})`);
  }

  /**
   * Read the account's real quota from the OpenCode usage API and cache it.
   * Returns null when the source is disabled or unavailable.
   */
  async refreshQuota(port) {
    const instance = this.instances.get(port);
    if (!instance || !instance.ready) return null;
    if (this.opencode.quotaSource === 'off' || this.opencode.quotaSource === 'local') return null;

    const directory = this.opencode.quotaDirectory || process.cwd();
    const url = `${this.baseUrl(instance)}${this.opencode.quotaPath}?location[directory]=${encodeURIComponent(directory)}`;

    try {
      const response = await fetch(url, {
        headers: this.authHeader(instance),
        signal: AbortSignal.timeout(10000),
      });

      if (!response.ok) {
        if (response.status === 404) {
          // Endpoint not present on this build — fall back to local counters only.
          this.opencode.quotaSource = 'local';
          console.warn('⚠️  Usage endpoint unavailable (HTTP 404). Falling back to local request counters.');
          return null;
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      const data = payload?.data ?? null;

      instance.stats.usage = data;
      instance.stats.lastQuotaAt = new Date().toISOString();
      instance.stats.lastQuotaError = null;

      if (!data) {
        // `data: null` means this instance is not signed in to an account.
        instance.stats.limited = null;
        instance.stats.lastQuotaError = 'instance is not signed in';
        return null;
      }

      const buckets = data.go || {};
      const limited = [buckets.rolling, buckets.weekly, buckets.monthly].some((b) => b?.limited === true);
      instance.stats.limited = limited;

      const pct = (b) => (b ? `${b.percent}%` : 'n/a');
      if (limited) {
        console.warn(
          `⚠️  ${instance.config.name} is quota-limited (rolling ${pct(buckets.rolling)}, weekly ${pct(buckets.weekly)}, monthly ${pct(buckets.monthly)})`,
        );
      }
      return instance.stats.usage;
    } catch (error) {
      instance.stats.lastQuotaError = error.message;
      console.warn(`⚠️  Could not read usage for ${instance.config.name}: ${error.message}`);
      return null;
    }
  }

  /** Refresh quota for every running instance. */
  async refreshAllQuotas() {
    await Promise.allSettled([...this.instances.keys()].map((port) => this.refreshQuota(port)));
  }

  /** Begin periodic quota polling. Safe to call twice. */
  startQuotaPolling() {
    if (this.quotaTimer) return;
    const interval = this.opencode.quotaPollIntervalMs;
    if (!interval || interval <= 0) return;
    if (this.opencode.quotaSource === 'off' || this.opencode.quotaSource === 'local') return;

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

  async stopInstance(port) {
    const instance = this.instances.get(port);
    if (!instance) return false;

    try {
      instance.child.kill('SIGTERM');
      const exited = await Promise.race([
        new Promise((resolve) => instance.child.once('exit', () => resolve(true))),
        sleep(3000).then(() => false),
      ]);
      if (!exited) instance.child.kill('SIGKILL');
    } catch (error) {
      console.warn(`⚠️  Error stopping ${instance.config.name}: ${error.message}`);
      try {
        instance.child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    }

    this.instances.delete(port);
    return true;
  }

  async stopAll() {
    console.log('\n⏹️  Stopping all instances...\n');
    this.stopQuotaPolling();
    await Promise.allSettled([...this.instances.keys()].map((port) => this.stopInstance(port)));
    console.log('✅ All instances stopped\n');
  }

  getStatus() {
    const status = {
      totalInstances: this.config.instances.length,
      running: this.instances.size,
      instances: [],
    };

    for (const instanceConfig of this.config.instances) {
      const instance = this.instances.get(instanceConfig.port);

      status.instances.push({
        name: instanceConfig.name,
        email: instanceConfig.email || null,
        port: instanceConfig.port,
        enabled: instanceConfig.enabled !== false,
        running: !!instance,
        ready: instance?.ready ?? false,
        quotaPerDay: this.quotaFor({ config: instanceConfig }),
        stats: instance?.stats || null,
      });
    }

    return status;
  }

  resetDailyQuota() {
    console.log('\n🔄 Resetting daily quota counters...');

    for (const instance of this.instances.values()) {
      const before = instance.stats.requestsToday;
      instance.stats.requestsToday = 0;
      instance.stats.lastReset = new Date().toISOString();
      console.log(`  ${instance.config.name}: ${before} requests yesterday`);
    }

    console.log('✅ Quota reset complete\n');
  }

  /**
   * Atomically reserve an instance for one request.
   * The `inFlight` increment happens synchronously, before any await, so two
   * concurrent requests can never be handed the same free slot.
   */
  selectInstance(excludePorts = new Set()) {
    const strategy = this.config.gateway?.selectionStrategy || 'lowest-usage';
    const now = Date.now();
    const candidates = [];

    for (const instance of this.instances.values()) {
      if (!instance.ready) continue;
      if (excludePorts.has(instance.port)) continue;
      if (instance.stats.cooldownUntil > now) continue;
      if (instance.stats.limited === true) continue;

      const used = instance.stats.requestsToday + instance.stats.inFlight;
      if (used >= this.quotaFor(instance)) continue;

      candidates.push({ instance, used });
    }

    if (candidates.length === 0) return null;

    let chosen;
    if (strategy === 'round-robin') {
      chosen = candidates[this.roundRobinIndex % candidates.length].instance;
      this.roundRobinIndex = (this.roundRobinIndex + 1) % candidates.length;
    } else {
      candidates.sort((a, b) => a.used - b.used || a.instance.port - b.instance.port);
      chosen = candidates[0].instance;
    }

    chosen.stats.inFlight++; // reserve before returning
    return chosen;
  }

  /**
   * Release a reservation taken by selectInstance().
   * Must be called exactly once per request, in a `finally` block.
   */
  releaseInstance(instance, { consumed = false, error = null, cooldownMs = 0 } = {}) {
    if (!instance) return;
    const target = this.instances.get(instance.port) || instance;

    target.stats.inFlight = Math.max(0, target.stats.inFlight - 1);
    if (consumed) target.stats.requestsToday++;
    if (error) {
      target.stats.failures++;
      target.stats.lastError = String(error);
    }
    if (cooldownMs > 0) {
      target.stats.cooldownUntil = Date.now() + cooldownMs;
    }
  }
}
