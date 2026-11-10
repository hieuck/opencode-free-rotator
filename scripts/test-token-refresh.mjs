import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

console.log('🔄 OpenCode OAuth Token Refresh Test\n');

try {
  const db = new Database(dbPath, { readonly: true });

  // Get OpenCode credential
  const cred = db.prepare(`
    SELECT id, integration_id, label, value
    FROM credential
    WHERE integration_id = 'opencode'
  `).get();

  if (!cred) {
    console.log('❌ No OpenCode credential found');
    process.exit(1);
  }

  const credValue = JSON.parse(cred.value);
  const { refresh, access, expires, metadata } = credValue;

  console.log('📋 Current Token Status:');
  console.log(`  Email: ${metadata.email}`);
  console.log(`  Access Token: ${access.substring(0, 15)}...`);
  console.log(`  Refresh Token: ${refresh.substring(0, 15)}...`);
  
  const expiryDate = new Date(expires);
  const now = new Date();
  const hoursUntilExpiry = Math.round((expiryDate - now) / 1000 / 3600);
  
  console.log(`  Expires: ${expiryDate.toLocaleString()}`);
  console.log(`  Time until expiry: ${hoursUntilExpiry} hours`);
  console.log('');

  // Prepare refresh request
  const refreshEndpoint = `${metadata.server}/v1/oauth/token`;
  
  console.log('🔧 Refresh Request:');
  console.log(`  Endpoint: ${refreshEndpoint}`);
  console.log(`  Method: POST`);
  console.log(`  Body: {`);
  console.log(`    grant_type: "refresh_token",`);
  console.log(`    refresh_token: "${refresh.substring(0, 15)}..."`);
  console.log(`  }`);
  console.log('');

  console.log('⚠️  Token refresh test (dry-run mode)');
  console.log('');
  console.log('To test refresh, run:');
  console.log('  node scripts/test-token-refresh.mjs --execute');

  db.close();
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
}
