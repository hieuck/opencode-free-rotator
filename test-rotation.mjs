#!/usr/bin/env node
/**
 * Test if we can rotate between accounts with separate quotas
 */

import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { existsSync } from 'fs';

const DATA_DIR = join(os.homedir(), '.local/share/opencode');

async function testAccount(slot, dbPath) {
  return new Promise((resolve) => {
    console.log(`\n🧪 Testing Account ${slot}...`);
    console.log(`   Database: ${dbPath}`);
    
    if (!existsSync(dbPath)) {
      console.log(`   ❌ Database not found!`);
      resolve({ slot, success: false, error: 'Database not found' });
      return;
    }
    
    // Check credential exists
    try {
      const db = new Database(dbPath, { readonly: true });
      const cred = db.prepare(`
        SELECT * FROM credential 
        WHERE integration_id = 'opencode'
        ORDER BY time_created DESC LIMIT 1
      `).get();
      db.close();
      
      if (!cred) {
        console.log(`   ❌ No credential found!`);
        resolve({ slot, success: false, error: 'No credential' });
        return;
      }
      
      const value = JSON.parse(cred.value);
      console.log(`   ✅ Credential: ${value.metadata?.email || 'Unknown'}`);
    } catch (err) {
      console.log(`   ❌ Error reading credential: ${err.message}`);
      resolve({ slot, success: false, error: err.message });
      return;
    }
    
    // Try to make a request
    console.log(`   📡 Making test request...`);
    
    const env = { ...process.env };
    if (slot > 1) {
      env.OPENCODE_DB = dbPath;
    }
    
    const proc = spawn('opencode.cmd', ['ask', 'Say "Test"', '--non-interactive'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });
    
    let output = '';
    let error = '';
    
    proc.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    proc.stderr.on('data', (data) => {
      error += data.toString();
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`   ✅ Request succeeded!`);
        resolve({ slot, success: true, output });
      } else {
        console.log(`   ❌ Request failed (code ${code})`);
        if (error.includes('429') || error.includes('quota')) {
          console.log(`   ⚠️  Quota exhausted!`);
          resolve({ slot, success: false, error: 'Quota exhausted' });
        } else {
          resolve({ slot, success: false, error: error || 'Unknown error' });
        }
      }
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      proc.kill();
      console.log(`   ⏱️  Timeout`);
      resolve({ slot, success: false, error: 'Timeout' });
    }, 30000);
  });
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║  🧪 OpenCode Account Rotation Test                        ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  
  const accounts = [
    { slot: 1, dbPath: join(DATA_DIR, 'opencode.db') },
    { slot: 2, dbPath: join(DATA_DIR, 'db2.db') },
    { slot: 3, dbPath: join(DATA_DIR, 'db3.db') }
  ];
  
  const results = [];
  
  for (const acc of accounts) {
    const result = await testAccount(acc.slot, acc.dbPath);
    results.push(result);
  }
  
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║  📊 Test Results                                          ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');
  
  const working = results.filter(r => r.success);
  
  results.forEach(r => {
    if (r.success) {
      console.log(`✅ Account ${r.slot}: Working`);
    } else {
      console.log(`❌ Account ${r.slot}: ${r.error}`);
    }
  });
  
  console.log();
  console.log(`📈 Working accounts: ${working.length}/${results.length}`);
  console.log(`📈 Total capacity: ${working.length * 200} req/day`);
  console.log();
  
  if (working.length >= 2) {
    console.log('✅ ROTATION POSSIBLE! You can bypass the 200 req/day limit!');
  } else if (working.length === 1) {
    console.log('⚠️  Only 1 account working. Need at least 2 for rotation.');
  } else {
    console.log('❌ No working accounts. Please add accounts first.');
  }
  
  console.log();
}

main();
