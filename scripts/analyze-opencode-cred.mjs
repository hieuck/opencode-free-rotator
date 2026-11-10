import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

console.log('🔍 OpenCode Credential Value Structure\n');

try {
  const db = new Database(dbPath, { readonly: true });

  const opencodeCredential = db.prepare(`
    SELECT id, integration_id, label, value
    FROM credential
    WHERE integration_id = 'opencode'
  `).get();

  if (!opencodeCredential) {
    console.log('❌ No OpenCode credential found');
    db.close();
    process.exit(1);
  }

  console.log(`Integration: ${opencodeCredential.integration_id}`);
  console.log(`Label: ${opencodeCredential.label}`);
  console.log('');

  // Parse JSON value
  const credValue = JSON.parse(opencodeCredential.value);
  
  console.log('📋 Credential Structure:');
  console.log(`  Type: ${credValue.type}`);
  
  // Show keys (but mask sensitive values)
  Object.keys(credValue).forEach(key => {
    const value = credValue[key];
    
    if (key === 'type') return; // Already shown
    
    if (typeof value === 'string') {
      // Mask sensitive values
      const preview = value.length > 20 
        ? value.substring(0, 10) + '...' + value.substring(value.length - 10)
        : value.substring(0, 5) + '...';
      console.log(`  ${key}: ${preview} (length: ${value.length})`);
    } else if (typeof value === 'object') {
      console.log(`  ${key}: [Object with keys: ${Object.keys(value).join(', ')}]`);
    } else {
      console.log(`  ${key}: ${value}`);
    }
  });

  console.log('\n💡 Analysis:');
  if (credValue.type === 'oauth') {
    console.log('  - OAuth-based authentication (refresh token flow)');
    console.log('  - Can extract access_token, refresh_token, expiry');
    console.log('  - Need to implement OAuth refresh logic');
  } else if (credValue.type === 'key') {
    console.log('  - Simple API key authentication');
    console.log('  - Easier to pool - just rotate keys');
  }

  db.close();
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
}
