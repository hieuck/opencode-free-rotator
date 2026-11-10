#!/usr/bin/env node
/**
 * Simple OpenCode Gateway - Working Solution
 * 
 * Strategy: Spawn OpenCode CLI instances directly, no OAuth complexity
 * Each instance uses different OPENCODE_DB for separate accounts
 * 
 * Usage:
 *   node src/SimpleGateway.mjs
 * 
 * Then use with OpenAI SDK:
 *   const client = new OpenAI({ baseURL: 'http://localhost:3000' });
 */

import express from 'express';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import os from 'os';

const app = express();
app.use(express.json());

// Account configuration
const ACCOUNTS = [
  {
    name: 'Account 1',
    db: path.join(os.homedir(), '.local/share/opencode/opencode.db'),
    used: 0,
    limit: 200,
    lastReset: new Date().toDateString()
  },
  {
    name: 'Account 2',
    db: path.join(os.homedir(), '.local/share/opencode/db2.db'),
    used: 0,
    limit: 200,
    lastReset: new Date().toDateString()
  },
  {
    name: 'Account 3',
    db: path.join(os.homedir(), '.local/share/opencode/db3.db'),
    used: 0,
    limit: 200,
    lastReset: new Date().toDateString()
  }
];

let currentIndex = 0;

/**
 * Check if quota needs reset (new day)
 */
function checkQuotaReset(account) {
  const today = new Date().toDateString();
  if (account.lastReset !== today) {
    account.used = 0;
    account.lastReset = today;
    console.log(`📅 [${account.name}] Quota reset for new day`);
  }
}

/**
 * Get next available account
 */
function getNextAccount() {
  // Check all accounts for quota reset
  ACCOUNTS.forEach(checkQuotaReset);
  
  // Find account with available quota
  for (let i = 0; i < ACCOUNTS.length; i++) {
    const index = (currentIndex + i) % ACCOUNTS.length;
    const account = ACCOUNTS[index];
    
    if (account.used < account.limit) {
      currentIndex = index;
      return account;
    }
  }
  
  // All accounts exhausted
  return null;
}

/**
 * Call OpenCode CLI directly with specific database
 */
async function callOpenCodeCLI(account, messages, model = 'deepseek-v4.1-flash-free') {
  return new Promise((resolve, reject) => {
    const prompt = messages[messages.length - 1].content;
    
    console.log(`🤖 [${account.name}] Sending request to model: ${model}`);
    console.log(`📝 Prompt: ${prompt.substring(0, 100)}...`);
    
    // Spawn OpenCode CLI with specific database
    const proc = spawn('opencode', ['--non-interactive', '--model', model], {
      env: {
        ...process.env,
        OPENCODE_DB: account.db
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
        // Success - increment usage
        account.used++;
        console.log(`✅ [${account.name}] Success! Used: ${account.used}/${account.limit}`);
        
        resolve({
          content: stdout.trim(),
          usage: {
            used: account.used,
            limit: account.limit,
            remaining: account.limit - account.used
          }
        });
      } else {
        // Check if quota error
        if (stderr.includes('limit') || stderr.includes('quota')) {
          console.log(`⚠️  [${account.name}] Quota exceeded!`);
          reject({ type: 'quota_exceeded', message: stderr });
        } else {
          console.error(`❌ [${account.name}] Error:`, stderr);
          reject({ type: 'error', message: stderr });
        }
      }
    });
    
    // Send prompt to stdin
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

/**
 * Main API endpoint - OpenAI compatible
 */
app.post('/v1/chat/completions', async (req, res) => {
  const { messages, model, stream = false } = req.body;
  
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({
      error: {
        message: 'Invalid request: messages array required',
        type: 'invalid_request_error'
      }
    });
  }
  
  // TODO: Handle streaming in future
  if (stream) {
    return res.status(400).json({
      error: {
        message: 'Streaming not yet supported',
        type: 'invalid_request_error'
      }
    });
  }
  
  // Try all accounts with rotation
  let lastError = null;
  const attemptedAccounts = [];
  
  for (let attempt = 0; attempt < ACCOUNTS.length; attempt++) {
    const account = getNextAccount();
    
    if (!account) {
      return res.status(429).json({
        error: {
          message: 'All accounts have reached their quota limit. Try again tomorrow.',
          type: 'rate_limit_error',
          attempted: attemptedAccounts
        }
      });
    }
    
    attemptedAccounts.push(account.name);
    
    try {
      const result = await callOpenCodeCLI(account, messages, model);
      
      // Return OpenAI-compatible response
      return res.json({
        id: `chatcmpl-${randomUUID()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: model || 'deepseek-v4.1-flash-free',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.content
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: messages.reduce((sum, m) => sum + m.content.length / 4, 0),
          completion_tokens: result.content.length / 4,
          total_tokens: (messages.reduce((sum, m) => sum + m.content.length / 4, 0)) + (result.content.length / 4)
        },
        _meta: {
          account: account.name,
          quota_used: result.usage.used,
          quota_limit: result.usage.limit,
          quota_remaining: result.usage.remaining
        }
      });
      
    } catch (err) {
      lastError = err;
      
      if (err.type === 'quota_exceeded') {
        console.log(`🔄 [${account.name}] Quota exceeded, rotating to next account...`);
        // Mark account as full and try next
        account.used = account.limit;
        continue;
      } else {
        // Non-quota error, fail immediately
        return res.status(500).json({
          error: {
            message: err.message || 'Internal server error',
            type: 'api_error',
            account: account.name
          }
        });
      }
    }
  }
  
  // All accounts failed
  return res.status(429).json({
    error: {
      message: 'All accounts exhausted or failed',
      type: 'rate_limit_error',
      attempted: attemptedAccounts,
      last_error: lastError
    }
  });
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  const status = ACCOUNTS.map(acc => ({
    name: acc.name,
    used: acc.used,
    limit: acc.limit,
    remaining: acc.limit - acc.used,
    available: acc.used < acc.limit
  }));
  
  res.json({
    status: 'ok',
    accounts: status,
    total_remaining: status.reduce((sum, a) => sum + a.remaining, 0)
  });
});

/**
 * Stats endpoint
 */
app.get('/stats', (req, res) => {
  const totalUsed = ACCOUNTS.reduce((sum, acc) => sum + acc.used, 0);
  const totalLimit = ACCOUNTS.reduce((sum, acc) => sum + acc.limit, 0);
  
  res.json({
    accounts: ACCOUNTS.map(acc => ({
      name: acc.name,
      used: acc.used,
      limit: acc.limit,
      remaining: acc.limit - acc.used,
      percentage: Math.round((acc.used / acc.limit) * 100)
    })),
    total: {
      used: totalUsed,
      limit: totalLimit,
      remaining: totalLimit - totalUsed,
      percentage: Math.round((totalUsed / totalLimit) * 100)
    }
  });
});

/**
 * Start server
 */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🚀 OpenCode Simple Gateway - RUNNING                     ║
║                                                            ║
║  📡 API Endpoint: http://localhost:${PORT}/v1/chat/completions  ║
║  🏥 Health Check: http://localhost:${PORT}/health              ║
║  📊 Stats:        http://localhost:${PORT}/stats               ║
║                                                            ║
║  📝 Accounts Configured: ${ACCOUNTS.length}                             ║
║  🎯 Total Daily Quota:   ${ACCOUNTS.length * 200} requests                 ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Ready to accept requests! 🎉

Example curl:
curl -X POST http://localhost:${PORT}/v1/chat/completions \\
  -H "Content-Type: application/json" \\
  -d '{
    "messages": [{"role": "user", "content": "Hello!"}],
    "model": "deepseek-v4.1-flash-free"
  }'

Or use with OpenAI SDK:
import OpenAI from 'openai';
const client = new OpenAI({ 
  baseURL: 'http://localhost:${PORT}',
  apiKey: 'dummy-not-needed'
});
  `);
});
