import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

console.log('🔑 OpenCode Credentials\n');

try {
  const db = new Database(dbPath, { readonly: true });

  const credentials = db.prepare(`
    SELECT 
      id,
      integration_id,
      label,
      connector_id,
      method_id,
      active,
      SUBSTR(value, 1, 20) || '...' as value_preview,
      datetime(time_created, 'unixepoch') as created,
      datetime(time_updated, 'unixepoch') as updated
    FROM credential
    ORDER BY time_created DESC
  `).all();

  console.log(`Found ${credentials.length} credentials:\n`);
  
  credentials.forEach((cred, i) => {
    console.log(`[${i + 1}] ${cred.integration_id || 'N/A'}`);
    console.log(`    ID: ${cred.id}`);
    console.log(`    Label: ${cred.label || '(none)'}`);
    console.log(`    Connector: ${cred.connector_id || 'N/A'}`);
    console.log(`    Method: ${cred.method_id || 'N/A'}`);
    console.log(`    Active: ${cred.active === 1 ? 'Yes' : 'No'}`);
    console.log(`    Value: ${cred.value_preview}`);
    console.log(`    Created: ${cred.created}`);
    console.log(`    Updated: ${cred.updated}`);
    console.log('');
  });

  // Check account table structure
  console.log('\n📊 Account Table Structure:');
  const accountSchema = db.prepare(`PRAGMA table_info(account)`).all();
  accountSchema.forEach(col => {
    console.log(`  - ${col.name} (${col.type})`);
  });

  const accountCount = db.prepare(`SELECT COUNT(*) as count FROM account`).get();
  console.log(`\nTotal accounts: ${accountCount.count}`);

  db.close();
} catch (error) {
  console.error('❌ Error:', error.message);
}
