#!/usr/bin/env node
/**
 * Clone Account Credentials
 * Copy credentials from opencode.db to db2.db
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'fs';

const DATA_DIR = join(os.homedir(), '.local/share/opencode');
const DB1_PATH = join(DATA_DIR, 'opencode.db');
const DB2_PATH = join(DATA_DIR, 'db2.db');

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🔄 Account Credential Importer                           ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

// Step 1: Check if db2.db already exists
if (existsSync(DB2_PATH)) {
  console.log('⚠️  db2.db already exists!');
  console.log('   Remove it first if you want to replace it.');
  process.exit(1);
}

console.log('📋 Step 1: Understanding credential structure...\n');

// Read from Account 1
const db1 = new Database(DB1_PATH, { readonly: true });

// Get schema
const schema = db1.prepare(`
  SELECT sql FROM sqlite_master 
  WHERE type='table' AND name='credential'
`).get();

console.log('✅ Credential table schema:');
console.log(schema.sql);
console.log('');

// Get current credential
const cred = db1.prepare(`
  SELECT * FROM credential 
  WHERE integration_id = 'opencode'
  ORDER BY time_created DESC 
  LIMIT 1
`).get();

if (!cred) {
  console.log('❌ No credential found in opencode.db!');
  db1.close();
  process.exit(1);
}

console.log('✅ Found credential in Account 1:');
console.log(`   ID: ${cred.id}`);
console.log(`   Label: ${cred.label}`);
console.log(`   Integration: ${cred.integration_id}`);
console.log(`   Active: ${cred.active === 1 ? 'Yes' : 'No'}`);

const value = JSON.parse(cred.value);
console.log(`   Email: ${value.metadata?.email || 'N/A'}`);
console.log(`   Account ID: ${value.metadata?.accountID || 'N/A'}`);
console.log('');

db1.close();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📝 Step 2: Manual credential input for Account 2\n');

console.log('You need to provide Account 2 credentials in this format:');
console.log('');
console.log('{');
console.log('  "type": "oauth2",');
console.log('  "access": "st_xxx...",');
console.log('  "refresh": "rt_xxx...",');
console.log('  "expires": "2026-12-04T15:27:08.784Z",');
console.log('  "metadata": {');
console.log('    "email": "account2@example.com",');
console.log('    "accountID": "acc_xxx..."');
console.log('  }');
console.log('}');
console.log('');
console.log('Save this JSON to: account2-creds.json');
console.log('Then run this script again with --import flag');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('💡 How to get Account 2 credentials:');
console.log('');
console.log('Option 1: From existing authenticated account');
console.log('  1. Authenticate on another machine with Account 2');
console.log('  2. Run: node extract-tokens.mjs');
console.log('  3. Copy the access/refresh tokens');
console.log('');
console.log('Option 2: Capture during OAuth flow (Advanced)');
console.log('  1. Open browser devtools (Network tab)');
console.log('  2. Run: OPENCODE_DB=db2.db opencode');
console.log('  3. Do /connect and login with Account 2');
console.log('  4. Capture OAuth tokens from network requests');
console.log('  5. Format as JSON above');
console.log('');
console.log('⚠️  WARNING: Never share these tokens - they give full access!');
console.log('');
