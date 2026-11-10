import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

/**
 * Raised when an account's credential cannot be turned into a usable bearer token.
 * `code` is stable so callers can decide whether the account is permanently
 * unusable (re-auth needed) or only temporarily unavailable.
 */
export class TokenError extends Error {
  constructor(message, code, detail = null) {
    super(message);
    this.name = 'TokenError';
    this.code = code;
    this.detail = detail;
  }
}

// OpenCode stores the console host in a couple of historical spellings.
const LEGACY_CONSOLE_HOST = /^https:\/\/console\.opencode\.ai(?=\/|$)/;
const DEFAULT_CONSOLE_BASE = 'https://opencode.ai/console';

export const expandHome = (value) =>
  typeof value === 'string' ? value.replace(/^~(?=$|[\\/])/, os.homedir()) : value;

/** Never log a whole credential. */
export function maskToken(token) {
  if (typeof token !== 'string' || token.length === 0) return null;
  if (token.length <= 10) return `${token.slice(0, 3)}…`;
  return `${token.slice(0, 6)}…${token.slice(-4)}`;
}

/** Normalise `metadata.server` into the console base URL used for auth calls. */
export function consoleBase(metadata = {}) {
  const raw = typeof metadata.server === 'string' && metadata.server ? metadata.server : DEFAULT_CONSOLE_BASE;
  return raw.replace(LEGACY_CONSOLE_HOST, DEFAULT_CONSOLE_BASE).replace(/\/+$/, '');
}

/**
 * Loads OpenCode OAuth credentials from one SQLite database per account and
 * hands out short-lived bearer tokens for the hosted API.
 *
 * Design notes:
 *  - OpenCode keeps the token fresh in its own database. We re-read the row on a
 *    short TTL so a token refreshed by `opencode` is picked up automatically.
 *  - When a token is within `refreshSkewMs` of expiry we refresh it ourselves via
 *    the console device-token endpoint and (by default) write the rotated pair
 *    back, otherwise the desktop app would be left holding a dead refresh token.
 *  - The manager never spawns anything and never writes unless a refresh actually
 *    succeeds.
 */
export class TokenManager {
  constructor(accounts = [], options = {}) {
    this.accounts = accounts;
    this.options = {
      cacheTtlMs: 15_000,
      refreshSkewMs: 120_000,
      refreshTimeoutMs: 20_000,
      clientId: 'opencode-cli',
      writeBack: true,
      fetchImpl: globalThis.fetch,
      logger: console,
      ...options,
    };

    this.cache = new Map(); // account name -> { value, readAt }
    this.handles = new Map(); // resolved db path -> Database (read-only)
    this.refreshing = new Map(); // account name -> Promise (refresh de-dupe)
  }

  /** Resolve a usable token for one account, refreshing it when required. */
  async getToken(account, { force = false } = {}) {
    if (!account || !account.name) {
      throw new TokenError('Account is missing a name', 'invalid_account');
    }

    const cached = this.cache.get(account.name);
    if (!force && cached && Date.now() - cached.readAt < this.options.cacheTtlMs) {
      return this.ensureFresh(account, cached.value);
    }

    const value = await this.readCredential(account);
    this.cache.set(account.name, { value, readAt: Date.now() });
    return this.ensureFresh(account, value);
  }

  /** Drop the cached row for an account so the next call re-reads the database. */
  invalidate(account) {
    if (account?.name) this.cache.delete(account.name);
  }

  /** Metadata for /status — never includes the token itself. */
  describe(account) {
    const cached = this.cache.get(account?.name);
    const value = cached?.value;
    return {
      email: value?.email ?? account?.email ?? null,
      orgId: value?.orgId ?? account?.orgId ?? null,
      orgName: value?.orgName ?? null,
      type: value?.type ?? null,
      source: value?.source ?? null,
      expiresAt: value?.expiresAt ?? null,
      expiresInSeconds: value?.expiresAt ? Math.round((value.expiresAt - Date.now()) / 1000) : null,
      refreshable: Boolean(value?.refresh),
      tokenPreview: maskToken(value?.token),
    };
  }

  async ensureFresh(account, value) {
    if (value.type === 'key' || !value.expiresAt) return value;

    const remaining = value.expiresAt - Date.now();
    if (remaining > this.options.refreshSkewMs) return value;

    return this.refresh(account, value);
  }

  async refresh(account, value) {
    const inFlight = this.refreshing.get(account.name);
    if (inFlight) return inFlight;

    const promise = this.performRefresh(account, value).finally(() => this.refreshing.delete(account.name));
    this.refreshing.set(account.name, promise);
    return promise;
  }

  async performRefresh(account, value) {
    if (!value.refresh) {
      throw new TokenError(
        `Credential for "${account.name}" expired at ${new Date(value.expiresAt).toISOString()} and has no refresh token`,
        'expired_no_refresh',
      );
    }

    const url = `${consoleBase(value.metadata)}/auth/device/token`;
    const body = {
      grant_type: 'refresh_token',
      refresh_token: value.refresh,
      client_id: this.options.clientId,
    };

    let response;
    try {
      response = await this.options.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.options.refreshTimeoutMs),
      });
    } catch (error) {
      throw new TokenError(`Token refresh request failed: ${error.message}`, 'refresh_unreachable', error.message);
    }

    const text = await response.text().catch(() => '');
    if (!response.ok) {
      let reason = text.slice(0, 300);
      try {
        reason = JSON.parse(text)?.error_description || JSON.parse(text)?.error || reason;
      } catch {
        /* plain text */
      }
      const code = response.status === 400 || response.status === 401 ? 'reauth_required' : 'refresh_failed';
      throw new TokenError(
        `Token refresh for "${account.name}" failed (HTTP ${response.status}): ${reason}. Re-run \`opencode auth login\` for this account.`,
        code,
        { status: response.status, body: text.slice(0, 500) },
      );
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new TokenError(`Token refresh returned invalid JSON: ${error.message}`, 'refresh_bad_response');
    }

    if (!payload?.access_token) {
      throw new TokenError('Token refresh response is missing access_token', 'refresh_bad_response', payload);
    }

    const expiresIn = Number(payload.expires_in);
    const updated = {
      ...value,
      access: payload.access_token,
      refresh: payload.refresh_token || value.refresh,
      expires: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : value.expires,
      metadata: {
        ...value.metadata,
        ...(payload.org_id ? { orgID: payload.org_id } : {}),
      },
    };

    this.cache.set(account.name, { value: updated, readAt: Date.now() });
    this.options.logger?.log?.(
      `🔑 Refreshed token for ${account.name} (${maskToken(updated.access)}, expires ${new Date(updated.expires).toISOString()})`,
    );

    if (this.options.writeBack && value.dbPath && value.credentialId) {
      await this.writeBack(account, updated, value);
    }

    return updated;
  }

  /**
   * Persist a rotated token pair back into the OpenCode database.
   * Best-effort: a failure leaves the app working with the token we already hold.
   */
  async writeBack(account, updated, previous) {
    let db;
    try {
      db = new Database(previous.dbPath);
      db.pragma('busy_timeout = 5000');
      const record = {
        ...previous.raw,
        access: updated.access,
        refresh: updated.refresh,
        expires: updated.expires,
        metadata: updated.metadata,
      };
      db.prepare('UPDATE credential SET value = ?, time_updated = ? WHERE id = ?').run(
        JSON.stringify(record),
        Date.now(),
        previous.credentialId,
      );
      this.options.logger?.log?.(`💾 Wrote rotated token back to ${previous.dbPath}`);
    } catch (error) {
      this.options.logger?.warn?.(
        `⚠️  Could not write rotated token for ${account.name} back to SQLite: ${error.message}. ` +
          'The gateway keeps using it, but `opencode` may need a fresh login later.',
      );
    } finally {
      try {
        db?.close();
      } catch {
        /* ignore */
      }
    }
  }

  /** Read and normalise the credential row for one account. */
  async readCredential(account) {
    if (account.token) {
      return {
        type: account.tokenType || 'key',
        token: account.token,
        refresh: null,
        expiresAt: null,
        orgId: account.orgId || null,
        orgName: null,
        email: account.email || null,
        metadata: {},
        source: 'config',
        raw: null,
        dbPath: null,
        credentialId: null,
      };
    }

    if (!account.db) {
      throw new TokenError(`Account "${account.name}" needs either "db" or "token"`, 'invalid_account');
    }

    const dbPath = expandHome(account.db);
    if (!fs.existsSync(dbPath)) {
      throw new TokenError(`Credential database not found for "${account.name}": ${dbPath}`, 'db_unavailable');
    }

    const integrationId = account.integrationId || 'opencode';
    let row;
    try {
      const db = this.openHandle(dbPath);
      row = db
        .prepare(
          `SELECT id, label, value FROM credential
             WHERE integration_id = ?
               AND (active IS NULL OR active = 1)
             ORDER BY COALESCE(time_updated, 0) DESC, rowid DESC
             LIMIT 1`,
        )
        .get(integrationId);
    } catch (error) {
      throw new TokenError(`Could not read credentials from ${dbPath}: ${error.message}`, 'db_unavailable', error.message);
    }

    if (!row) {
      throw new TokenError(
        `No "${integrationId}" credential in ${dbPath}. Run \`opencode auth login\` for this account.`,
        'missing_credential',
      );
    }

    let parsed;
    try {
      parsed = JSON.parse(row.value);
    } catch (error) {
      throw new TokenError(`Credential ${row.id} in ${dbPath} is not valid JSON: ${error.message}`, 'malformed_credential');
    }

    const metadata = parsed?.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {};

    if (parsed?.type === 'key') {
      if (!parsed.key) throw new TokenError(`Credential ${row.id} is a key credential without "key"`, 'malformed_credential');
      return {
        type: 'key',
        token: parsed.key,
        refresh: null,
        expiresAt: null,
        orgId: typeof metadata.orgID === 'string' ? metadata.orgID : account.orgId || null,
        orgName: typeof metadata.orgName === 'string' ? metadata.orgName : null,
        email: typeof metadata.email === 'string' ? metadata.email : row.label || account.email || null,
        metadata,
        source: dbPath,
        raw: parsed,
        dbPath,
        credentialId: row.id,
      };
    }

    if (!parsed?.access) {
      throw new TokenError(
        `Credential ${row.id} in ${dbPath} has no access token (type: ${parsed?.type ?? 'unknown'})`,
        'malformed_credential',
      );
    }

    return {
      type: 'oauth',
      token: parsed.access,
      refresh: parsed.refresh || null,
      expiresAt: Number.isFinite(parsed.expires) ? parsed.expires : null,
      orgId: typeof metadata.orgID === 'string' ? metadata.orgID : account.orgId || null,
      orgName: typeof metadata.orgName === 'string' ? metadata.orgName : null,
      email: typeof metadata.email === 'string' ? metadata.email : row.label || account.email || null,
      metadata,
      source: dbPath,
      raw: parsed,
      dbPath,
      credentialId: row.id,
    };
  }

  openHandle(dbPath) {
    let handle = this.handles.get(dbPath);
    if (!handle) {
      handle = new Database(dbPath, { readonly: true, fileMustExist: true });
      this.handles.set(dbPath, handle);
    }
    return handle;
  }

  close() {
    for (const handle of this.handles.values()) {
      try {
        handle.close();
      } catch {
        /* ignore */
      }
    }
    this.handles.clear();
    this.cache.clear();
  }
}

export default TokenManager;
