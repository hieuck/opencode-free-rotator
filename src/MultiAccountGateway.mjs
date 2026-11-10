#!/usr/bin/env node
/**
 * OpenCode Multi-Account Gateway
 * Like Kiro/Codex - Pool of accounts with auto-rotation
 * 
 * Setup Flow:
 * 1. User starts gateway
 * 2. Gateway shows which accounts need setup
 * 3. User clicks "Setup Account X" → Opens OpenCode
 * 4. User connects → Account added to pool
 * 5. Gateway rotates automatically!
 */

import express from 'express';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { existsSync } from 'fs';

const app = express();
app.use(express.json());

const DATA_DIR = join(os.homedir(), '.local/share/opencode');
const TOTAL_ACCOUNTS = 3; // Support up to 3 accounts

// Account pool (like Kiro/Codex)
const accountPool = [];

/**
 * Load all authenticated accounts from disk
 */
function loadAccountPool() {
  accountPool.length = 0;
  
  // Account 1: opencode.db (main)
  const db1Path = join(DATA_DIR, 'opencode.db');
  if (existsSync(db1Path)) {
    try {
      const db = new Database(db1Path, { readonly: true });
      const cred = db.prepare(`
        SELECT * FROM credential 
        WHERE integration_id = 'opencode'
        ORDER BY time_created DESC LIMIT 1
      `).get();
      db.close();
      
      if (cred) {
        const value = JSON.parse(cred.value);
        accountPool.push({
          id: 1,
          name: 'Account 1',
          dbPath: db1Path,
          email: value.metadata?.email || 'Unknown',
          accountID: value.metadata?.accountID || 'Unknown',
          requestCount: 0,
          quotaUsed: 0,
          quotaLimit: 200,
          active: true
        });
      }
    } catch (err) {
      console.log('⚠️  Account 1 error:', err.message);
    }
  }
  
  // Accounts 2-3: db2.db, db3.db
  for (let i = 2; i <= TOTAL_ACCOUNTS; i++) {
    const dbPath = join(DATA_DIR, `db${i}.db`);
    
    if (existsSync(dbPath)) {
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
          accountPool.push({
            id: i,
            name: `Account ${i}`,
            dbPath,
            email: value.metadata?.email || 'Unknown',
            accountID: value.metadata?.accountID || 'Unknown',
            requestCount: 0,
            quotaUsed: 0,
            quotaLimit: 200,
            active: true
          });
        }
      } catch (err) {
        // db exists but not authenticated yet
      }
    }
  }
  
  console.log(`✅ Loaded ${accountPool.length} account(s) in pool`);
  accountPool.forEach(a => {
    console.log(`   ${a.name}: ${a.email}`);
  });
}

loadAccountPool();

/**
 * Get next available account from pool (round-robin)
 */
function getNextAccount() {
  const available = accountPool.filter(a => a.active && a.quotaUsed < a.quotaLimit);
  
  if (available.length === 0) {
    return null;
  }
  
  // Return account with lowest usage
  return available.reduce((prev, curr) => 
    prev.quotaUsed <= curr.quotaUsed ? prev : curr
  );
}

/**
 * Call OpenCode with specific account
 */
async function callOpenCodeWithAccount(account, model, prompt) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    
    console.log(`   🔧 Using ${account.name} (${account.email})`);
    console.log(`   📊 Quota: ${account.quotaUsed}/${account.quotaLimit}`);
    
    const proc = isWindows
      ? spawn('powershell.exe', [
          '-NoProfile', '-Command',
          `$env:OPENCODE_DB="${account.dbPath}"; opencode run "${prompt.replace(/"/g, '\\"')}" --model ${model}`
        ], { stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn('opencode', ['run', prompt, '--model', model], {
          env: { ...process.env, OPENCODE_DB: account.dbPath },
          stdio: ['pipe', 'pipe', 'pipe']
        });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        account.requestCount++;
        account.quotaUsed++;
        resolve({ content: stdout.trim(), account: account.name });
      } else {
        if (stderr.includes('limit') || stderr.includes('quota')) {
          account.active = false;
          account.quotaUsed = account.quotaLimit;
          reject({ type: 'quota_exceeded', message: stderr, account: account.name });
        } else {
          reject({ type: 'error', message: stderr, account: account.name });
        }
      }
    });
  });
}

/**
 * Main chat endpoint with rotation
 */
app.post('/v1/chat/completions', async (req, res) => {
  const { messages, model = 'opencode/deepseek-v4.1-flash-free' } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: { message: 'Invalid request: messages required', type: 'invalid_request_error' }
    });
  }
  
  const prompt = messages[messages.length - 1].content;
  
  console.log(`\\n📨 Request: ${prompt.substring(0, 50)}...`);
  console.log(`   Model: ${model}`);
  
  // Try accounts from pool
  let lastError = null;
  
  for (const account of accountPool) {
    if (!account.active || account.quotaUsed >= account.quotaLimit) {
      console.log(`   ⏭️  Skip ${account.name} (exhausted or inactive)`);
      continue;
    }
    
    try {
      const result = await callOpenCodeWithAccount(account, model, prompt);
      
      console.log(`   ✅ Success with ${account.name}`);
      
      return res.json({
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: result.content },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: Math.ceil(prompt.length / 4),
          completion_tokens: Math.ceil(result.content.length / 4),
          total_tokens: Math.ceil((prompt.length + result.content.length) / 4)
        },
        _meta: {
          account_used: result.account,
          account_email: account.email,
          quota_remaining: account.quotaLimit - account.quotaUsed
        }
      });
      
    } catch (err) {
      console.log(`   ❌ ${account.name}: ${err.type}`);
      lastError = err;
      
      if (err.type === 'quota_exceeded') {
        console.log(`   🔄 ${account.name} exhausted, trying next...`);
        continue;
      } else {
        break;
      }
    }
  }
  
  return res.status(429).json({
    error: {
      message: 'All accounts exhausted',
      type: 'rate_limit_error',
      pool_status: accountPool.map(a => ({
        name: a.name,
        email: a.email,
        quota: `${a.quotaUsed}/${a.quotaLimit}`,
        active: a.active
      }))
    }
  });
});

/**
 * Pool status
 */
app.get('/pool', (req, res) => {
  loadAccountPool(); // Reload to detect new accounts
  
  const setupNeeded = [];
  for (let i = 1; i <= TOTAL_ACCOUNTS; i++) {
    const exists = accountPool.find(a => a.id === i);
    if (!exists) {
      setupNeeded.push({
        id: i,
        name: `Account ${i}`,
        dbPath: join(DATA_DIR, i === 1 ? 'opencode.db' : `db${i}.db`),
        status: 'needs_setup'
      });
    }
  }
  
  res.json({
    pool: accountPool.map(a => ({
      id: a.id,
      name: a.name,
      email: a.email,
      quota: `${a.quotaUsed}/${a.quotaLimit}`,
      active: a.active,
      status: a.active && a.quotaUsed < a.quotaLimit ? 'available' : 'exhausted'
    })),
    setup_needed: setupNeeded,
    total_capacity: accountPool.length * 200,
    used_capacity: accountPool.reduce((sum, a) => sum + a.quotaUsed, 0)
  });
});

/**
 * Setup account endpoint
 */
app.post('/setup/:accountId', (req, res) => {
  const accountId = parseInt(req.params.accountId);
  
  if (accountId < 1 || accountId > TOTAL_ACCOUNTS) {
    return res.status(400).json({ error: 'Invalid account ID' });
  }
  
  const dbPath = accountId === 1 
    ? join(DATA_DIR, 'opencode.db')
    : join(DATA_DIR, `db${accountId}.db`);
  
  console.log(`\\n🔐 Setting up Account ${accountId}...`);
  console.log(`   Database: ${dbPath}`);
  
  const isWindows = process.platform === 'win32';
  
  const proc = isWindows
    ? spawn('powershell.exe', [
        '-NoProfile', '-Command',
        `$env:OPENCODE_DB="${dbPath}"; opencode`
      ], { detached: true, stdio: 'ignore' })
    : spawn('opencode', [], {
        env: { ...process.env, OPENCODE_DB: dbPath },
        detached: true,
        stdio: 'ignore'
      });
  
  proc.unref();
  
  res.json({
    message: `OpenCode started for Account ${accountId}`,
    instructions: [
      'OpenCode CLI will open in a new window',
      'Run: /connect',
      'Login with a DIFFERENT email than existing accounts',
      'Close OpenCode when done',
      'Refresh pool to see new account'
    ],
    dbPath
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
  <title>OpenCode Multi-Account Gateway</title>
  <meta charset="utf-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      padding: 20px;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .header {
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
      font-size: 1.1em;
    }
    .pool {
      background: white;
      border-radius: 12px;
      padding: 25px;
      margin-bottom: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
    }
    .account {
      background: #f8f9fa;
      border-left: 4px solid #667eea;
      padding: 20px;
      margin: 15px 0;
      border-radius: 8px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .account.exhausted {
      border-left-color: #dc3545;
      opacity: 0.6;
    }
    .account.setup-needed {
      border-left-color: #ffc107;
      background: #fff8e1;
    }
    .account-info {
      flex: 1;
    }
    .account-name {
      font-size: 1.2em;
      font-weight: 600;
      color: #333;
      margin-bottom: 5px;
    }
    .account-email {
      color: #666;
      font-size: 0.9em;
    }
    .account-quota {
      font-size: 0.9em;
      color: #666;
      margin-top: 5px;
    }
    .badge {
      padding: 6px 16px;
      border-radius: 20px;
      font-size: 0.85em;
      font-weight: 600;
      text-transform: uppercase;
    }
    .badge.available { background: #d4edda; color: #155724; }
    .badge.exhausted { background: #f8d7da; color: #721c24; }
    .badge.needs-setup { background: #fff3cd; color: #856404; }
    button {
      background: #667eea;
      color: white;
      border: none;
      padding: 12px 24px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      font-size: 1em;
      transition: all 0.2s;
    }
    button:hover { background: #5568d3; transform: translateY(-2px); }
    button:active { transform: translateY(0); }
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
    .stat-value {
      font-size: 2.5em;
      font-weight: 700;
      margin-bottom: 5px;
    }
    .stat-label {
      font-size: 0.9em;
      opacity: 0.9;
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
    .instructions li {
      margin: 8px 0;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 OpenCode Multi-Account Gateway</h1>
      <p class="subtitle">Like Kiro/Codex - Automatic rotation between accounts</p>
    </div>
    
    <div class="pool">
      <h2 style="margin-bottom: 20px;">Account Pool</h2>
      <div id="accounts"></div>
      
      <div class="stats">
        <div class="stat-card">
          <div class="stat-value" id="total-accounts">0</div>
          <div class="stat-label">Active Accounts</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="total-capacity">0</div>
          <div class="stat-label">Total Capacity</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="used-capacity">0</div>
          <div class="stat-label">Used Today</div>
        </div>
      </div>
    </div>
    
    <div class="pool">
      <div class="instructions">
        <h3>✅ How It Works:</h3>
        <ol>
          <li><strong>Setup accounts:</strong> Click "Setup Account X" below</li>
          <li><strong>Connect:</strong> OpenCode opens → run /connect → login</li>
          <li><strong>Use gateway:</strong> Point your app to http://localhost:3000/v1</li>
          <li><strong>Auto-rotation:</strong> Gateway switches accounts automatically!</li>
        </ol>
      </div>
    </div>
  </div>
  
  <script>
    async function loadPool() {
      const res = await fetch('/pool');
      const data = await res.json();
      
      let html = '';
      
      // Active accounts
      data.pool.forEach(acc => {
        const statusClass = acc.status === 'available' ? 'available' : 'exhausted';
        html += \`
          <div class="account \${acc.status === 'exhausted' ? 'exhausted' : ''}">
            <div class="account-info">
              <div class="account-name">\${acc.name}</div>
              <div class="account-email">\${acc.email}</div>
              <div class="account-quota">Quota: \${acc.quota}</div>
            </div>
            <span class="badge \${statusClass}">\${acc.status}</span>
          </div>
        \`;
      });
      
      // Accounts needing setup
      data.setup_needed.forEach(acc => {
        html += \`
          <div class="account setup-needed">
            <div class="account-info">
              <div class="account-name">\${acc.name}</div>
              <div class="account-email">Not setup yet</div>
            </div>
            <button onclick="setupAccount(\${acc.id})">Setup Account \${acc.id}</button>
          </div>
        \`;
      });
      
      document.getElementById('accounts').innerHTML = html;
      document.getElementById('total-accounts').textContent = data.pool.length;
      document.getElementById('total-capacity').textContent = data.total_capacity;
      document.getElementById('used-capacity').textContent = data.used_capacity;
    }
    
    async function setupAccount(id) {
      const res = await fetch(\`/setup/\${id}\`, { method: 'POST' });
      const data = await res.json();
      alert(data.message + '\\n\\n' + data.instructions.join('\\n'));
      
      // Reload after 5 seconds
      setTimeout(loadPool, 5000);
    }
    
    loadPool();
    setInterval(loadPool, 5000);
  </script>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🚀 Multi-Account Gateway - RUNNING                       ║
║                                                            ║
║  📡 API: http://localhost:${PORT}/v1/chat/completions          ║
║  🎛️  Web UI: http://localhost:${PORT}/                         ║
║  📊 Pool Status: http://localhost:${PORT}/pool                 ║
║                                                            ║
║  💡 Like Kiro/Codex - Account Pool Pattern!              ║
║                                                            ║
║  🔧 Current Pool: ${accountPool.length} account(s)                          ║
║  📈 Total Capacity: ${accountPool.length * 200} requests/day                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Ready for multi-account rotation! 🎉
  `);
});
