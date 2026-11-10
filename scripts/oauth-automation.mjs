#!/usr/bin/env node
/**
 * OpenCode OAuth Automation Script
 * Uses OpenCode device flow - fully automated!
 */

import { spawn } from 'child_process';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import open from 'open';

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
 * Run OpenCode auth login with auto browser opening
 */
async function runOpenCodeAuth() {
  return new Promise((resolve, reject) => {
    console.log('🚀 Starting OpenCode device flow...');
    console.log();
    
    const env = { ...process.env };
    if (SLOT > 1) {
      env.OPENCODE_DB = DB_PATH;
    }
    
    // Spawn opencode auth login
    const proc = spawn('opencode', ['auth', 'login', 'opencode'], {
      env,
      stdio: ['inherit', 'pipe', 'pipe']
    });
    
    let output = '';
    let oauthUrl = null;
    let browserOpened = false;
    
    proc.stdout.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      // Print output
      process.stdout.write(text);
      
      // Look for OAuth URL and auto-open browser
      if (!browserOpened) {
        // Match verification_uri_complete or Go to: URL
        const urlMatch = text.match(/https:\/\/console\.opencode\.ai[^\s]+/);
        if (urlMatch) {
          oauthUrl = urlMatch[0];
          browserOpened = true;
          
          // Auto-open browser after a short delay
          setTimeout(async () => {
            console.log();
            console.log('🌐 Opening browser automatically...');
            console.log();
            try {
              await open(oauthUrl);
            } catch (err) {
              console.error('Could not open browser:', err.message);
              console.error('Please open manually:', oauthUrl);
            }
          }, 1000);
        }
      }
    });
    
    proc.stderr.on('data', (data) => {
      process.stderr.write(data);
    });
    
    proc.on('close', (code) => {
      console.log();
      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(`OpenCode auth failed with code ${code}`));
      }
    });
    
    // Timeout after 5 minutes
    setTimeout(() => {
      proc.kill();
      reject(new Error('Timeout waiting for authorization'));
    }, 300000);
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
    // Run OpenCode auth login (it handles device flow internally)
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
