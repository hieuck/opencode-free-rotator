#!/usr/bin/env node
/**
 * OpenCode OAuth Automation Script
 * Simple wrapper that just runs OpenCode auth with correct database
 */

import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

const SLOT = parseInt(process.argv[2]);
const DB_PATH = process.argv[3];

console.log(`🔧 Setting up Account ${SLOT}`);
console.log(`📂 Database: ${DB_PATH}`);
console.log();

// Ensure database directory exists
const dbDir = dirname(DB_PATH);
if (!existsSync(dbDir)) {
  mkdirSync(dbDir, { recursive: true });
}

/**
 * Run OpenCode auth login
 */
async function runOpenCodeAuth() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting OpenCode auth login...');
    console.log('   (Browser will open automatically by OpenCode)');
    console.log();
    
    // Build PowerShell command with environment variable
    const psCommand = SLOT > 1
      ? `$env:OPENCODE_DB="${DB_PATH}"; opencode auth login opencode`
      : 'opencode auth login opencode';
    
    // Spawn with full TTY so OpenCode can interact
    const proc = spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      psCommand
    ], {
      stdio: 'inherit'  // Full terminal passthrough
    });
    
    proc.on('close', (code) => {
      console.log();
      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(`OpenCode auth failed with code ${code}`));
      }
    });
    
    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Check if credential was saved
 */
function checkCredential() {
  if (!existsSync(DB_PATH)) {
    return false;
  }
  
  try {
    const db = new Database(DB_PATH, { readonly: true });
    const cred = db.prepare(`
      SELECT * FROM credential 
      WHERE integration_id = 'opencode'
      ORDER BY time_created DESC LIMIT 1
    `).get();
    db.close();
    
    if (cred) {
      const value = JSON.parse(cred.value);
      console.log();
      console.log('✅ Credential saved successfully!');
      console.log(`📧 Email: ${value.metadata?.email || 'Unknown'}`);
      console.log();
      return true;
    }
  } catch (err) {
    console.error('Error checking credential:', err.message);
  }
  
  return false;
}

/**
 * Main execution
 */
async function main() {
  try {
    // Run OpenCode auth login
    await runOpenCodeAuth();
    
    // Check if credential was saved
    if (checkCredential()) {
      process.exit(0);
    } else {
      console.error('❌ Credential was not saved to database');
      process.exit(1);
    }
    
  } catch (err) {
    console.error();
    console.error('❌ Error:', err.message);
    console.error();
    process.exit(1);
  }
}

main();
