#!/usr/bin/env node
/**
 * Check if credential exists in database
 * Exit code 0 = found, 1 = not found
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';

const SLOT = parseInt(process.argv[2]);
const DB_PATH = process.argv[3];

if (!existsSync(DB_PATH)) {
  process.exit(1);
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
    console.log(`✅ Account ${SLOT}: ${value.metadata?.email || 'Unknown'}`);
    process.exit(0);
  }
} catch (err) {
  // Ignore
}

process.exit(1);
