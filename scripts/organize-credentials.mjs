#!/usr/bin/env node
/**
 * Auto-organize credentials into separate databases
 * Each database = 1 unique email
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import os from 'os';
import { existsSync, copyFileSync, unlinkSync } from 'fs';

const DATA_DIR = join(os.homedir(), '.local/share/opencode');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║                                                            ║');
console.log('║  🔧 Auto-Organize OpenCode Credentials                    ║');
console.log('║                                                            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Collect all unique credentials
const allCredentials = new Map();

for (let i = 1; i <= 3; i++) {
  const dbPath = i === 1 
    ? join(DATA_DIR, 'opencode.db')
    : join(DATA_DIR, `db${i}.db`);
  
  if (!existsSync(dbPath)) continue;
  
  try {
    const db = new Database(dbPath, { readonly: true });
    const creds = db.prepare(`
      SELECT * FROM credential 
      WHERE integration_id = 'opencode'
      ORDER BY time_created DESC
    `).all();
    db.close();
    
    creds.forEach(cred => {
      const value = JSON.parse(cred.value);
      const email = value.metadata?.email || 'Unknown';
      
      if (!allCredentials.has(email)) {
        allCredentials.set(email, {
          email,
          credential: cred,
          sourceDb: dbPath
        });
      }
    });
  } catch (err) {
    console.error(`❌ Error reading ${dbPath}:`, err.message);
  }
}

console.log(`📊 Found ${allCredentials.size} unique credential(s):\n`);

const emails = Array.from(allCredentials.keys());
emails.forEach((email, i) => {
  console.log(`   ${i + 1}. ${email}`);
});

if (emails.length === 0) {
  console.log('\n❌ No credentials found! Please add accounts first.\n');
  process.exit(1);
}

console.log('\n🔄 Organizing credentials...\n');

// Backup existing databases
const backupDir = join(DATA_DIR, 'backup-' + Date.now());
console.log(`📦 Creating backup in: ${backupDir}\n`);

import { mkdirSync } from 'fs';
mkdirSync(backupDir, { recursive: true });

for (let i = 1; i <= 3; i++) {
  const dbPath = i === 1 
    ? join(DATA_DIR, 'opencode.db')
    : join(DATA_DIR, `db${i}.db`);
  
  if (existsSync(dbPath)) {
    const backupPath = join(backupDir, i === 1 ? 'opencode.db' : `db${i}.db`);
    copyFileSync(dbPath, backupPath);
    console.log(`   ✅ Backed up ${i === 1 ? 'opencode.db' : `db${i}.db`}`);
  }
}

console.log('\n🔨 Creating clean databases...\n');

// Get a clean template database
const templateDb = join(DATA_DIR, 'opencode.db');
if (!existsSync(templateDb)) {
  console.error('\n❌ opencode.db not found! Cannot create template.\n');
  process.exit(1);
}

// Assign emails to slots
const assignments = [];
emails.forEach((email, index) => {
  if (index < 3) {
    const slot = index + 1;
    const dbPath = slot === 1 
      ? join(DATA_DIR, 'opencode.db')
      : join(DATA_DIR, `db${slot}.db`);
    
    assignments.push({
      slot,
      email,
      dbPath,
      credential: allCredentials.get(email).credential
    });
  }
});

// Clear and rebuild each database
assignments.forEach(assignment => {
  console.log(`   Slot ${assignment.slot}: ${assignment.email}`);
  
  // Copy template
  if (assignment.slot > 1) {
    copyFileSync(templateDb, assignment.dbPath);
  }
  
  // Open database and clear old credentials
  const db = new Database(assignment.dbPath);
  
  // Delete all existing OpenCode credentials
  db.prepare(`DELETE FROM credential WHERE integration_id = 'opencode'`).run();
  
  // Insert the assigned credential
  const cred = assignment.credential;
  db.prepare(`
    INSERT INTO credential (id, integration_id, method_id, value, time_created, time_updated, active, label, connector_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    cred.id,
    cred.integration_id,
    cred.method_id,
    cred.value,
    cred.time_created,
    cred.time_updated || cred.time_created,
    cred.active || 1,
    cred.label || null,
    cred.connector_id || null
  );
  
  db.close();
  console.log(`      ✅ Configured ${assignment.slot === 1 ? 'opencode.db' : `db${assignment.slot}.db`}`);
});

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║                                                            ║');
console.log('║  ✅ Organization Complete!                                ║');
console.log('║                                                            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📊 Final Setup:\n');

assignments.forEach(a => {
  console.log(`   Slot ${a.slot}: ${a.email}`);
});

console.log(`\n📈 Total Capacity: ${assignments.length * 200} req/day\n`);
console.log(`📦 Backup saved in: ${backupDir}\n`);
