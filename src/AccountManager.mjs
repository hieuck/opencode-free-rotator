#!/usr/bin/env node
/**
 * Automatic Account Manager
 * User clicks "Add Account" → Terminal opens → User connects → Done!
 */

import express from 'express';
import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const app = express();
app.use(express.json());

const DATA_DIR = join(os.homedir(), '.local/share/opencode');
const MANAGER_PORT = 3200;
const SERVER_BASE_PORT = 3201;

// Track running servers
const servers = new Map();
const setupSessions = new Map();

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
          port: SERVER_BASE_PORT + i - 1,
          quotaUsed: 0,
          quotaLimit: 200
        });
      }
    } catch (err) {
      // Skip
    }
  }
  
  return accounts;
}

function startOpenCodeServer(account) {
  if (servers.has(account.id)) {
    return servers.get(account.id);
  }
  
  console.log(`\n🚀 Starting Server ${account.id} (${account.email})...`);
  
  const env = { ...process.env };
  if (account.id > 1) {
    env.OPENCODE_DB = account.dbPath;
  }
  
  const args = account.id > 1
    ? ['-NoProfile', '-Command', `$env:OPENCODE_DB="${account.dbPath}"; opencode serve --port ${account.port} --hostname 127.0.0.1`]
    : ['-NoProfile', '-Command', `opencode serve --port ${account.port} --hostname 127.0.0.1`];
  
  const proc = spawn('powershell.exe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  
  let password = null;
  
  proc.stdout.on('data', (data) => {
    const output = data.toString();
    console.log(`   [Server ${account.id}] ${output.trim()}`);
    const match = output.match(/server password ([^\s]+)/);
    if (match) {
      password = match[1];
      account.password = password;
      console.log(`   ✅ Server ${account.id} ready on port ${account.port}`);
    }
  });
  
  proc.stderr.on('data', (data) => {
    console.log(`   [Server ${account.id} ERROR] ${data.toString().trim()}`);
  });
  
  proc.on('close', (code) => {
    console.log(`   ❌ Server ${account.id} stopped with code ${code}`);
    servers.delete(account.id);
  });
  
  account.process = proc;
  account.url = `http://127.0.0.1:${account.port}`;
  servers.set(account.id, account);
  
  return account;
}

// Get next account slot
function getNextSlot() {
  const accounts = discoverAccounts();
  const usedIds = accounts.map(a => a.id);
  
  for (let i = 1; i <= 3; i++) {
    if (!usedIds.includes(i)) {
      return {
        id: i,
        dbPath: i === 1 
          ? join(DATA_DIR, 'opencode.db')
          : join(DATA_DIR, `db${i}.db`)
      };
    }
  }
  
  return null;
}

/**
 * Add Account - Simple instructions approach
 */
app.post('/accounts/add', (req, res) => {
  const slot = getNextSlot();
  
  if (!slot) {
    return res.status(400).json({ 
      error: 'All 3 account slots are used' 
    });
  }
  
  console.log(`\n🔐 Setup instructions for Account ${slot.id}`);
  console.log(`   Database: ${slot.dbPath}`);
  
  // Generate PowerShell command
  const psCommand = slot.id === 1
    ? 'opencode'
    : `$env:OPENCODE_DB="${slot.dbPath}"; opencode`;
  
  setupSessions.set(slot.id, {
    id: slot.id,
    dbPath: slot.dbPath,
    startedAt: Date.now()
  });
  
  res.json({
    message: `Setup Account ${slot.id}`,
    slot: slot.id,
    database: slot.dbPath,
    powershell_command: psCommand,
    instructions: [
      'Open PowerShell',
      `Run: ${psCommand}`,
      'Type: /connect',
      'Login with your email',
      'Close terminal when done',
      'Refresh this page'
    ]
  });
});

/**
 * Get accounts status
 */
app.get('/accounts', (req, res) => {
  const accounts = discoverAccounts();
  
  // Start servers for new accounts
  accounts.forEach(acc => {
    if (!servers.has(acc.id)) {
      startOpenCodeServer(acc);
    }
  });
  
  res.json({
    accounts: accounts.map(a => ({
      id: a.id,
      email: a.email,
      port: a.port,
      quota: `${a.quotaUsed}/${a.quotaLimit}`,
      status: servers.has(a.id) && servers.get(a.id).password ? 'running' : 'starting'
    })),
    slots_used: accounts.length,
    slots_total: 3,
    total_capacity: accounts.length * 200,
    can_add_more: accounts.length < 3
  });
});

/**
 * Gateway endpoint
 */
app.post('/v1/chat/completions', async (req, res) => {
  const { messages, model = 'opencode/deepseek-v4.1-flash-free' } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: { message: 'Invalid request: messages required' }
    });
  }
  
  const accounts = discoverAccounts();
  
  if (accounts.length === 0) {
    return res.status(503).json({
      error: {
        message: 'No accounts connected',
        instructions: 'Go to http://localhost:3100 and add an account'
      }
    });
  }
  
  // Try servers in order
  for (const account of accounts) {
    const server = servers.get(account.id);
    if (!server || !server.password) continue;
    
    if (account.quotaUsed >= account.quotaLimit) continue;
    
    try {
      const response = await fetch(`${server.url}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${server.password}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ model, messages })
      });
      
      if (!response.ok) {
        const text = await response.text();
        if (response.status === 429) {
          account.quotaUsed = account.quotaLimit;
          continue;
        }
        throw new Error(text);
      }
      
      const data = await response.json();
      account.quotaUsed++;
      
      data._meta = {
        account_id: account.id,
        account_email: account.email,
        quota_remaining: account.quotaLimit - account.quotaUsed
      };
      
      return res.json(data);
      
    } catch (err) {
      continue;
    }
  }
  
  return res.status(429).json({
    error: { message: 'All accounts exhausted' }
  });
});

/**
 * Web UI
 */
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>OpenCode Account Manager</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container { max-width: 800px; margin: 0 auto; }
    .card {
      background: white;
      border-radius: 12px;
      padding: 30px;
      margin-bottom: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    h1 {
      color: #667eea;
      font-size: 2em;
      margin-bottom: 10px;
    }
    .subtitle {
      color: #666;
      margin-bottom: 30px;
    }
    .account-list {
      list-style: none;
    }
    .account-item {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      margin: 15px 0;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .account-item.add-new {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border: none;
      color: white;
      cursor: pointer;
      transition: transform 0.2s;
    }
    .account-item.add-new:hover {
      transform: translateY(-2px);
    }
    .account-info h3 {
      margin-bottom: 5px;
      font-size: 1.2em;
    }
    .account-info p {
      color: #666;
      font-size: 0.9em;
    }
    .account-item.add-new .account-info h3,
    .account-item.add-new .account-info p {
      color: white;
    }
    .badge {
      background: #d4edda;
      color: #155724;
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 600;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
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
    .stat-value {
      font-size: 2.5em;
      font-weight: 700;
    }
    .stat-label {
      font-size: 0.9em;
      opacity: 0.9;
      margin-top: 5px;
    }
    .instructions {
      background: #e7f3ff;
      border-left: 4px solid #2196f3;
      padding: 20px;
      border-radius: 8px;
      margin-top: 20px;
    }
    .instructions h3 {
      color: #1976d2;
      margin-bottom: 10px;
    }
    .instructions ol {
      margin-left: 20px;
      color: #555;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    .loading {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 3px solid rgba(255,255,255,.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h1>🚀 OpenCode Account Manager</h1>
      <p class="subtitle">Automatic account rotation - Up to 600 req/day</p>
      
      <ul class="account-list" id="accounts">
        <li class="account-item add-new" onclick="addAccount()" id="add-btn">
          <div class="account-info">
            <h3>+ Add Account</h3>
            <p>Click to connect a new OpenCode account</p>
          </div>
        </li>
      </ul>
      
      <div class="stats">
        <div class="stat-card">
          <div class="stat-value" id="total-accounts">0</div>
          <div class="stat-label">Accounts</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="total-capacity">0</div>
          <div class="stat-label">Capacity/day</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="slots-left">3</div>
          <div class="stat-label">Slots Left</div>
        </div>
      </div>
    </div>
    
    <div class="card">
      <div class="instructions">
        <h3>✅ How It Works:</h3>
        <ol>
          <li>Click <strong>"Add Account"</strong> above</li>
          <li>Terminal opens → Type <strong>/connect</strong></li>
          <li>Login with your email → Authorize</li>
          <li>Close terminal → Account appears here</li>
          <li>Repeat for more accounts (max 3)</li>
          <li>Use gateway: <code>http://localhost:3100/v1</code></li>
        </ol>
      </div>
    </div>
  </div>
  
  <script>
    let adding = false;
    
    async function loadAccounts() {
      const res = await fetch('/accounts');
      const data = await res.json();
      
      let html = '';
      
      // Show "Add Account" button if slots available
      if (data.can_add_more && !adding) {
        html += \`
          <li class="account-item add-new" onclick="addAccount()">
            <div class="account-info">
              <h3>+ Add Account</h3>
              <p>Click to connect a new OpenCode account</p>
            </div>
          </li>
        \`;
      } else if (adding) {
        html += \`
          <li class="account-item add-new">
            <div class="account-info">
              <h3><span class="loading"></span> Setting up...</h3>
              <p>Complete setup in the terminal window</p>
            </div>
          </li>
        \`;
      }
      
      // Show connected accounts
      data.accounts.forEach(acc => {
        html += \`
          <li class="account-item">
            <div class="account-info">
              <h3>Account \${acc.id}: \${acc.email}</h3>
              <p>Port: \${acc.port} | Quota: \${acc.quota}</p>
            </div>
            <span class="badge">\${acc.status}</span>
          </li>
        \`;
      });
      
      document.getElementById('accounts').innerHTML = html;
      document.getElementById('total-accounts').textContent = data.slots_used;
      document.getElementById('total-capacity').textContent = data.total_capacity;
      document.getElementById('slots-left').textContent = 3 - data.slots_used;
    }
    
    async function addAccount() {
      if (adding) return;
      
      adding = true;
      loadAccounts();
      
      try {
        const res = await fetch('/accounts/add', { method: 'POST' });
        const data = await res.json();
        
        if (!res.ok) {
          alert(data.error || 'Error adding account');
          adding = false;
          loadAccounts();
          return;
        }
        
        // Show instructions modal
        const modal = document.createElement('div');
        modal.style.cssText = \`
          position: fixed;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.8);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        \`;
        
        modal.innerHTML = \\\`
          <div style="background: white; border-radius: 12px; padding: 40px; max-width: 700px;">
            <h2 style="color: #667eea; margin-bottom: 20px;">🔐 Setup Account \\\${data.slot}</h2>
            <p style="color: #666; margin-bottom: 20px;">Follow these steps to connect your account:</p>
            
            <div style="background: #2d2d2d; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <div style="color: #aaa; font-size: 0.85em; margin-bottom: 8px;">PowerShell Command:</div>
              <code style="color: #4af; font-size: 1.1em; font-family: 'Consolas', monospace;">\\\${data.powershell_command}</code>
              <button onclick="navigator.clipboard.writeText('\\\${data.powershell_command}'); this.textContent='✅ Copied!'" 
                      style="margin-left: 15px; background: #667eea; color: white; border: none; padding: 8px 16px; 
                             border-radius: 6px; cursor: pointer; font-size: 0.9em;">
                📋 Copy
              </button>
            </div>
            
            <div style="background: #e7f3ff; border-left: 4px solid #2196f3; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
              <h4 style="color: #1976d2; margin-bottom: 10px;">✅ Steps:</h4>
              <ol style="color: #555; margin-left: 20px; line-height: 1.8;">
                <li>Open <strong>PowerShell</strong></li>
                <li>Copy & paste the command above</li>
                <li>Type: <code>/connect</code></li>
                <li>Click the OAuth link that appears</li>
                <li>Login with your email & authorize</li>
                <li>Close terminal when done</li>
              </ol>
            </div>
            
            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
              <strong style="color: #856404;">⚠️ Important:</strong>
              <p style="color: #856404; margin: 5px 0 0 0; font-size: 0.9em;">
                Use a <strong>different email</strong> for each account (not dungbanemok@gmail.com)
              </p>
            </div>
            
            <button onclick="this.parentElement.parentElement.remove(); location.reload();" 
                    style="width: 100%; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                           color: white; border: none; padding: 15px; border-radius: 8px; 
                           cursor: pointer; font-size: 1.1em; font-weight: 600;">
              ✅ I'm Done - Refresh Page
            </button>
          </div>
        \\\`;
        
        document.body.appendChild(modal);
        
        // Poll for new account
        const pollInterval = setInterval(async () => {
          const statusRes = await fetch('/accounts');
          const statusData = await statusRes.json();
          
          const prevCount = parseInt(document.getElementById('total-accounts').textContent);
          if (statusData.slots_used > prevCount) {
            adding = false;
            clearInterval(pollInterval);
            modal.remove();
            loadAccounts();
            alert('✅ Account added successfully!');
          }
        }, 3000);
        
        // Timeout after 5 minutes
        setTimeout(() => {
          adding = false;
          clearInterval(pollInterval);
        }, 300000);
        
      } catch (err) {
        alert('Error: ' + err.message);
        adding = false;
        loadAccounts();
      }
    }
    
    loadAccounts();
    setInterval(loadAccounts, 5000);
  </script>
</body>
</html>
  `);
});

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🚀 OpenCode Account Manager                              ║
║                                                            ║
║  Automatic Setup - Like Kiro/Codex                        ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Starting...
`);

app.listen(MANAGER_PORT, () => {
  const accounts = discoverAccounts();
  
  // Auto-start servers for existing accounts
  accounts.forEach(acc => {
    startOpenCodeServer(acc);
  });
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  ✅ Account Manager Ready!                                ║
║                                                            ║
║  🎛️  Web UI: http://localhost:${MANAGER_PORT}/                         ║
║  📡 Gateway API: http://localhost:${MANAGER_PORT}/v1                   ║
║                                                            ║
║  📊 Current Accounts: ${accounts.length}/3                             ║
║  📈 Total Capacity: ${accounts.length * 200} req/day                       ║
║                                                            ║
║  💡 Open http://localhost:${MANAGER_PORT} to add accounts!           ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
});
