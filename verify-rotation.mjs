#!/usr/bin/env node
/**
 * Test Account Rotation
 * Verifies that gateway can rotate between accounts
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { existsSync } from 'fs';

const DATA_DIR = join(os.homedir(), '.local/share/opencode');

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🔍 Account Rotation Verification                         ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

console.log('📋 Step 1: Checking for databases...\n');

const accounts = [];

// Check opencode.db (Account 1)
const db1Path = join(DATA_DIR, 'opencode.db');
if (existsSync(db1Path)) {
  try {
    const db1 = new Database(db1Path, { readonly: true });
    const cred1 = db1.prepare(`
      SELECT * FROM credential 
      WHERE integration_id = 'opencode'
      ORDER BY time_created DESC 
      LIMIT 1
    `).get();
    db1.close();
    
    if (cred1) {
      const value = JSON.parse(cred1.value);
      accounts.push({
        id: 'Account 1',
        path: db1Path,
        email: value.metadata?.email || 'N/A',
        accountID: value.metadata?.accountID || 'N/A'
      });
      console.log('✅ Account 1 found:');
      console.log(`   Path: ${db1Path}`);
      console.log(`   Email: ${value.metadata?.email}`);
      console.log(`   Account ID: ${value.metadata?.accountID}`);
      console.log('');
    }
  } catch (err) {
    console.log('❌ Account 1 error:', err.message);
  }
}

// Check db2.db (Account 2)
const db2Path = join(DATA_DIR, 'db2.db');
if (existsSync(db2Path)) {
  try {
    const db2 = new Database(db2Path, { readonly: true });
    const cred2 = db2.prepare(`
      SELECT * FROM credential 
      WHERE integration_id = 'opencode'
      ORDER BY time_created DESC 
      LIMIT 1
    `).get();
    db2.close();
    
    if (cred2) {
      const value = JSON.parse(cred2.value);
      accounts.push({
        id: 'Account 2',
        path: db2Path,
        email: value.metadata?.email || 'N/A',
        accountID: value.metadata?.accountID || 'N/A'
      });
      console.log('✅ Account 2 found:');
      console.log(`   Path: ${db2Path}`);
      console.log(`   Email: ${value.metadata?.email}`);
      console.log(`   Account ID: ${value.metadata?.accountID}`);
      console.log('');
    }
  } catch (err) {
    console.log('⚠️  Account 2 exists but no credentials yet');
    console.log('   Path: ' + db2Path);
    console.log('   Status: Database created, needs authentication');
    console.log('');
  }
} else {
  console.log('❌ Account 2 not found: ' + db2Path);
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 VERIFICATION RESULT:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

if (accounts.length >= 2) {
  const uniqueEmails = new Set(accounts.map(a => a.email).filter(e => e !== 'N/A'));
  const uniqueAccountIDs = new Set(accounts.map(a => a.accountID).filter(e => e !== 'N/A'));
  
  console.log(`✅ Found ${accounts.length} accounts with credentials`);
  console.log(`✅ Unique emails: ${uniqueEmails.size}`);
  console.log(`✅ Unique account IDs: ${uniqueAccountIDs.size}`);
  console.log('');
  
  if (uniqueEmails.size === accounts.length && uniqueAccountIDs.size === accounts.length) {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                                                            ║');
    console.log('║  🎉 ROTATION READY! ✅                                    ║');
    console.log('║                                                            ║');
    console.log('║  Different accounts with different credentials!           ║');
    console.log('║  Gateway CAN rotate between them! 🚀                      ║');
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log('🚀 Start gateway:');
    console.log('   node src/GatewayWithUI.mjs');
    console.log('');
    console.log('🧪 Test rotation:');
    console.log('   curl -X POST http://localhost:3000/v1/chat/completions \\');
    console.log('     -H "Content-Type: application/json" \\');
    console.log('     -d \'{"model":"opencode/deepseek-v4.1-flash-free","messages":[{"role":"user","content":"Test"}]}\'');
  } else {
    console.log('⚠️  Warning: Some accounts share same credentials');
    console.log('   Use truly different email accounts for rotation to work');
  }
} else if (accounts.length === 1) {
  console.log(`✅ Found ${accounts.length} account`);
  console.log('⚠️  Need at least 2 accounts for rotation');
  console.log('');
  console.log('To add Account 2:');
  console.log('  $env:OPENCODE_DB="' + db2Path + '"');
  console.log('  opencode');
  console.log('  > /connect');
  console.log('  # Login with DIFFERENT email');
  console.log('');
  console.log('Then run this script again to verify!');
} else {
  console.log('❌ No accounts found');
  console.log('');
  console.log('Please authenticate at least one account:');
  console.log('  opencode');
  console.log('  > /connect');
}

console.log('');
