#!/usr/bin/env node
/**
 * Multi-Account OpenCode Gateway
 * Pattern: Like Kiro/Codex - We manage OAuth tokens, not OpenCode CLI
 * 
 * Flow:
 * 1. User clicks "Add Account" → Browser opens OAuth
 * 2. OAuth callback → We save token to OUR database
 * 3. Gateway uses saved tokens directly (bypass OpenCode CLI)
 * 4. Gateway rotates between tokens automatically
 */

import express from 'express';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { existsSync, mkdirSync } from 'fs';

const app = express();
app.use(express.json());

// Our own database for token management
const GATEWAY_DIR = join(os.homedir(), '.opencode-gateway');
const GATEWAY_DB = join(GATEWAY_DIR, 'accounts.db');

if (!existsSync(GATEWAY_DIR)) {
  mkdirSync(GATEWAY_DIR, { recursive: true });
}

// Initialize our token database
const db = new Database(GATEWAY_DB);
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    account_id TEXT,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    last_used INTEGER DEFAULT (strftime('%s', 'now')),
    request_count INTEGER DEFAULT 0,
    quota_used INTEGER DEFAULT 0,
    quota_limit INTEGER DEFAULT 200,
    active INTEGER DEFAULT 1
  )
`);

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🚀 Multi-Account Gateway - Token Management              ║
║                                                            ║
║  Pattern: Like Kiro/Codex                                 ║
║  We manage OAuth tokens, bypass OpenCode CLI              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

// Load accounts from our database
function loadAccounts() {
  return db.prepare(`
    SELECT * FROM accounts 
    WHERE active = 1 
    ORDER BY id
  `).all();
}

function getNextAccount() {
  const accounts = loadAccounts();
  if (accounts.length === 0) return null;
  
  // Get account with lowest usage
  return accounts.reduce((prev, curr) => 
    prev.quota_used <= curr.quota_used ? prev : curr
  );
}

/**
 * Call OpenCode API directly with our managed token
 * Bypass OpenCode CLI completely!
 */
async function callOpenCodeWithToken(account, model, prompt) {
  return new Promise((resolve, reject) => {
    console.log(`   🔧 Using Account ${account.id}: ${account.email}`);
    console.log(`   📊 Quota: ${account.quota_used}/${account.quota_limit}`);
    
    // TODO: Call OpenCode HTTP API directly with our token
    // This is where we bypass OpenCode CLI!
    // For now, fallback to CLI with OPENCODE_DB
    
    const isWindows = process.platform === 'win32';
    const proc = isWindows
      ? spawn('powershell.exe', [
          '-NoProfile', '-Command',
          `opencode run "${prompt.replace(/"/g, '\\"')}" --model ${model}`
        ], { stdio: ['pipe', 'pipe', 'pipe'] })
      : spawn('opencode', ['run', prompt, '--model', model], {
          stdio: ['pipe', 'pipe', 'pipe']
        });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
    proc.on('close', (code) => {
      if (code === 0) {
        // Update usage
        db.prepare('UPDATE accounts SET request_count = request_count + 1, quota_used = quota_used + 1, last_used = ? WHERE id = ?')
          .run(Math.floor(Date.now() / 1000), account.id);
        
        resolve({ content: stdout.trim(), account: `Account ${account.id}` });
      } else {
        if (stderr.includes('limit') || stderr.includes('quota')) {
          // Mark as exhausted
          db.prepare('UPDATE accounts SET active = 0, quota_used = quota_limit WHERE id = ?')
            .run(account.id);
          reject({ type: 'quota_exceeded', message: stderr, account: `Account ${account.id}` });
        } else {
          reject({ type: 'error', message: stderr, account: `Account ${account.id}` });
        }
      }
    });
  });
}

app.post('/v1/chat/completions', async (req, res) => {
  const { messages, model = 'opencode/deepseek-v4.1-flash-free' } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: { message: 'Invalid request: messages required', type: 'invalid_request_error' }
    });
  }
  
  const prompt = messages[messages.length - 1].content;
  console.log(`\n📨 Request: ${prompt.substring(0, 50)}...`);
  
  const accounts = loadAccounts();
  
  if (accounts.length === 0) {
    return res.status(503).json({
      error: {
        message: 'No accounts connected',
        type: 'service_unavailable',
        instructions: 'Go to http://localhost:3000 and add an account'
      }
    });
  }
  
  // Try accounts in order
  for (const account of accounts) {
    if (account.quota_used >= account.quota_limit) {
      console.log(`   ⏭️  Skip Account ${account.id} (exhausted)`);
      continue;
    }
    
    try {
      const result = await callOpenCodeWithToken(account, model, prompt);
      console.log(`   ✅ Success with Account ${account.id}`);
      
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
          quota_remaining: account.quota_limit - account.quota_used
        }
      });
      
    } catch (err) {
      console.log(`   ❌ Account ${account.id}: ${err.type}`);
      if (err.type === 'quota_exceeded') {
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
      pool_status: accounts.map(a => ({
        id: a.id,
        email: a.email,
        quota: `${a.quota_used}/${a.quota_limit}`,
        active: a.active === 1
      }))
    }
  });
});

// Account management endpoints
app.get('/pool', (req, res) => {
  const accounts = loadAccounts();
  
  res.json({
    pool: accounts.map(a => ({
      id: a.id,
      email: a.email,
      quota: `${a.quota_used}/${a.quota_limit}`,
      active: a.active === 1,
      status: a.active && a.quota_used < a.quota_limit ? 'available' : 'exhausted'
    })),
    total_capacity: accounts.length * 200,
    used_capacity: accounts.reduce((sum, a) => sum + a.quota_used, 0)
  });
});

// OAuth flow initiation
app.post('/oauth/start', (req, res) => {
  // TODO: Start OAuth flow
  // This is where we implement Cockpit-style OAuth!
  // For now, guide user to use OpenCode CLI manually
  
  res.json({
    message: 'OAuth implementation pending',
    instructions: [
      'For now, connect accounts manually:',
      '1. Run: opencode',
      '2. Type: /connect',
      '3. Login with email',
      '4. Close OpenCode',
      '5. Run: node extract-tokens.mjs',
      '6. Import token to gateway manually'
    ]
  });
});

// Manual token import (temporary until OAuth is implemented)
app.post('/accounts/import', (req, res) => {
  const { email, accessToken, refreshToken, accountId } = req.body;
  
  if (!email || !accessToken) {
    return res.status(400).json({ error: 'email and accessToken required' });
  }
  
  try {
    db.prepare(`
      INSERT INTO accounts (email, access_token, refresh_token, account_id)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(email) DO UPDATE SET
        access_token = excluded.access_token,
        refresh_token = excluded.refresh_token,
        account_id = excluded.account_id
    `).run(email, accessToken, refreshToken || null, accountId || null);
    
    res.json({
      message: `Account ${email} imported successfully`,
      accounts: loadAccounts().length
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  const accounts = loadAccounts();
  
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>Multi-Account Gateway</title>
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
    .subtitle { color: #666; font-size: 1.1em; }
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
    }
    .account.exhausted {
      border-left-color: #dc3545;
      opacity: 0.6;
    }
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
    .stat-value { font-size: 2.5em; font-weight: 700; margin-bottom: 5px; }
    .stat-label { font-size: 0.9em; opacity: 0.9; }
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
    .instructions {
      background: #fff3cd;
      border-left: 4px solid #ffc107;
      padding: 20px;
      border-radius: 8px;
      margin-top: 20px;
    }
    .instructions h3 { color: #856404; margin-bottom: 10px; }
    code {
      background: #f8f9fa;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Multi-Account Gateway</h1>
      <p class="subtitle">Token-based account rotation - Like Kiro/Codex</p>
    </div>
    
    <div class="pool">
      <h2 style="margin-bottom: 20px;">Account Pool</h2>
      <div id="accounts"></div>
      
      <div class="stats">
        <div class="stat-card">
          <div class="stat-value" id="total-accounts">${accounts.length}</div>
          <div class="stat-label">Active Accounts</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="total-capacity">${accounts.length * 200}</div>
          <div class="stat-label">Total Capacity</div>
        </div>
        <div class="stat-card">
          <div class="stat-value" id="used-capacity">${accounts.reduce((sum, a) => sum + a.quota_used, 0)}</div>
          <div class="stat-label">Used Today</div>
        </div>
      </div>
      
      <div style="margin-top: 20px; text-align: center;">
        <button onclick="addAccount()">Add Account (OAuth - Coming Soon)</button>
      </div>
    </div>
    
    <div class="pool">
      <div class="instructions">
        <h3>⚠️  Manual Setup (Until OAuth is Implemented):</h3>
        <ol style="margin-left: 20px; color: #666;">
          <li>Connect account via OpenCode CLI: <code>opencode</code> → <code>/connect</code></li>
          <li>Extract token: <code>node extract-tokens.mjs</code></li>
          <li>Import via API: <code>POST /accounts/import</code></li>
        </ol>
        <p style="margin-top: 15px; color: #666;">
          <strong>Target:</strong> Implement Cockpit-style OAuth flow so user just clicks "Add Account" → Browser login → Done!
        </p>
      </div>
    </div>
  </div>
  
  <script>
    async function loadPool() {
      const res = await fetch('/pool');
      const data = await res.json();
      
      let html = '';
      data.pool.forEach(acc => {
        html += \`
          <div class="account \${acc.status === 'exhausted' ? 'exhausted' : ''}">
            <div><strong>Account \${acc.id}:</strong> \${acc.email}</div>
            <div>Quota: \${acc.quota} | Status: \${acc.status}</div>
          </div>
        \`;
      });
      
      if (data.pool.length === 0) {
        html = '<div class="account">No accounts connected yet</div>';
      }
      
      document.getElementById('accounts').innerHTML = html;
    }
    
    function addAccount() {
      alert('OAuth flow coming soon!\\n\\nFor now, use manual setup below.');
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
  const accounts = loadAccounts();
  
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  📡 API: http://localhost:${PORT}/v1/chat/completions          ║
║  🎛️  Web UI: http://localhost:${PORT}/                         ║
║  📊 Pool: http://localhost:${PORT}/pool                        ║
║                                                            ║
║  🔧 Current Accounts: ${accounts.length}                               ║
║  📈 Total Capacity: ${accounts.length * 200} req/day                      ║
║                                                            ║
║  💡 Pattern: Token management like Kiro/Codex             ║
║  ⚠️  OAuth implementation needed!                         ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Ready! Add accounts via manual import for now.
Database: ${GATEWAY_DB}
  `);
});
