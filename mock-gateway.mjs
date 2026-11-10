#!/usr/bin/env node
/**
 * Mock Demo - Prove Rotation Logic Works
 * 
 * This simulates the gateway without needing OpenCode installed
 * Shows that rotation logic is correct
 */

import express from 'express';
import { randomUUID } from 'crypto';

const app = express();
app.use(express.json());

// Mock accounts with quota
const ACCOUNTS = [
  { name: 'Account 1', used: 0, limit: 10, lastReset: new Date().toDateString() },
  { name: 'Account 2', used: 0, limit: 10, lastReset: new Date().toDateString() },
  { name: 'Account 3', used: 0, limit: 10, lastReset: new Date().toDateString() }
];

let currentIndex = 0;
let totalRequests = 0;
let rotations = 0;

function checkQuotaReset(account) {
  const today = new Date().toDateString();
  if (account.lastReset !== today) {
    account.used = 0;
    account.lastReset = today;
  }
}

function getNextAccount() {
  ACCOUNTS.forEach(checkQuotaReset);
  
  for (let i = 0; i < ACCOUNTS.length; i++) {
    const index = (currentIndex + i) % ACCOUNTS.length;
    const account = ACCOUNTS[index];
    
    if (account.used < account.limit) {
      if (index !== currentIndex) {
        rotations++;
        console.log(`\n🔄 ROTATION #${rotations}: Switching from ${ACCOUNTS[currentIndex].name} to ${account.name}`);
        console.log(`   Reason: ${ACCOUNTS[currentIndex].name} quota exhausted (${ACCOUNTS[currentIndex].used}/${ACCOUNTS[currentIndex].limit})\n`);
      }
      currentIndex = index;
      return account;
    }
  }
  
  return null;
}

async function mockOpenCodeCall(account, prompt) {
  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 100));
  
  return {
    content: `[MOCK] Response from ${account.name}: ${prompt}`,
    usage: {
      used: account.used,
      limit: account.limit,
      remaining: account.limit - account.used
    }
  };
}

app.post('/v1/chat/completions', async (req, res) => {
  totalRequests++;
  const { messages } = req.body;
  const prompt = messages[messages.length - 1].content;
  
  console.log(`\n📨 Request #${totalRequests}: "${prompt}"`);
  
  const account = getNextAccount();
  
  if (!account) {
    console.log(`❌ All accounts exhausted!`);
    return res.status(429).json({
      error: {
        message: 'All accounts exhausted',
        type: 'rate_limit_error'
      }
    });
  }
  
  try {
    const result = await mockOpenCodeCall(account, prompt);
    account.used++;
    
    console.log(`✅ Served by ${account.name} (${account.used}/${account.limit} used, ${account.limit - account.used} remaining)`);
    
    res.json({
      id: `chatcmpl-${randomUUID()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'mock-model',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: result.content
        },
        finish_reason: 'stop'
      }],
      usage: {
        prompt_tokens: prompt.length / 4,
        completion_tokens: result.content.length / 4,
        total_tokens: (prompt.length + result.content.length) / 4
      },
      _meta: {
        account: account.name,
        quota_used: result.usage.used,
        quota_limit: result.usage.limit,
        quota_remaining: result.usage.remaining,
        total_rotations: rotations
      }
    });
    
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

app.get('/health', (req, res) => {
  const status = ACCOUNTS.map(acc => ({
    name: acc.name,
    used: acc.used,
    limit: acc.limit,
    remaining: acc.limit - acc.used,
    percentage: Math.round((acc.used / acc.limit) * 100)
  }));
  
  res.json({
    status: 'ok',
    accounts: status,
    total_requests: totalRequests,
    total_rotations: rotations,
    total_remaining: status.reduce((sum, a) => sum + a.remaining, 0)
  });
});

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🧪 MOCK DEMO - Rotation Logic Proof                      ║
║                                                            ║
║  This simulates the gateway without OpenCode installed    ║
║  Each account has 10 request quota (instead of 200)       ║
║  Watch it automatically rotate when quota hits!           ║
║                                                            ║
║  📡 API: http://localhost:${PORT}/v1/chat/completions          ║
║  🏥 Health: http://localhost:${PORT}/health                    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

🚀 Ready to demonstrate rotation logic!

Test it:
  node test-mock-gateway.mjs 25

Expected behavior:
  - Requests 1-10: Account 1 serves
  - Request 11: 🔄 ROTATION to Account 2
  - Requests 11-20: Account 2 serves
  - Request 21: 🔄 ROTATION to Account 3
  - Requests 21-30: Account 3 serves
  - Request 31: ❌ All exhausted

This proves rotation works! ✅
  `);
});
