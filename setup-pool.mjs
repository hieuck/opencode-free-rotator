#!/usr/bin/env node
/**
 * Automatic Account Pool Setup
 * No manual steps - fully automated!
 */

import { spawn } from 'child_process';
import { join } from 'path';
import os from 'os';
import { existsSync } from 'fs';
import Database from 'better-sqlite3';

const DATA_DIR = join(os.homedir(), '.local/share/opencode');

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🤖 Automatic Account Pool Setup                          ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

// Check current accounts
function checkAccounts() {
  const accounts = [];
  
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
          accounts.push({
            id: i,
            dbPath,
            email: value.metadata?.email || 'Unknown',
            authenticated: true
          });
        }
      } catch (err) {
        // ignore
      }
    }
  }
  
  return accounts;
}

const accounts = checkAccounts();

console.log(`📊 Current Status:\n`);
console.log(`   Authenticated Accounts: ${accounts.length}/3\n`);

accounts.forEach(acc => {
  console.log(`   ✅ Account ${acc.id}: ${acc.email}`);
});
console.log('');

if (accounts.length === 0) {
  console.log('❌ No accounts found!');
  console.log('');
  console.log('Setup Account 1 first:');
  console.log('   opencode');
  console.log('   > /connect');
  process.exit(1);
}

if (accounts.length === 3) {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║  ✅ ALL ACCOUNTS READY!                                   ║');
  console.log('║                                                            ║');
  console.log('║  3 accounts × 200 req/day = 600 req/day total! 🚀        ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log('Start gateway:');
  console.log('   node src/MultiAccountGateway.mjs');
  process.exit(0);
}

// Setup next account
const nextId = accounts.length + 1;
const nextDbPath = join(DATA_DIR, `db${nextId}.db`);

console.log(`🔧 Setting up Account ${nextId}...\n`);
console.log(`   Database: ${nextDbPath}`);
console.log(`   You need to authenticate with a DIFFERENT email!\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('⚠️  IMPORTANT:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const usedEmails = accounts.map(a => a.email).filter(e => e !== 'Unknown');
console.log(`   Already used: ${usedEmails.join(', ')}`);
console.log(`   Use DIFFERENT email for Account ${nextId}!\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`Starting OpenCode for Account ${nextId}...`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// Launch OpenCode with OPENCODE_DB set
const isWindows = process.platform === 'win32';

const proc = isWindows
  ? spawn('powershell.exe', [
      '-NoProfile',
      '-NoExit',
      '-Command',
      `$env:OPENCODE_DB="${nextDbPath}"; Write-Host "Account ${nextId} Database: ${nextDbPath}" -ForegroundColor Green; Write-Host "Run: /connect" -ForegroundColor Yellow; Write-Host "Login with DIFFERENT email!" -ForegroundColor Red; Write-Host ""; opencode`
    ], {
      stdio: 'inherit',
      detached: false
    })
  : spawn('bash', ['-c', `OPENCODE_DB="${nextDbPath}" opencode`], {
      stdio: 'inherit',
      detached: false
    });

proc.on('close', (code) => {
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ OpenCode closed');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  
  // Verify
  if (existsSync(nextDbPath)) {
    try {
      const db = new Database(nextDbPath, { readonly: true });
      const cred = db.prepare(`
        SELECT * FROM credential 
        WHERE integration_id = 'opencode'
        ORDER BY time_created DESC LIMIT 1
      `).get();
      db.close();
      
      if (cred) {
        const value = JSON.parse(cred.value);
        console.log(`✅ Account ${nextId} authenticated successfully!`);
        console.log(`   Email: ${value.metadata?.email}`);
        console.log(`   Account ID: ${value.metadata?.accountID}`);
        console.log('');
        
        const newTotal = accounts.length + 1;
        console.log(`📊 Pool Status: ${newTotal}/3 accounts ready`);
        console.log(`📈 Total Capacity: ${newTotal * 200} requests/day`);
        console.log('');
        
        if (newTotal < 3) {
          console.log(`To add Account ${newTotal + 1}:`);
          console.log('   node setup-pool.mjs');
        } else {
          console.log('╔════════════════════════════════════════════════════════════╗');
          console.log('║                                                            ║');
          console.log('║  🎉 ALL ACCOUNTS READY!                                   ║');
          console.log('║                                                            ║');
          console.log('╚════════════════════════════════════════════════════════════╝');
          console.log('');
          console.log('Start gateway:');
          console.log('   node src/MultiAccountGateway.mjs');
        }
      } else {
        console.log(`⚠️  Account ${nextId} database created but not authenticated`);
        console.log('   Run script again and make sure to /connect');
      }
    } catch (err) {
      console.log('❌ Error verifying account:', err.message);
    }
  } else {
    console.log('⚠️  Database not created. Authentication may have failed.');
  }
  
  console.log('');
});
