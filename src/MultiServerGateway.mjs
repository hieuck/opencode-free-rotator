#!/usr/bin/env node
/**
 * Multi-Account OpenCode Gateway - CORRECT PATTERN
 * 
 * Pattern: Like Kiro/Codex
 * - Each account = 1 OpenCode server instance
 * - Each server uses different database
 * - Gateway load-balances between servers
 * 
 * User Flow:
 * 1. Connect accounts manually (once):
 *    - Account 1: opencode → /connect → dungbanemok@gmail.com
 *    - Account 2: OPENCODE_DB=db2.db opencode → /connect → hieuck.dev@gmail.com
 *    - Account 3: OPENCODE_DB=db3.db opencode → /connect → other@gmail.com
 * 
 * 2. Gateway starts multiple OpenCode servers:
 *    - Server 1: opencode serve --port 3091 (uses opencode.db)
 *    - Server 2: OPENCODE_DB=db2.db opencode serve --port 3092
 *    - Server 3: OPENCODE_DB=db3.db opencode serve --port 3093
 * 
 * 3. Gateway rotates requests between servers automatically!
 */

import express from 'express';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { existsSync } from 'fs';
// Node v18+ has native fetch

const app = express();
app.use(express.json());

const DATA_DIR = join(os.homedir(), '.local/share/opencode');
const GATEWAY_PORT = 3000;
const SERVER_BASE_PORT = 3091;

// Server pool - each account runs its own OpenCode server
const servers = [];

/**
 * Discover authenticated accounts from databases
 */
function discoverAccounts() {
  const accounts = [];
  
  for (let i = 1; i <= 3; i++) {
    const dbPath = i === 1 
      ? join(DATA_DIR, 'opencode.db')
      : join(DATA_DIR, `db${i}.db`);
    
    if (!existsSync(dbPath)) continue;
    
    try {
      const db = new Database(dbPath, { readonly: true });
      const cred = db.prepare(`
        SELECT * FROM credential 
        WHERE integration_id = 'opencode'
        ORDER BY time_created DESC LIMIT 1
      `).get();
      db.close();
      
      if (cred) {
        const value = JSON.parse(cred.value);
        accounts.push({
          id: i,
          dbPath,
          email: value.metadata?.email || 'Unknown',
          accountID: value.metadata?.accountID || 'Unknown',
          port: SERVER_BASE_PORT + i - 1,
          quotaUsed: 0,
          quotaLimit: 200,
          active: true
        });
      }
    } catch (err) {
      console.log(`⚠️  Error reading ${dbPath}:`, err.message);
    }
  }
  
  return accounts;
}

/**
 * Start OpenCode server for an account
 */
function startOpenCodeServer(account) {
  console.log(`\n🚀 Starting OpenCode server for Account ${account.id}...`);
  console.log(`   Email: ${account.email}`);
  console.log(`   Database: ${account.dbPath}`);
  console.log(`   Port: ${account.port}`);
  
  const isWindows = process.platform === 'win32';
  const env = { ...process.env };
  
  if (account.id > 1) {
    env.OPENCODE_DB = account.dbPath;
  }
  
  const proc = isWindows
    ? spawn('powershell.exe', [
        '-NoProfile', '-Command',
        account.id > 1 
          ? `$env:OPENCODE_DB="${account.dbPath}"; opencode serve --port ${account.port} --hostname 127.0.0.1`
          : `opencode serve --port ${account.port} --hostname 127.0.0.1`
      ], { stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn('opencode', ['serve', '--port', account.port.toString(), '--hostname', '127.0.0.1'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
  
  let password = null;
  
  proc.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`   [Server ${account.id}] ${output.trim()}`);
    
    // Extract password
    const match = output.match(/server password ([^\s]+)/);
    if (match) {
      password = match[1];
      account.password = password;
      console.log(`   ✅ Server ${account.id} ready with password`);
    }
  });
  
  proc.stderr.on('data', (data) => {
    console.log(`   [Server ${account.id} ERROR] ${data.toString().trim()}`);
  });
  
  proc.on('close', (code) => {
    console.log(`   ❌ Server ${account.id} exited with code ${code}`);
    account.active = false;
  });
  
  account.process = proc;
  account.url = `http://127.0.0.1:${account.port}`;
  
  return account;
}

/**
 * Call OpenCode server with rotation
 */
async function callOpenCodeServer(account, model, messages) {
  if (!account.password) {
    throw new Error(`Server ${account.id} not ready (no password)`);
  }
  
  console.log(`   🔧 Using Server ${account.id} (${account.email})`);
  console.log(`   📊 Quota: ${account.quotaUsed}/${account.quotaLimit}`);
  
  const response = await fetch(`${account.url}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${account.password}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ model, messages })
  });
  
  if (!response.ok) {
    const text = await response.text();
    
    if (response.status === 429 || text.includes('limit') || text.includes('quota')) {
      account.quotaUsed = account.quotaLimit;
      account.active = false;
      throw { type: 'quota_exceeded', message: text };
    }
    
    throw { type: 'error', message: text, status: response.status };
  }
  
  const data = await response.json();
  account.quotaUsed++;
  
  return data;
}

/**
 * Main gateway endpoint
 */
app.post('/v1/chat/completions', async (req, res) => {
  const { messages, model = 'opencode/deepseek-v4.1-flash-free' } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: { message: 'Invalid request: messages required', type: 'invalid_request_error' }
    });
  }
  
  const prompt = messages[messages.length - 1].content;
  console.log(`\n📨 Request: ${prompt.substring(0, 50)}...`);
  
  if (servers.length === 0) {
    return res.status(503).json({
      error: {
        message: 'No servers running',
        type: 'service_unavailable',
        instructions: 'Connect accounts and restart gateway'
      }
    });
  }
  
  // Try servers in order
  for (const server of servers) {
    if (!server.active || server.quotaUsed >= server.quotaLimit) {
      console.log(`   ⏭️  Skip Server ${server.id} (exhausted or inactive)`);
      continue;
    }
    
    try {
      const result = await callOpenCodeServer(server, model, messages);
      console.log(`   ✅ Success with Server ${server.id}`);
      
      // Add metadata
      result._meta = {
        account_id: server.id,
        account_email: server.email,
        quota_remaining: server.quotaLimit - server.quotaUsed
      };
      
      return res.json(result);
      
    } catch (err) {
      console.log(`   ❌ Server ${server.id}: ${err.type || err.message}`);
      
      if (err.type === 'quota_exceeded') {
        continue;
      } else {
        break;
      }
    }
  }
  
  return res.status(429).json({
    error: {
      message: 'All servers exhausted',
      type: 'rate_limit_error',
      pool_status: servers.map(s => ({
        id: s.id,
        email: s.email,
        quota: `${s.quotaUsed}/${s.quotaLimit}`,
        active: s.active
      }))
    }
  });
});

app.get('/pool', (req, res) => {
  res.json({
    servers: servers.map(s => ({
      id: s.id,
      email: s.email,
      port: s.port,
      url: s.url,
      quota: `${s.quotaUsed}/${s.quotaLimit}`,
      active: s.active,
      status: s.active && s.quotaUsed < s.quotaLimit ? 'available' : 'exhausted'
    })),
    total_capacity: servers.length * 200,
    used_capacity: servers.reduce((sum, s) => sum + s.quotaUsed, 0)
  });
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Multi-Server Gateway</title>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 900px; margin: 0 auto; }
    .header {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    h1 { color: #667eea; font-size: 2em; margin-bottom: 10px; }
    .server {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      margin: 15px 0;
      border-radius: 8px;
    }
    .server.exhausted { border-left-color: #dc3545; opacity: 0.6; }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 15px;
      margin-top: 20px;
    }
    .stat-card {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 20px;
      border-radius: 8px;
      text-align: center;
    }
    .stat-value { font-size: 2.5em; font-weight: 700; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Multi-Server Gateway</h1>
      <p>Each account = 1 OpenCode server instance</p>
    </div>
    
    <div style="background: white; border-radius: 12px; padding: 25px; box-shadow: 0 10px 30px rgba(0,0,0,0.2);">
      <h2>Running Servers</h2>
      <div id="servers"></div>
      
      <div class="stats">
        <div class="stat-card">
          <div class="stat-value" id="total">${servers.length}</div>
          <div>Servers</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="capacity">${servers.length * 200}</div>
          <div>Total Capacity</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="used">${servers.reduce((sum, s) => sum + s.quotaUsed, 0)}</div>
          <div>Used Today</div>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    async function loadServers() {
      const res = await fetch('/pool');
      const data = await res.json();
      
      let html = '';
      data.servers.forEach(s => {
        html += \`
          <div class="server \${s.status === 'exhausted' ? 'exhausted' : ''}">
            <div><strong>Server \${s.id}:</strong> \${s.email}</div>
            <div>Port: \${s.port} | Quota: \${s.quota} | Status: \${s.status}</div>
          </div>
        \`;
      });
      
      document.getElementById('servers').innerHTML = html || '<div>No servers running</div>';
      document.getElementById('total').textContent = data.servers.length;
      document.getElementById('capacity').textContent = data.total_capacity;
      document.getElementById('used').textContent = data.used_capacity;
    }
    
    loadServers();
    setInterval(loadServers, 5000);
  </script>
</body>
</html>
  `);
});

// Initialize
console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🚀 Multi-Server Gateway - Like Kiro/Codex                ║
║                                                            ║
║  Pattern: Each account = 1 OpenCode server                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

console.log('\n🔍 Discovering accounts...');
const accounts = discoverAccounts();

console.log(`\n📊 Found ${accounts.length} authenticated account(s):`);
accounts.forEach(a => {
  console.log(`   Account ${a.id}: ${a.email}`);
});

if (accounts.length === 0) {
  console.log(`
❌ No accounts found!

Setup accounts first:
1. Account 1: opencode → /connect → email1@gmail.com
2. Account 2: $env:OPENCODE_DB="${join(DATA_DIR, 'db2.db')}"; opencode → /connect → email2@gmail.com
3. Account 3: $env:OPENCODE_DB="${join(DATA_DIR, 'db3.db')}"; opencode → /connect → email3@gmail.com

Then restart gateway.
  `);
  process.exit(1);
}

// Start OpenCode servers for each account
console.log('\n🚀 Starting OpenCode servers...');
for (const account of accounts) {
  const server = startOpenCodeServer(account);
  servers.push(server);
}

// Wait for servers to be ready
setTimeout(() => {
  const readyServers = servers.filter(s => s.password);
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  ✅ Gateway Ready!                                        ║
║                                                            ║
║  📡 API: http://localhost:${GATEWAY_PORT}/v1/chat/completions          ║
║  🎛️  Web UI: http://localhost:${GATEWAY_PORT}/                         ║
║                                                            ║
║  🔧 Servers: ${readyServers.length}/${servers.length}                                      ║
║  📈 Capacity: ${readyServers.length * 200} req/day                              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
  
  // Start gateway
  app.listen(GATEWAY_PORT, () => {
    console.log(`🎉 Multi-Server Gateway running!\n`);
  });
}, 5000); // Wait 5s for servers to start
