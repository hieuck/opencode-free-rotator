#!/usr/bin/env node
/**
 * Verify Account Pool Status
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { existsSync } from 'fs';

const DATA_DIR = join(os.homedir(), '.local/share/opencode');

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  📊 Account Pool Status                                   ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

let totalAccounts = 0;

for (let i = 1; i <= 3; i++) {
  const dbPath = i === 1 
    ? join(DATA_DIR, 'opencode.db')
    : join(DATA_DIR, `db${i}.db`);
  
  console.log(`Account ${i}:`);
  console.log(`   DB Path: ${dbPath}`);
  
  if (!existsSync(dbPath)) {
    console.log(`   Status: ❌ Database not found`);
    console.log(`   Action: Connect via: $env:OPENCODE_DB="${dbPath}"; opencode`);
  } else {
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
        console.log(`   Status: ✅ Connected`);
        console.log(`   Email: ${value.metadata?.email || 'Unknown'}`);
        console.log(`   Account ID: ${value.metadata?.accountID || 'Unknown'}`);
        totalAccounts++;
      } else {
        console.log(`   Status: ⚠️  Database exists but not connected`);
        console.log(`   Action: Connect via: $env:OPENCODE_DB="${dbPath}"; opencode`);
      }
    } catch (err) {
      console.log(`   Status: ❌ Error: ${err.message}`);
    }
  }
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ Connected Accounts: ${totalAccounts}/3`);
console.log(`📈 Total Capacity: ${totalAccounts * 200} requests/day`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

if (totalAccounts === 0) {
  console.log('❌ No accounts connected!');
  console.log('');
  console.log('Setup Account 1:');
  console.log('   opencode');
  console.log('   > /connect');
} else if (totalAccounts < 3) {
  console.log(`⚠️  ${3 - totalAccounts} more account(s) needed for maximum capacity`);
  console.log('');
  console.log('To add more accounts, connect manually:');
  console.log(`   $env:OPENCODE_DB="${join(DATA_DIR, `db${totalAccounts + 1}.db`)}"; opencode`);
  console.log('   > /connect (use DIFFERENT email)');
} else {
  console.log('🎉 All accounts ready!');
  console.log('');
  console.log('Start gateway:');
  console.log('   node src/MultiAccountGateway.mjs');
}
console.log('');
