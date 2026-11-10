#!/usr/bin/env node
import Database from 'better-sqlite3';

const dbPath = process.argv[2] || 'C:/Users/hieut/.local/share/opencode/db2.db';
const db = new Database(dbPath, { readonly: true });

console.log(`\n📋 Credentials in ${dbPath}:\n`);

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
  console.log(`   Org: ${value.metadata?.orgName || 'N/A'}`);
  console.log();
});

db.close();

console.log(`Total: ${creds.length} credential(s)\n`);
