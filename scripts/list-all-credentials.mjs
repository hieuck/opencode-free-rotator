#!/usr/bin/env node
import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';

const dbPath = join(os.homedir(), '.local/share/opencode/opencode.db');
const db = new Database(dbPath, { readonly: true });

console.log('\n📋 All OpenCode credentials in opencode.db:\n');

const creds = db.prepare(`
  SELECT * FROM credential 
  WHERE integration_id = 'opencode'
  ORDER BY time_created DESC
`).all();

creds.forEach((cred, i) => {
  const value = JSON.parse(cred.value);
  const created = new Date(cred.time_created).toLocaleString();
  console.log(`${i + 1}. ${value.metadata?.email || 'Unknown'}`);
  console.log(`   Created: ${created}`);
  console.log(`   ID: ${cred.id}`);
  console.log();
});

db.close();

console.log(`Total: ${creds.length} credential(s)\n`);
