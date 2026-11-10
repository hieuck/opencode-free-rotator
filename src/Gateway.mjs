import http from 'http';
import { InstanceManager } from './InstanceManager.mjs';

/**
 * Gateway proxy that forwards requests to OpenCode instances
 */
export class Gateway {
  constructor(configPath) {
    this.manager = new InstanceManager(configPath);
    this.server = null;
  }

  /**
   * Start gateway server
   */
  async start() {
    // Start all instances first
    await this.manager.startAll();

    // Create HTTP server
    const { host, port } = this.manager.config.gateway;
    
    this.server = http.createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });

    this.server.listen(port, host, () => {
      console.log(`\n🌐 Gateway listening on http://${host}:${port}`);
      console.log(`📊 Forwarding to ${this.manager.instances.size} instances\n`);
    });

    // Setup daily quota reset
    this.setupDailyReset();
  }

  /**
   * Handle incoming request
   */
  async handleRequest(req, res) {
    const startTime = Date.now();

    // Only handle /v1/chat/completions
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') {
      // Pass through other endpoints (health, models, etc.)
      if (req.url === '/health') {
        return this.handleHealth(req, res);
      }
      if (req.url === '/status') {
        return this.handleStatus(req, res);
      }
      
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }

    // Read request body
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body);
        
        // Forward to selected instance
        const result = await this.forwardRequest(requestData, req.headers);
        
        if (result.success) {
          const duration = Date.now() - startTime;
          
          // Log request
          if (this.manager.config.logging?.logRequests) {
            console.log(`✅ [${result.instance.config.name}] ${requestData.model} - ${duration}ms`);
          }
          
          // Return response
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result.data));
        } else {
          // All instances failed or exhausted
          console.error(`❌ Request failed: ${result.error}`);
          
          res.writeHead(result.statusCode || 503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: {
              message: result.error,
              type: 'gateway_error',
              code: result.code || 'all_instances_unavailable',
            },
          }));
        }
      } catch (error) {
        console.error('❌ Gateway error:', error.message);
        
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: {
            message: 'Internal gateway error',
            type: 'gateway_error',
          },
        }));
      }
    });
  }

  /**
   * Forward request to selected instance with retry
   */
  async forwardRequest(requestData, headers) {
    const { retryOnFailure, maxRetries, requestTimeout } = this.manager.config.gateway;
    const attempts = retryOnFailure ? maxRetries : 1;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Select instance with available quota
      const instance = this.manager.selectInstance();
      
      if (!instance) {
        return {
          success: false,
          error: 'All instances have exhausted their daily quota (200 requests/day)',
          code: 'quota_exhausted',
          statusCode: 429,
        };
      }

      try {
        // Forward to instance
        const response = await fetch(
          `http://127.0.0.1:${instance.config.port}/v1/chat/completions`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': headers.authorization || '',
            },
            body: JSON.stringify(requestData),
            signal: AbortSignal.timeout(requestTimeout || 60000),
          }
        );

        if (response.ok) {
          const data = await response.json();
          
          // Increment request count
          this.manager.incrementRequests(instance.config.port);
          
          return {
            success: true,
            instance,
            data,
          };
        }

        // Non-200 response
        const errorText = await response.text();
        console.warn(`⚠️  Instance ${instance.config.name} returned ${response.status}: ${errorText}`);
        
        // If quota exceeded (429), try next instance
        if (response.status === 429) {
          console.warn(`⚠️  Instance ${instance.config.name} quota exceeded, trying next...`);
          continue;
        }

        // Other errors - return immediately
        return {
          success: false,
          error: errorText || `Instance returned ${response.status}`,
          statusCode: response.status,
        };

      } catch (error) {
        console.error(`❌ Instance ${instance.config.name} error:`, error.message);
        
        // If this was last attempt, return error
        if (attempt === attempts) {
          return {
            success: false,
            error: `All instances failed: ${error.message}`,
            statusCode: 503,
          };
        }
        
        // Otherwise try next instance
        console.log(`   Retrying with next instance (${attempt}/${attempts})...`);
      }
    }

    return {
      success: false,
      error: 'All retry attempts failed',
      statusCode: 503,
    };
  }

  /**
   * Handle /health endpoint
   */
  handleHealth(req, res) {
    const status = this.manager.getStatus();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      gateway: {
        running: status.running,
        total: status.totalInstances,
      },
      instances: status.instances.map(i => ({
        name: i.name,
        running: i.running,
        quota: i.stats ? `${i.stats.requestsToday}/${this.manager.config.instances.find(c => c.port === i.port).quotaPerDay}` : 'N/A',
      })),
    }));
  }

  /**
   * Handle /status endpoint (detailed)
   */
  handleStatus(req, res) {
    const status = this.manager.getStatus();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status, null, 2));
  }

  /**
   * Setup daily quota reset
   */
  setupDailyReset() {
    const resetHour = this.manager.config.gateway.quotaResetHour;
    
    const now = new Date();
    const nextReset = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      resetHour,
      0,
      0
    ));
    
    if (nextReset <= now) {
      nextReset.setUTCDate(nextReset.getUTCDate() + 1);
    }
    
    const msUntilReset = nextReset - now;
    
    console.log(`⏰ Next quota reset: ${nextReset.toISOString()} (in ${Math.round(msUntilReset / 1000 / 3600)} hours)\n`);
    
    setTimeout(() => {
      this.manager.resetDailyQuota();
      
      setInterval(() => {
        this.manager.resetDailyQuota();
      }, 24 * 60 * 60 * 1000);
    }, msUntilReset);
  }

  /**
   * Stop gateway and all instances
   */
  async stop() {
    console.log('\n⏹️  Stopping gateway...\n');
    
    if (this.server) {
      this.server.close();
    }
    
    await this.manager.stopAll();
  }
}
