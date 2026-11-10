#!/usr/bin/env node
/**
 * Import Account 2 Credentials into db2.db
 * Usage: node import-account2.mjs account2-creds.json
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { readFileSync, existsSync, copyFileSync } from 'fs';
import { randomUUID } from 'crypto';

const DATA_DIR = join(os.homedir(), '.local/share/opencode');
const DB1_PATH = join(DATA_DIR, 'opencode.db');
const DB2_PATH = join(DATA_DIR, 'db2.db');

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🔄 Import Account 2 Credentials                          ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

// Get credentials file path from command line
const credsFile = process.argv[2];

if (!credsFile) {
  console.log('❌ Usage: node import-account2.mjs <credentials-file.json>');
  console.log('');
  console.log('Example:');
  console.log('  node import-account2.mjs account2-creds.json');
  console.log('');
  console.log('Credentials file format:');
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
  process.exit(1);
}

if (!existsSync(credsFile)) {
  console.log(`❌ Credentials file not found: ${credsFile}`);
  process.exit(1);
}

// Read and validate credentials
console.log(`📄 Reading credentials from: ${credsFile}`);
let creds;
try {
  creds = JSON.parse(readFileSync(credsFile, 'utf-8'));
} catch (err) {
  console.log(`❌ Failed to parse JSON: ${err.message}`);
  process.exit(1);
}

// Validate required fields
const required = ['type', 'access', 'refresh', 'expires'];
for (const field of required) {
  if (!creds[field]) {
    console.log(`❌ Missing required field: ${field}`);
    process.exit(1);
  }
}

if (!creds.metadata?.email || !creds.metadata?.accountID) {
  console.log('❌ Missing metadata.email or metadata.accountID');
  process.exit(1);
}

console.log('✅ Credentials validated:');
console.log(`   Email: ${creds.metadata.email}`);
console.log(`   Account ID: ${creds.metadata.accountID}`);
console.log(`   Access Token: ${creds.access.substring(0, 15)}...`);
console.log(`   Refresh Token: ${creds.refresh.substring(0, 15)}...`);
console.log(`   Expires: ${creds.expires}`);
console.log('');

// Check if db2.db already exists
if (existsSync(DB2_PATH)) {
  console.log('⚠️  db2.db already exists!');
  console.log('   Backing up to db2.db.backup...');
  copyFileSync(DB2_PATH, DB2_PATH + '.backup');
  console.log('✅ Backup created');
  console.log('');
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔨 Step 1: Create db2.db with schema...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// Copy structure from db1
console.log('📋 Copying database schema from opencode.db...');
const db1 = new Database(DB1_PATH, { readonly: true });

// Get all CREATE statements
const tables = db1.prepare(`
  SELECT sql FROM sqlite_master 
  WHERE type='table' AND name NOT LIKE 'sqlite_%'
  ORDER BY tbl_name
`).all();

const indexes = db1.prepare(`
  SELECT sql FROM sqlite_master 
  WHERE type='index' AND name NOT LIKE 'sqlite_%' AND sql IS NOT NULL
  ORDER BY name
`).all();

db1.close();

// Create db2
const db2 = new Database(DB2_PATH);

console.log(`✅ Creating ${tables.length} tables...`);
for (const { sql } of tables) {
  if (sql) db2.exec(sql);
}

console.log(`✅ Creating ${indexes.length} indexes...`);
for (const { sql } of indexes) {
  if (sql) db2.exec(sql);
}

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('🔨 Step 2: Insert Account 2 credentials...');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

const now = Date.now();
const credId = `cred_${randomUUID().replace(/-/g, '')}`;

const insert = db2.prepare(`
  INSERT INTO credential (
    id, 
    integration_id, 
    label, 
    value, 
    active, 
    time_created, 
    time_updated
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`);

insert.run(
  credId,
  'opencode',
  creds.metadata.email,
  JSON.stringify(creds),
  1,  // active
  now,
  now
);

console.log('✅ Credential inserted:');
console.log(`   ID: ${credId}`);
console.log(`   Integration: opencode`);
console.log(`   Label: ${creds.metadata.email}`);
console.log(`   Active: Yes`);
console.log('');

db2.close();

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('✅ SUCCESS! db2.db created with Account 2!');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('📍 Database location: ' + DB2_PATH);
console.log('');
console.log('🧪 Verify it works:');
console.log('');
console.log('   # Windows PowerShell:');
console.log('   $env:OPENCODE_DB="' + DB2_PATH + '"');
console.log('   opencode');
console.log('   > /model opencode/deepseek-v4.1-flash-free');
console.log('   > /ask Test Account 2');
console.log('');
console.log('   # Should work! Account 2 has fresh quota! ✅');
console.log('');
console.log('🚀 Next: Start gateway for automatic rotation:');
console.log('   node src/SimpleGateway.mjs');
console.log('');
