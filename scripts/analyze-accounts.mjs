#!/usr/bin/env node
/**
 * Test if accounts are truly independent
 * by making requests directly to each OpenCode server
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';

const DATA_DIR = join(os.homedir(), '.local/share/opencode');

console.log('\n🔍 Analyzing account credentials...\n');

// Check both databases
const db1 = new Database(join(DATA_DIR, 'opencode.db'), { readonly: true });
const db2 = new Database(join(DATA_DIR, 'db2.db'), { readonly: true });

const cred1 = db1.prepare(`
  SELECT * FROM credential 
  WHERE integration_id = 'opencode'
  ORDER BY time_created DESC LIMIT 1
`).get();

const cred2 = db2.prepare(`
  SELECT * FROM credential 
  WHERE integration_id = 'opencode'
  ORDER BY time_created DESC LIMIT 1
`).get();

db1.close();
db2.close();

if (!cred1 || !cred2) {
  console.log('❌ Missing credentials!');
  process.exit(1);
}

const val1 = JSON.parse(cred1.value);
const val2 = JSON.parse(cred2.value);

console.log('Account 1:');
console.log('  Email:', val1.metadata?.email);
console.log('  Org:', val1.metadata?.orgName);
console.log('  Created:', new Date(cred1.time_created).toLocaleString());
console.log();

console.log('Account 2:');
console.log('  Email:', val2.metadata?.email);
console.log('  Org:', val2.metadata?.orgName);
console.log('  Created:', new Date(cred2.time_created).toLocaleString());
console.log();

// Check if they share the same underlying credential
const token1 = val1.access;
const token2 = val2.access;

if (token1 && token2) {
  const match = token1 === token2;
  
  console.log('Token comparison:');
  console.log('  Account 1 token:', token1.substring(0, 20) + '...');
  console.log('  Account 2 token:', token2.substring(0, 20) + '...');
  console.log();
  
  if (match) {
    console.log('⚠️  WARNING: Both accounts use THE SAME TOKEN!');
    console.log('   This means they share the same quota pool.');
    console.log('   You need to login with DIFFERENT emails!\n');
  } else {
    console.log('✅ Accounts have DIFFERENT tokens');
    console.log('   They should have independent quotas.\n');
  }
} else {
  console.log('ℹ️  Could not compare tokens (may be in different format)\n');
  console.log('Raw credential structures:');
  console.log('Account 1:', Object.keys(val1));
  console.log('Account 2:', Object.keys(val2));
  console.log();
}
