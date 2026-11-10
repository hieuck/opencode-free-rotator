#!/usr/bin/env node
/**
 * Guided Account 2 Setup with Token Capture
 * Helps user authenticate Account 2 and automatically capture tokens
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { existsSync } from 'fs';
import { spawn } from 'child_process';

const DATA_DIR = join(os.homedir(), '.local/share/opencode');
const DB2_PATH = join(DATA_DIR, 'db2.db');

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🚀 Account 2 Setup Assistant                             ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

console.log('🎯 Goal: Authenticate Account 2 and capture tokens');
console.log('');

// Check if db2.db already exists
if (existsSync(DB2_PATH)) {
  console.log('✅ db2.db already exists!');
  console.log('');
  console.log('Verifying credentials...');
  
  try {
    const db2 = new Database(DB2_PATH, { readonly: true });
    const cred = db2.prepare(`
      SELECT * FROM credential 
      WHERE integration_id = 'opencode'
      ORDER BY time_created DESC 
      LIMIT 1
    `).get();
    db2.close();
    
    if (cred) {
      const value = JSON.parse(cred.value);
      console.log('✅ Account 2 credentials found:');
      console.log(`   Email: ${value.metadata?.email || 'N/A'}`);
      console.log(`   Account ID: ${value.metadata?.accountID || 'N/A'}`);
      console.log(`   Token: ${value.access?.substring(0, 15)}...`);
      console.log('');
      console.log('🎉 Account 2 is ready!');
      console.log('');
      console.log('Test it:');
      console.log('  $env:OPENCODE_DB="' + DB2_PATH + '"');
      console.log('  opencode');
      console.log('  > /model opencode/deepseek-v4.1-flash-free');
      console.log('  > /ask Test Account 2');
      process.exit(0);
    }
  } catch (err) {
    console.log('⚠️  db2.db exists but credentials not found');
    console.log('');
  }
}

console.log('📋 STEP-BY-STEP GUIDE:');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Step 1: Authenticate Account 2');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('Run these commands:');
console.log('');
console.log('# Windows PowerShell:');
console.log('$env:OPENCODE_DB="' + DB2_PATH + '"');
console.log('opencode');
console.log('');
console.log('# In OpenCode CLI:');
console.log('> /connect');
console.log('');
console.log('⚠️  IMPORTANT: Use a DIFFERENT email than Account 1!');
console.log('   Account 1: hieuck.dev@gmail.com');
console.log('   Account 2: Use another email!');
console.log('');
console.log('Options for Account 2 email:');
console.log('  1. Another Gmail account you own');
console.log('  2. Outlook/Hotmail account');
console.log('  3. Temp email from https://temp-mail.org');
console.log('  4. Create new Gmail account (takes 2 minutes)');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Step 2: Verify Account 2 Works');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('Still in OpenCode with Account 2:');
console.log('> /model opencode/deepseek-v4.1-flash-free');
console.log('> /ask Write "Account 2 works!"');
console.log('');
console.log('✅ If you get response → Account 2 has fresh quota!');
console.log('❌ If error → Something went wrong, try again');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Step 3: Run This Script Again');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('After successful authentication:');
console.log('  node setup-account2.mjs');
console.log('');
console.log('This script will verify db2.db is ready!');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Step 4: Start Gateway (Auto-Rotation)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('Once Account 2 is verified:');
console.log('  node src/SimpleGateway.mjs');
console.log('');
console.log('Gateway will automatically:');
console.log('  Account 1 exhausted → Switch to Account 2 → Keep working!');
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');
console.log('💡 Quick Summary:');
console.log('');
console.log('1. Set OPENCODE_DB to db2.db path ✅');
console.log('2. Run: opencode');
console.log('3. Connect with different email');
console.log('4. Test that it works');
console.log('5. Run this script to verify');
console.log('6. Start gateway → Automatic rotation! 🚀');
console.log('');
console.log('⏱️  Total time: 5 minutes');
console.log('🎯 Result: 400 req/day (Account 1 + Account 2)');
console.log('');
