import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

console.log('📂 OpenCode Database:', dbPath);
console.log('');

try {
  const db = new Database(dbPath, { readonly: true });

  // List all tables
  console.log('📋 Tables:');
  const tables = db.prepare(`
    SELECT name FROM sqlite_master 
    WHERE type='table' 
    ORDER BY name
  `).all();
  
  tables.forEach(t => console.log(`  - ${t.name}`));
  console.log('');

  // Check for credentials/auth related tables
  const authTables = tables.filter(t => 
    t.name.toLowerCase().includes('auth') ||
    t.name.toLowerCase().includes('cred') ||
    t.name.toLowerCase().includes('key') ||
    t.name.toLowerCase().includes('provider')
  );

  if (authTables.length > 0) {
    console.log('🔑 Auth-related tables:');
    authTables.forEach(t => {
      console.log(`\n  Table: ${t.name}`);
      
      // Get schema
      const schema = db.prepare(`PRAGMA table_info(${t.name})`).all();
      console.log('    Columns:');
      schema.forEach(col => {
        console.log(`      - ${col.name} (${col.type})`);
      });

      // Count rows
      const count = db.prepare(`SELECT COUNT(*) as count FROM ${t.name}`).get();
      console.log(`    Rows: ${count.count}`);
    });
  }

  db.close();
} catch (error) {
  console.error('❌ Error:', error.message);
}
