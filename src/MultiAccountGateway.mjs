#!/usr/bin/env node
/**
 * Gateway with OAuth Integration
 * Click button → Browser opens → Login → Done!
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
const accountPool = [];

function loadAccountPool() {
  accountPool.length = 0;
  
  for (let i = 1; i <= 3; i++) {
    const dbPath = i === 1 
      ? join(DATA_DIR, 'opencode.db')
      : join(DATA_DIR, `db${i}.db`);
    
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
        // ignore
      }
    }
  }
  
  console.log(`✅ Loaded ${accountPool.length} account(s) in pool`);
  accountPool.forEach(a => console.log(`   ${a.name}: ${a.email}`));
}

loadAccountPool();

function getNextAccount() {
  const available = accountPool.filter(a => a.active && a.quotaUsed < a.quotaLimit);
  if (available.length === 0) return null;
  return available.reduce((prev, curr) => prev.quotaUsed <= curr.quotaUsed ? prev : curr);
}

async function callOpenCodeWithAccount(account, model, prompt) {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === 'win32';
    
    console.log(`   🔧 Using ${account.name} (${account.email})`);
    
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
    
    proc.stdout.on('data', (data) => { stdout += data.toString(); });
    proc.stderr.on('data', (data) => { stderr += data.toString(); });
    
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

app.post('/v1/chat/completions', async (req, res) => {
  const { messages, model = 'opencode/deepseek-v4.1-flash-free' } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: { message: 'Invalid request: messages required', type: 'invalid_request_error' }
    });
  }
  
  const prompt = messages[messages.length - 1].content;
  
  console.log(`\n📨 Request: ${prompt.substring(0, 50)}...`);
  
  let lastError = null;
  
  for (const account of accountPool) {
    if (!account.active || account.quotaUsed >= account.quotaLimit) {
      console.log(`   ⏭️  Skip ${account.name} (exhausted)`);
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

app.get('/pool', (req, res) => {
  loadAccountPool();
  
  const setupNeeded = [];
  for (let i = 1; i <= 3; i++) {
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

// 🎯 AUTO OAUTH FLOW - Click button → Browser opens → Login → Done!
app.post('/setup/:accountId', (req, res) => {
  const accountId = parseInt(req.params.accountId);
  
  if (accountId < 1 || accountId > 3) {
    return res.status(400).json({ error: 'Invalid account ID' });
  }
  
  const dbPath = accountId === 1 
    ? join(DATA_DIR, 'opencode.db')
    : join(DATA_DIR, `db${accountId}.db`);
  
  console.log(`\n🚀 Auto-starting OAuth for Account ${accountId}...`);
  console.log(`   Database: ${dbPath}`);
  
  const isWindows = process.platform === 'win32';
  
  // Spawn OpenCode with /connect command auto-executed
  const proc = isWindows
    ? spawn('powershell.exe', [
        '-NoProfile',
        '-Command',
        `$env:OPENCODE_DB="${dbPath}"; echo '/connect' | opencode`
      ], { 
        detached: true, 
        stdio: ['pipe', 'pipe', 'pipe']
      })
    : spawn('bash', [
        '-c',
        `echo '/connect' | OPENCODE_DB="${dbPath}" opencode`
      ], {
        detached: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
  
  // Monitor for successful auth
  let output = '';
  proc.stdout.on('data', (data) => {
    output += data.toString();
    console.log(`   📝 ${data.toString().trim()}`);
  });
  
  proc.stderr.on('data', (data) => {
    console.log(`   ⚠️  ${data.toString().trim()}`);
  });
  
  proc.on('close', (code) => {
    console.log(`\n✅ OAuth flow completed (exit ${code})`);
    
    // Reload pool to check if account was added
    setTimeout(() => {
      loadAccountPool();
    }, 2000);
  });
  
  proc.unref();
  
  res.json({
    message: `OAuth flow started for Account ${accountId}`,
    instructions: [
      'Browser will open automatically',
      'Login with a DIFFERENT email',
      'Authorize OpenCode',
      'Close browser when done',
      'Account will be added automatically!'
    ],
    dbPath
  });
});

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <title>OpenCode Gateway - Auto OAuth</title>
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
    button:disabled {
      background: #ccc;
      cursor: not-allowed;
      transform: none;
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
    .loading {
      display: inline-block;
      width: 20px;
      height: 20px;
      border: 3px solid rgba(255,255,255,.3);
      border-radius: 50%;
      border-top-color: #fff;
      animation: spin 1s ease-in-out infinite;
    }
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 OpenCode Gateway - Auto OAuth</h1>
      <p class="subtitle">Click button → Browser opens → Login → Done!</p>
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
        <h3>✅ Automatic OAuth Flow:</h3>
        <ol>
          <li><strong>Click "Add Account X"</strong> below</li>
          <li><strong>Browser opens automatically</strong> with login page</li>
          <li><strong>Login with different email</strong> and authorize</li>
          <li><strong>Done!</strong> Account added to pool automatically</li>
          <li><strong>Gateway rotates</strong> between accounts transparently</li>
        </ol>
      </div>
    </div>
  </div>
  
  <script>
    const setupInProgress = new Set();
    
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
        const isSetupInProgress = setupInProgress.has(acc.id);
        html += \`
          <div class="account setup-needed">
            <div class="account-info">
              <div class="account-name">\${acc.name}</div>
              <div class="account-email">\${isSetupInProgress ? 'Setting up... browser should open' : 'Not connected yet'}</div>
            </div>
            <button 
              onclick="setupAccount(\${acc.id})"
              \${isSetupInProgress ? 'disabled' : ''}
            >
              \${isSetupInProgress ? '<span class="loading"></span> Setting up...' : 'Add Account ' + acc.id}
            </button>
          </div>
        \`;
      });
      
      document.getElementById('accounts').innerHTML = html;
      document.getElementById('total-accounts').textContent = data.pool.length;
      document.getElementById('total-capacity').textContent = data.total_capacity;
      document.getElementById('used-capacity').textContent = data.used_capacity;
    }
    
    async function setupAccount(id) {
      setupInProgress.add(id);
      loadPool();
      
      const res = await fetch(\`/setup/\${id}\`, { method: 'POST' });
      const data = await res.json();
      
      alert(
        '🚀 ' + data.message + '\\n\\n' +
        '✅ Browser will open automatically\\n' +
        '✅ Login with DIFFERENT email\\n' +
        '✅ Authorize OpenCode\\n' +
        '✅ Account will be added!\\n\\n' +
        'Refreshing pool in 10 seconds...'
      );
      
      // Poll for account to appear
      let attempts = 0;
      const checkInterval = setInterval(async () => {
        attempts++;
        await loadPool();
        
        const poolRes = await fetch('/pool');
        const poolData = await poolRes.json();
        const accountExists = poolData.pool.find(a => a.id === id);
        
        if (accountExists || attempts > 20) {
          setupInProgress.delete(id);
          clearInterval(checkInterval);
          
          if (accountExists) {
            alert(\`✅ Account \${id} added successfully!\\nEmail: \${accountExists.email}\`);
          } else {
            alert(\`⚠️  Account \${id} not detected yet.\\nMake sure you completed OAuth flow.\\nRefresh page to check.\`);
          }
          
          loadPool();
        }
      }, 3000);
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
║  🚀 Multi-Account Gateway - AUTO OAUTH                    ║
║                                                            ║
║  📡 API: http://localhost:${PORT}/v1/chat/completions          ║
║  🎛️  Web UI: http://localhost:${PORT}/                         ║
║  📊 Pool Status: http://localhost:${PORT}/pool                 ║
║                                                            ║
║  💡 Click button → Browser opens → Login → Done!          ║
║                                                            ║
║  🔧 Current Pool: ${accountPool.length} account(s)                          ║
║  📈 Total Capacity: ${accountPool.length * 200} requests/day                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Ready! Open http://localhost:${PORT} and click "Add Account" 🎉
  `);
});
