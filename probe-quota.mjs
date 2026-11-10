#!/usr/bin/env node
/**
 * Probe OpenCode API - Direct Quota Test
 * Tests quota limits by calling API directly with extracted tokens
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';

const DATA_DIR = join(os.homedir(), '.local/share/opencode');
const API_BASE = 'https://api.opencode.ai';

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🧪 OpenCode API Probe - Direct Quota Test                ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

function getToken(dbPath) {
  try {
    const db = new Database(dbPath, { readonly: true });
    const cred = db.prepare(`
      SELECT value FROM credential 
      WHERE integration_id = 'opencode'
      ORDER BY time_created DESC LIMIT 1
    `).get();
    db.close();
    
    if (!cred) return null;
    
    const value = JSON.parse(cred.value);
    return {
      access: value.access,
      email: value.metadata?.email,
      accountID: value.metadata?.accountID
    };
  } catch (err) {
    return null;
  }
}

async function testQuota(token, accountName) {
  console.log(`\n🧪 Testing ${accountName}...`);
  console.log(`   Email: ${token.email}`);
  console.log(`   Account: ${token.accountID}`);
  console.log(`   Token: ${token.access.substring(0, 15)}...`);
  
  try {
    // Try to get models list (simple API call)
    const response = await fetch(`${API_BASE}/model`, {
      headers: {
        'Authorization': `Bearer ${token.access}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ API Response: ${response.status} ${response.statusText}`);
      console.log(`   ✅ Models available: ${data.items?.length || 0}`);
      return { success: true, status: response.status };
    } else {
      const error = await response.text();
      console.log(`   ❌ API Response: ${response.status} ${response.statusText}`);
      
      if (response.status === 429) {
        console.log(`   ❌ QUOTA EXCEEDED!`);
        return { success: false, status: 429, quotaExceeded: true };
      }
      
      console.log(`   ❌ Error: ${error.substring(0, 100)}`);
      return { success: false, status: response.status };
    }
  } catch (err) {
    console.log(`   ❌ Network Error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

async function testSession(token, accountName) {
  console.log(`\n🧪 Testing Session API for ${accountName}...`);
  
  try {
    // Try to list sessions
    const response = await fetch(`${API_BASE}/session?limit=1`, {
      headers: {
        'Authorization': `Bearer ${token.access}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (response.ok) {
      const data = await response.json();
      console.log(`   ✅ Session API works!`);
      console.log(`   ✅ Sessions found: ${data.items?.length || 0}`);
      return { success: true };
    } else if (response.status === 429) {
      console.log(`   ❌ QUOTA EXCEEDED on Session API!`);
      return { success: false, quotaExceeded: true };
    } else {
      console.log(`   ❌ Error: ${response.status}`);
      return { success: false };
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    return { success: false };
  }
}

// Main
(async () => {
  console.log('🔍 Step 1: Extract tokens from databases...\n');
  
  const account1 = getToken(join(DATA_DIR, 'opencode.db'));
  const account2 = getToken(join(DATA_DIR, 'db2.db'));
  
  if (!account1) {
    console.log('❌ Account 1 not found. Please authenticate first.');
    process.exit(1);
  }
  
  console.log('✅ Account 1 found');
  if (account2) {
    console.log('✅ Account 2 found');
  } else {
    console.log('⚠️  Account 2 not found (OK for now)');
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔍 Step 2: Test Account 1 quota status...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  const result1 = await testQuota(account1, 'Account 1');
  await testSession(account1, 'Account 1');
  
  if (account2) {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 Step 3: Test Account 2 quota status...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const result2 = await testQuota(account2, 'Account 2');
    await testSession(account2, 'Account 2');
    
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 COMPARISON:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`Account 1: ${result1.quotaExceeded ? '❌ QUOTA EXCEEDED' : result1.success ? '✅ WORKING' : '⚠️  ERROR'}`);
    console.log(`Account 2: ${result2.quotaExceeded ? '❌ QUOTA EXCEEDED' : result2.success ? '✅ WORKING' : '⚠️  ERROR'}`);
    console.log('');
    
    if (result1.quotaExceeded && result2.success) {
      console.log('╔════════════════════════════════════════════════════════════╗');
      console.log('║                                                            ║');
      console.log('║  🏆 ROTATION PROVEN! ✅                                   ║');
      console.log('║                                                            ║');
      console.log('║  Account 1: Quota exceeded ❌                             ║');
      console.log('║  Account 2: Still working ✅                              ║');
      console.log('║                                                            ║');
      console.log('║  Different accounts = Independent quotas! 🚀              ║');
      console.log('║  Gateway rotation is VALID!                               ║');
      console.log('║                                                            ║');
      console.log('╚════════════════════════════════════════════════════════════╝');
    } else if (result1.success && result2.success) {
      console.log('✅ Both accounts working - neither has hit quota yet');
      console.log('   Use them until one hits quota, then rotation will work!');
    } else if (result1.quotaExceeded && result2.quotaExceeded) {
      console.log('⚠️  Both accounts quota exceeded');
      console.log('   Wait until tomorrow for quota reset');
    }
  } else {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 RESULT:');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log(`Account 1: ${result1.quotaExceeded ? '❌ QUOTA EXCEEDED' : result1.success ? '✅ WORKING' : '⚠️  ERROR'}`);
    console.log('');
    console.log('To prove rotation, authenticate Account 2:');
    console.log('  OPENCODE_DB=~/.local/share/opencode/db2.db opencode');
    console.log('  > /connect');
    console.log('');
    console.log('Then run this script again to compare!');
  }
  
  console.log('');
})();
