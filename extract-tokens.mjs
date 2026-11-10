#!/usr/bin/env node
/**
 * Extract OAuth Tokens from OpenCode Database
 * This proves different databases have different credentials
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_DIR = join(os.homedir(), '.local/share/opencode');

console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🔍 OpenCode Token Extractor - Rotation Proof             ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);

function extractTokens(dbPath, accountName) {
  try {
    const db = new Database(dbPath, { readonly: true });
    
    const credentials = db.prepare(`
      SELECT id, integration_id, label, value, active
      FROM credential
      WHERE integration_id = 'opencode'
      ORDER BY time_created DESC
      LIMIT 1
    `).get();
    
    db.close();
    
    if (!credentials) {
      return { exists: false, account: accountName };
    }
    
    const value = JSON.parse(credentials.value);
    
    return {
      exists: true,
      account: accountName,
      dbPath,
      label: credentials.label,
      active: credentials.active === 1,
      tokenType: value.type,
      hasAccess: !!value.access,
      hasRefresh: !!value.refresh,
      accessToken: value.access ? `${value.access.substring(0, 15)}...` : null,
      refreshToken: value.refresh ? `${value.refresh.substring(0, 15)}...` : null,
      expires: value.expires ? new Date(value.expires).toISOString() : null,
      email: value.metadata?.email || null,
      accountID: value.metadata?.accountID || null
    };
    
  } catch (err) {
    return {
      exists: false,
      account: accountName,
      error: err.message
    };
  }
}

// Check all databases
const accounts = [
  { path: join(DATA_DIR, 'opencode.db'), name: 'Account 1' },
  { path: join(DATA_DIR, 'db2.db'), name: 'Account 2' },
  { path: join(DATA_DIR, 'db3.db'), name: 'Account 3' }
];

console.log('🔍 Extracting credentials from databases...\n');

const results = [];

accounts.forEach(acc => {
  const result = extractTokens(acc.path, acc.name);
  results.push(result);
  
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`${acc.name}:`);
  
  if (result.exists) {
    console.log(`  ✅ Database: ${result.dbPath}`);
    console.log(`  ✅ Email: ${result.email || 'N/A'}`);
    console.log(`  ✅ Account ID: ${result.accountID || 'N/A'}`);
    console.log(`  ✅ Active: ${result.active ? 'Yes' : 'No'}`);
    console.log(`  ✅ Access Token: ${result.accessToken}`);
    console.log(`  ✅ Refresh Token: ${result.refreshToken}`);
    console.log(`  ✅ Expires: ${result.expires}`);
  } else {
    console.log(`  ❌ Not authenticated`);
    if (result.error) {
      console.log(`  ❌ Error: ${result.error}`);
    }
  }
  console.log('');
});

// Analysis
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 ANALYSIS:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

const authenticated = results.filter(r => r.exists);
const uniqueEmails = new Set(authenticated.map(r => r.email).filter(Boolean));
const uniqueAccountIDs = new Set(authenticated.map(r => r.accountID).filter(Boolean));
const uniqueAccessTokens = new Set(authenticated.map(r => r.accessToken).filter(Boolean));

console.log(`✅ Authenticated Accounts: ${authenticated.length}/${accounts.length}`);
console.log(`✅ Unique Emails: ${uniqueEmails.size}`);
console.log(`✅ Unique Account IDs: ${uniqueAccountIDs.size}`);
console.log(`✅ Unique Access Tokens: ${uniqueAccessTokens.size}`);
console.log('');

if (authenticated.length >= 2) {
  const different = uniqueAccessTokens.size === authenticated.length;
  
  if (different) {
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                                                            ║');
    console.log('║  🏆 ROTATION PROVEN! ✅                                   ║');
    console.log('║                                                            ║');
    console.log('║  Different databases have DIFFERENT credentials!          ║');
    console.log('║  Each account has unique access token                     ║');
    console.log('║  Gateway can rotate between independent quotas! 🚀        ║');
    console.log('║                                                            ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
  } else {
    console.log('⚠️  Warning: Some accounts share the same credentials');
    console.log('   This might mean quota is shared');
    console.log('   Use truly different email accounts for best results');
  }
} else {
  console.log('⚠️  Only ' + authenticated.length + ' account(s) authenticated');
  console.log('   Authenticate at least 2 accounts to prove rotation');
  console.log('');
  console.log('   Account 1: opencode');
  console.log('   Account 2: OPENCODE_DB=~/.local/share/opencode/db2.db opencode');
}

console.log('');
