#!/usr/bin/env node
/**
 * List all OpenCode accounts
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { existsSync } from 'fs';

const DATA_DIR = join(os.homedir(), '.local/share/opencode');

function listAccounts() {
  const accounts = [];
  
  for (let i = 1; i <= 3; i++) {
    const dbPath = i === 1 
      ? join(DATA_DIR, 'opencode.db')
      : join(DATA_DIR, `db${i}.db`);
    
    if (!existsSync(dbPath)) {
      accounts.push({
        slot: i,
        status: 'empty',
        email: null
      });
      continue;
    }
    
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
          slot: i,
          status: 'connected',
          email: value.metadata?.email || 'Unknown'
        });
      } else {
        accounts.push({
          slot: i,
          status: 'empty',
          email: null
        });
      }
    } catch (err) {
      accounts.push({
        slot: i,
        status: 'error',
        email: null
      });
    }
  }
  
  return accounts;
}

// Main
const accounts = listAccounts();

console.log('');
console.log('📊 OpenCode Accounts:');
console.log('');

accounts.forEach(acc => {
  if (acc.status === 'connected') {
    console.log(`  ✅ Slot ${acc.slot}: ${acc.email}`);
  } else if (acc.status === 'empty') {
    console.log(`  ⚪ Slot ${acc.slot}: (empty)`);
  } else {
    console.log(`  ❌ Slot ${acc.slot}: (error)`);
  }
});

console.log('');

const connected = accounts.filter(a => a.status === 'connected').length;
const capacity = connected * 200;

console.log(`📈 Total Capacity: ${capacity} req/day (${connected}/3 accounts)`);
console.log('');

export { listAccounts };
