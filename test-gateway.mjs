#!/usr/bin/env node
/**
 * Test Client - Prove Gateway Works
 * 
 * This script will:
 * 1. Send requests until quota is hit
 * 2. Verify automatic rotation to next account
 * 3. Show that we can exceed 200 req/day limit
 * 
 * Usage: node test-gateway.mjs [num_requests]
 */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';
const NUM_REQUESTS = parseInt(process.argv[2]) || 10;

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🧪 Testing OpenCode Gateway - Rotation Proof             ║
║                                                            ║
║  Gateway: ${GATEWAY_URL.padEnd(48)}║
║  Requests: ${String(NUM_REQUESTS).padEnd(47)}║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

/**
 * Send a single test request
 */
async function sendRequest(index) {
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: `Test request #${index + 1}: Say "OK ${index + 1}" and nothing else`
          }
        ],
        model: 'deepseek-v4.1-flash-free'
      })
    });
    
    const elapsed = Date.now() - startTime;
    const data = await response.json();
    
    if (response.ok) {
      const account = data._meta?.account || 'Unknown';
      const used = data._meta?.quota_used || '?';
      const limit = data._meta?.quota_limit || '?';
      const remaining = data._meta?.quota_remaining || '?';
      
      console.log(`✅ Request ${index + 1}: ${account} (${used}/${limit}, ${remaining} left) - ${elapsed}ms`);
      console.log(`   Response: ${data.choices[0].message.content.substring(0, 50)}`);
      
      return {
        success: true,
        account,
        used,
        limit,
        remaining,
        elapsed
      };
    } else {
      console.error(`❌ Request ${index + 1}: ${response.status} ${response.statusText}`);
      console.error(`   Error: ${data.error?.message}`);
      
      return {
        success: false,
        error: data.error?.message,
        type: data.error?.type
      };
    }
    
  } catch (err) {
    console.error(`❌ Request ${index + 1}: Network error - ${err.message}`);
    return {
      success: false,
      error: err.message
    };
  }
}

/**
 * Check gateway health
 */
async function checkHealth() {
  try {
    const response = await fetch(`${GATEWAY_URL}/health`);
    const data = await response.json();
    
    console.log('\n📊 Gateway Health:');
    data.accounts.forEach(acc => {
      const bar = '█'.repeat(Math.floor(acc.used / acc.limit * 20));
      const empty = '░'.repeat(20 - Math.floor(acc.used / acc.limit * 20));
      console.log(`   ${acc.name}: [${bar}${empty}] ${acc.used}/${acc.limit} (${acc.remaining} remaining)`);
    });
    console.log(`   Total Remaining: ${data.total_remaining} requests\n`);
    
  } catch (err) {
    console.error(`⚠️  Could not fetch health: ${err.message}`);
  }
}

/**
 * Main test loop
 */
async function runTest() {
  console.log(`\n🚀 Starting test with ${NUM_REQUESTS} requests...\n`);
  
  await checkHealth();
  
  const results = [];
  const accountUsage = new Map();
  
  for (let i = 0; i < NUM_REQUESTS; i++) {
    const result = await sendRequest(i);
    results.push(result);
    
    if (result.success) {
      const count = accountUsage.get(result.account) || 0;
      accountUsage.set(result.account, count + 1);
    }
    
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\n✅ Successful: ${successful}/${NUM_REQUESTS}`);
  console.log(`❌ Failed: ${failed}/${NUM_REQUESTS}`);
  
  if (accountUsage.size > 0) {
    console.log(`\n🔄 Account Rotation:`);
    accountUsage.forEach((count, account) => {
      console.log(`   ${account}: ${count} requests`);
    });
  }
  
  if (accountUsage.size > 1) {
    console.log(`\n🎉 ROTATION VERIFIED!`);
    console.log(`   Gateway automatically switched between ${accountUsage.size} accounts`);
  }
  
  console.log('\n');
  await checkHealth();
  
  // Check if we exceeded single account limit
  if (successful > 200) {
    console.log(`\n🏆 SUCCESS! Sent ${successful} requests (exceeded single account 200 limit)`);
    console.log(`   Proof that multi-account rotation works! ✅`);
  }
  
  console.log('\n' + '='.repeat(60));
}

/**
 * Run test with error handling
 */
(async () => {
  try {
    // First check if gateway is running
    console.log('🔍 Checking gateway availability...');
    const response = await fetch(`${GATEWAY_URL}/health`);
    
    if (!response.ok) {
      throw new Error('Gateway not responding');
    }
    
    console.log('✅ Gateway is running!\n');
    
    await runTest();
    
  } catch (err) {
    console.error(`\n❌ Gateway not available: ${err.message}`);
    console.error(`\nMake sure gateway is running:`);
    console.error(`  node src/SimpleGateway.mjs`);
    console.error(`\nOr use quick-start:`);
    console.error(`  ./quick-start.sh  # Linux/Mac`);
    console.error(`  quick-start.bat   # Windows`);
    process.exit(1);
  }
})();
