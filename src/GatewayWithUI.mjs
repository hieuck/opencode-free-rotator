#!/usr/bin/env node
/**
 * Smart Gateway with Built-in Account Manager
 * 
 * Features:
 * - Web UI to add accounts (login via OpenCode OAuth)
 * - Automatic rotation between accounts
 * - No manual OPENCODE_DB manipulation needed!
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
app.use(express.static('public'));

const DATA_DIR = join(os.homedir(), '.local/share/opencode');
const GATEWAY_DIR = join(DATA_DIR, 'gateway-accounts');

// Ensure gateway directory exists
if (!existsSync(GATEWAY_DIR)) {
  mkdirSync(GATEWAY_DIR, { recursive: true });
}

// Account manager
const accounts = [];

// Load existing accounts on startup
function loadAccounts() {
  const mainDb = join(DATA_DIR, 'opencode.db');
  
  if (existsSync(mainDb)) {
    accounts.push({
      id: 'account-1',
      name: 'Account 1 (Main)',
      dbPath: mainDb,
      requestCount: 0,
      active: true
    });
  }
  
  // Check for db2.db, db3.db
  for (let i = 2; i <= 5; i++) {
    const dbPath = join(DATA_DIR, `db${i}.db`);
    if (existsSync(dbPath)) {
      accounts.push({
        id: `account-${i}`,
        name: `Account ${i}`,
        dbPath,
        requestCount: 0,
        active: true
      });
    }
  }
  
  console.log(`✅ Loaded ${accounts.length} account(s)`);
}

loadAccounts();

/**
 * Get next available account
 */
function getNextAccount() {
  // Find account with lowest request count
  const available = accounts.filter(a => a.active);
  
  if (available.length === 0) {
    return null;
  }
  
  // Simple round-robin
  return available.reduce((prev, curr) => 
    prev.requestCount <= curr.requestCount ? prev : curr
  );
}

/**
 * Call OpenCode with specific account
 */
async function callOpenCode(account, model, prompt) {
  return new Promise((resolve, reject) => {
    // On Windows, use PowerShell to run opencode
    const isWindows = process.platform === 'win32';
    const proc = isWindows
      ? spawn('powershell.exe', [
          '-NoProfile', '-Command',
          `$env:OPENCODE_DB="${account.dbPath}"; opencode run "${prompt.replace(/"/g, '\\"')}" --model ${model}`
        ], {
          stdio: ['pipe', 'pipe', 'pipe']
        })
      : spawn('opencode', ['run', prompt, '--model', model], {
          env: {
            ...process.env,
            OPENCODE_DB: account.dbPath
          },
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
        resolve({ content: stdout.trim(), account: account.name });
      } else {
        // Check if quota error
        if (stderr.includes('limit') || stderr.includes('quota')) {
          account.active = false;
          reject({ type: 'quota_exceeded', message: stderr, account: account.name });
        } else {
          reject({ type: 'error', message: stderr, account: account.name });
        }
      }
    });
  });
}

/**
 * Main chat completions endpoint
 */
app.post('/v1/chat/completions', async (req, res) => {
  const { messages, model = 'opencode/deepseek-v4.1-flash-free' } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: { message: 'Invalid request: messages required', type: 'invalid_request_error' }
    });
  }
  
  const prompt = messages[messages.length - 1].content;
  
  console.log(`\\n📨 Request for model: ${model}`);
  
  // Try accounts in order
  let lastError = null;
  
  for (const account of accounts) {
    if (!account.active) {
      console.log(`⏭️  Skipping inactive account: ${account.name}`);
      continue;
    }
    
    console.log(`🤖 Trying ${account.name}...`);
    
    try {
      const result = await callOpenCode(account, model, prompt);
      
      console.log(`✅ Success with ${account.name}`);
      
      return res.json({
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model,
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: result.content
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: Math.ceil(prompt.length / 4),
          completion_tokens: Math.ceil(result.content.length / 4),
          total_tokens: Math.ceil((prompt.length + result.content.length) / 4)
        },
        _meta: {
          account_used: result.account
        }
      });
      
    } catch (err) {
      console.log(`❌ ${account.name}: ${err.message}`);
      lastError = err;
      
      if (err.type !== 'quota_exceeded') {
        break; // Non-quota error, don't try other accounts
      }
      
      // Quota exceeded, try next account
      continue;
    }
  }
  
  // All accounts failed
  return res.status(429).json({
    error: {
      message: 'All accounts exhausted or error occurred',
      type: 'rate_limit_error',
      last_error: lastError?.message
    }
  });
});

/**
 * Account management UI
 */
app.get('/accounts', (req, res) => {
  res.json({
    accounts: accounts.map(a => ({
      id: a.id,
      name: a.name,
      requestCount: a.requestCount,
      active: a.active
    }))
  });
});

/**
 * Add new account endpoint
 */
app.post('/accounts/add', async (req, res) => {
  const { accountNumber } = req.body;
  
  if (!accountNumber || accountNumber < 2 || accountNumber > 10) {
    return res.status(400).json({
      error: 'accountNumber must be between 2 and 10'
    });
  }
  
  const dbPath = join(DATA_DIR, `db${accountNumber}.db`);
  
  console.log(`\\n🔐 Setting up Account ${accountNumber}...`);
  console.log(`   Database: ${dbPath}`);
  
  // Spawn OpenCode with the new database
  // On Windows, use PowerShell to run opencode
  const isWindows = process.platform === 'win32';
  const proc = isWindows 
    ? spawn('powershell.exe', ['-NoProfile', '-Command', `$env:OPENCODE_DB="${dbPath}"; opencode`], {
        stdio: 'inherit'
      })
    : spawn('opencode', [], {
        env: {
          ...process.env,
          OPENCODE_DB: dbPath
        },
        stdio: 'inherit'
      });
  
  proc.on('close', (code) => {
    if (code === 0) {
      // Check if account was created
      if (existsSync(dbPath)) {
        accounts.push({
          id: `account-${accountNumber}`,
          name: `Account ${accountNumber}`,
          dbPath,
          requestCount: 0,
          active: true
        });
        
        console.log(`✅ Account ${accountNumber} added successfully`);
      }
    }
  });
  
  res.json({
    message: `OpenCode started for Account ${accountNumber}. Please authenticate via /connect`,
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
  <title>OpenCode Gateway - Account Manager</title>
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      background: #0f0f23;
      color: #cccccc;
    }
    h1 {
      color: #00cc00;
      border-bottom: 2px solid #00cc00;
      padding-bottom: 10px;
    }
    .account-list {
      background: #10101a;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .account {
      background: #1a1a2e;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 15px;
      margin: 10px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .account.inactive {
      opacity: 0.5;
    }
    .account-name {
      font-weight: bold;
      color: #00cc00;
    }
    .account-stats {
      font-size: 0.9em;
      color: #888;
    }
    .status {
      padding: 4px 12px;
      border-radius: 4px;
      font-size: 0.85em;
      font-weight: 600;
    }
    .status.active {
      background: #00cc0022;
      color: #00cc00;
      border: 1px solid #00cc00;
    }
    .status.exhausted {
      background: #cc000022;
      color: #cc0000;
      border: 1px solid #cc0000;
    }
    .add-account {
      background: #1a1a2e;
      border: 1px solid #444;
      border-radius: 6px;
      padding: 20px;
      margin: 20px 0;
    }
    input {
      background: #0f0f23;
      border: 1px solid #444;
      color: #cccccc;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 1em;
    }
    button {
      background: #00cc00;
      color: #0f0f23;
      border: none;
      padding: 10px 20px;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      font-size: 1em;
    }
    button:hover {
      background: #00ff00;
    }
    .instructions {
      background: #1a1a2e;
      border-left: 3px solid #00cc00;
      padding: 15px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .code {
      background: #0f0f23;
      padding: 10px;
      border-radius: 4px;
      font-family: 'Courier New', monospace;
      margin: 10px 0;
      overflow-x: auto;
    }
  </style>
</head>
<body>
  <h1>🚀 OpenCode Gateway - Account Manager</h1>
  
  <div class="instructions">
    <h3>📋 How to Add Account:</h3>
    <ol>
      <li>Enter account number (2-10) below</li>
      <li>Click "Launch OpenCode" - terminal will open</li>
      <li>In OpenCode CLI, run: <code>/connect</code></li>
      <li>Login with <strong>DIFFERENT email</strong></li>
      <li>Close OpenCode when done</li>
      <li>Refresh this page - account will appear!</li>
    </ol>
  </div>
  
  <div class="account-list">
    <h2>Active Accounts:</h2>
    <div id="accounts"></div>
  </div>
  
  <div class="add-account">
    <h3>➕ Add New Account</h3>
    <p>Account number: 
      <input type="number" id="accountNumber" min="2" max="10" value="2" />
      <button onclick="addAccount()">Launch OpenCode for Account</button>
    </p>
  </div>
  
  <div class="instructions">
    <h3>✅ After Adding Accounts:</h3>
    <p>Use gateway with any OpenAI SDK:</p>
    <div class="code">
const openai = new OpenAI({
  baseURL: 'http://localhost:3000/v1',
  apiKey: 'not-needed'
});

// Gateway automatically rotates accounts!
const response = await openai.chat.completions.create({
  model: 'opencode/deepseek-v4.1-flash-free',
  messages: [{ role: 'user', content: 'Hello!' }]
});
    </div>
  </div>
  
  <script>
    async function loadAccounts() {
      const res = await fetch('/accounts');
      const data = await res.json();
      
      const html = data.accounts.map(acc => \`
        <div class="account \${acc.active ? '' : 'inactive'}">
          <div>
            <div class="account-name">\${acc.name}</div>
            <div class="account-stats">Requests: \${acc.requestCount}</div>
          </div>
          <div class="status \${acc.active ? 'active' : 'exhausted'}">
            \${acc.active ? 'Active' : 'Exhausted'}
          </div>
        </div>
      \`).join('');
      
      document.getElementById('accounts').innerHTML = html || '<p>No accounts loaded. Add one below!</p>';
    }
    
    async function addAccount() {
      const num = document.getElementById('accountNumber').value;
      
      const res = await fetch('/accounts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountNumber: parseInt(num) })
      });
      
      const data = await res.json();
      alert(data.message);
    }
    
    // Load accounts on page load
    loadAccounts();
    
    // Refresh every 5 seconds
    setInterval(loadAccounts, 5000);
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
║  🚀 OpenCode Gateway with Account Manager - RUNNING      ║
║                                                            ║
║  📡 API: http://localhost:${PORT}/v1/chat/completions          ║
║  🎛️  Manager UI: http://localhost:${PORT}/                     ║
║                                                            ║
║  💡 Add accounts via web UI!                              ║
║     1. Open http://localhost:${PORT}                           ║
║     2. Click "Add Account"                                ║
║     3. Login with different email                         ║
║     4. Gateway auto-rotates!                              ║
║                                                            ║
║  📊 Current Accounts: ${accounts.length}                               ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Ready to serve with automatic account rotation! 🎉
  `);
});
