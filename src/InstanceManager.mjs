import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'yaml';

/**
 * Manages multiple OpenCode server instances
 */
export class InstanceManager {
  constructor(configPath) {
    this.configPath = configPath;
    this.config = null;
    this.instances = new Map(); // port -> { process, config, stats }
    this.loadConfig();
  }

  loadConfig() {
    const configFile = fs.readFileSync(this.configPath, 'utf8');
    this.config = yaml.parse(configFile);
    console.log(`✅ Loaded config with ${this.config.instances.length} instances`);
  }

  /**
   * Start all enabled instances
   */
  async startAll() {
    console.log('\n🚀 Starting OpenCode instances...\n');
    
    const enabled = this.config.instances.filter(i => i.enabled);
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
    results.forEach(r => {
      const icon = r.status === 'started' ? '✅' : '❌';
      console.log(`  ${icon} ${r.name}: ${r.status}`);
      if (r.error) console.log(`      Error: ${r.error}`);
    });

    return results;
  }

  /**
   * Start single instance
   */
  async startInstance(instanceConfig) {
    const { name, port, db, email } = instanceConfig;

    // Expand ~ in db path
    const dbPath = db.replace(/^~/, os.homedir());
    const dbDir = path.dirname(dbPath);

    // Create DB directory if not exists
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
      console.log(`📁 Created DB directory: ${dbDir}`);
    }

    console.log(`⏳ Starting: ${name} (${email})`);
    console.log(`   Port: ${port}`);
    console.log(`   DB: ${dbPath}`);

    // Start OpenCode server
    const process = spawn('opencode', ['server', '--port', port.toString()], {
      env: {
        ...process.env,
        OPENCODE_DB: dbPath,
      },
      stdio: 'pipe', // Capture output
      detached: false,
    });

    // Store instance
    this.instances.set(port, {
      process,
      config: instanceConfig,
      stats: {
        requestsToday: 0,
        lastReset: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      },
    });

    // Handle output
    process.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[${name}] ${msg}`);
    });

    process.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.error(`[${name}] ⚠️  ${msg}`);
    });

    process.on('exit', (code) => {
      console.log(`[${name}] Process exited with code ${code}`);
      this.instances.delete(port);
    });

    // Wait for server to be ready (health check)
    await this.waitForHealth(port, name);

    console.log(`✅ Started: ${name}\n`);
  }

  /**
   * Wait for instance health endpoint
   */
  async waitForHealth(port, name, maxAttempts = 30, intervalMs = 1000) {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(2000),
        });
        
        if (response.ok) {
          return true;
        }
      } catch (error) {
        // Ignore, retry
      }

      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }

    throw new Error(`${name} did not become healthy after ${maxAttempts} attempts`);
  }

  /**
   * Stop all instances
   */
  async stopAll() {
    console.log('\n⏹️  Stopping all instances...\n');

    for (const [port, { process, config }] of this.instances) {
      console.log(`⏳ Stopping: ${config.name}`);
      process.kill('SIGTERM');
    }

    // Wait for all to exit
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('✅ All instances stopped\n');
  }

  /**
   * Get instance status
   */
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
        email: instanceConfig.email,
        port: instanceConfig.port,
        enabled: instanceConfig.enabled,
        running: !!instance,
        stats: instance?.stats || null,
      });
    }

    return status;
  }

  /**
   * Increment request count for instance
   */
  incrementRequests(port) {
    const instance = this.instances.get(port);
    if (instance) {
      instance.stats.requestsToday++;
      
      // Check if quota exceeded
      const quota = instance.config.quotaPerDay;
      if (instance.stats.requestsToday >= quota) {
        console.warn(`⚠️  ${instance.config.name} quota exceeded: ${instance.stats.requestsToday}/${quota}`);
      }
    }
  }

  /**
   * Reset daily quota counters (called at midnight UTC)
   */
  resetDailyQuota() {
    console.log('\n🔄 Resetting daily quota counters...');
    
    for (const [port, instance] of this.instances) {
      const before = instance.stats.requestsToday;
      instance.stats.requestsToday = 0;
      instance.stats.lastReset = new Date().toISOString();
      
      console.log(`  ${instance.config.name}: ${before} requests yesterday`);
    }
    
    console.log('✅ Quota reset complete\n');
  }

  /**
   * Get instance with available quota (selection strategy)
   */
  selectInstance() {
    const strategy = this.config.gateway.selectionStrategy;
    const available = Array.from(this.instances.values())
      .filter(i => i.stats.requestsToday < i.config.quotaPerDay);

    if (available.length === 0) {
      return null; // All instances exhausted
    }

    if (strategy === 'lowest-usage') {
      // Select instance with lowest usage
      available.sort((a, b) => a.stats.requestsToday - b.stats.requestsToday);
      return available[0];
    } else {
      // Round-robin: just pick first available
      return available[0];
    }
  }
}
