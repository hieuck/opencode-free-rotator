#!/usr/bin/env node
/**
 * Proxy Pool Manager
 * Manages a pool of SOCKS5/HTTP proxies for IP rotation
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import os from 'os';

const PROXY_POOL_FILE = join(os.homedir(), '.config/opencode-rotator/proxy-pool.json');

class ProxyPoolManager {
  constructor() {
    this.proxies = [];
    this.currentIndex = 0;
    this.load();
  }

  load() {
    try {
      if (existsSync(PROXY_POOL_FILE)) {
        const data = JSON.parse(readFileSync(PROXY_POOL_FILE, 'utf8'));
        this.proxies = data.proxies || [];
        this.currentIndex = data.currentIndex || 0;
      }
    } catch (err) {
      console.error('Failed to load proxy pool:', err.message);
      this.proxies = [];
    }
  }

  save() {
    try {
      const dir = join(os.homedir(), '.config/opencode-rotator');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      writeFileSync(PROXY_POOL_FILE, JSON.stringify({
        proxies: this.proxies,
        currentIndex: this.currentIndex,
        lastUpdated: new Date().toISOString()
      }, null, 2));
    } catch (err) {
      console.error('Failed to save proxy pool:', err.message);
    }
  }

  // Add proxy: socks5://host:port or http://user:pass@host:port
  add(proxyUrl) {
    if (!proxyUrl || typeof proxyUrl !== 'string') {
      throw new Error('Invalid proxy URL');
    }

    // Parse proxy URL
    const parsed = this._parseProxy(proxyUrl);
    
    // Check if already exists
    const exists = this.proxies.some(p => 
      p.host === parsed.host && p.port === parsed.port
    );

    if (exists) {
      throw new Error('Proxy already exists in pool');
    }

    this.proxies.push({
      ...parsed,
      addedAt: new Date().toISOString(),
      health: {
        lastChecked: null,
        latency: null,
        failures: 0,
        quarantineUntil: null
      }
    });

    this.save();
    return parsed;
  }

  _parseProxy(url) {
    // Format: protocol://[user:pass@]host:port
    const match = url.match(/^(socks5|http):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/);
    
    if (!match) {
      throw new Error('Invalid proxy format. Use: socks5://host:port or http://user:pass@host:port');
    }

    return {
      protocol: match[1],
      username: match[2] || null,
      password: match[3] || null,
      host: match[4],
      port: parseInt(match[5])
    };
  }

  // Get next available proxy
  next() {
    if (this.proxies.length === 0) {
      return null;
    }

    // Filter out quarantined proxies
    const now = Date.now();
    const available = this.proxies.filter(p => 
      !p.health.quarantineUntil || new Date(p.health.quarantineUntil).getTime() < now
    );

    if (available.length === 0) {
      // All proxies quarantined, return least recently quarantined
      const sorted = [...this.proxies].sort((a, b) => 
        new Date(a.health.quarantineUntil).getTime() - new Date(b.health.quarantineUntil).getTime()
      );
      return sorted[0];
    }

    // Sort by health: healthy fast first, then untested, then slow
    const sorted = available.sort((a, b) => {
      // Healthy (0 failures) and fast
      if (a.health.failures === 0 && b.health.failures === 0) {
        return (a.health.latency || 9999) - (b.health.latency || 9999);
      }
      
      // Prefer 0 failures
      if (a.health.failures !== b.health.failures) {
        return a.health.failures - b.health.failures;
      }
      
      // Same failure count, prefer faster
      return (a.health.latency || 9999) - (b.health.latency || 9999);
    });

    this.currentIndex = (this.currentIndex + 1) % sorted.length;
    return sorted[this.currentIndex];
  }

  // Mark proxy as failed
  recordFailure(proxy) {
    const p = this._findProxy(proxy);
    if (!p) return;

    p.health.failures++;
    p.health.lastChecked = new Date().toISOString();

    // Quarantine after 2 failures: 5 min, then doubles up to 6 hours
    if (p.health.failures >= 2) {
      const minutes = Math.min(5 * Math.pow(2, p.health.failures - 2), 360);
      const quarantineUntil = new Date(Date.now() + minutes * 60 * 1000);
      p.health.quarantineUntil = quarantineUntil.toISOString();
    }

    this.save();
  }

  // Mark proxy as healthy
  recordSuccess(proxy, latency) {
    const p = this._findProxy(proxy);
    if (!p) return;

    p.health.failures = 0;
    p.health.latency = latency;
    p.health.lastChecked = new Date().toISOString();
    p.health.quarantineUntil = null;

    this.save();
  }

  _findProxy(proxy) {
    return this.proxies.find(p => 
      p.host === proxy.host && p.port === proxy.port
    );
  }

  // List all proxies
  list() {
    return this.proxies.map((p, i) => ({
      index: i,
      url: this._formatProxyUrl(p),
      host: p.host,
      port: p.port,
      protocol: p.protocol,
      health: p.health,
      current: i === this.currentIndex
    }));
  }

  _formatProxyUrl(proxy) {
    let url = `${proxy.protocol}://`;
    if (proxy.username && proxy.password) {
      url += `${proxy.username}:${proxy.password}@`;
    }
    url += `${proxy.host}:${proxy.port}`;
    return url;
  }

  // Remove proxy
  remove(index) {
    if (index < 0 || index >= this.proxies.length) {
      throw new Error('Invalid proxy index');
    }

    this.proxies.splice(index, 1);
    this.currentIndex = Math.min(this.currentIndex, this.proxies.length - 1);
    this.save();
  }

  // Clear all proxies
  clear() {
    this.proxies = [];
    this.currentIndex = 0;
    this.save();
  }

  // Get environment variables for spawning OpenCode with proxy
  getProxyEnv(proxy) {
    if (!proxy) return {};

    const url = this._formatProxyUrl(proxy);
    
    return {
      HTTP_PROXY: url,
      HTTPS_PROXY: url,
      http_proxy: url,
      https_proxy: url
    };
  }
}

export default ProxyPoolManager;
