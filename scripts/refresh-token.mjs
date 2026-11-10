import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
const executeRefresh = process.argv.includes('--execute');

console.log('🔄 OpenCode OAuth Token Refresh\n');

async function refreshToken() {
  try {
    const db = new Database(dbPath, { readonly: !executeRefresh });

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

    console.log('📋 Current Token:');
    console.log(`  Email: ${metadata.email}`);
    console.log(`  Access: ${access.substring(0, 20)}...`);
    console.log(`  Expires: ${new Date(expires).toLocaleString()}`);
    console.log('');

    if (!executeRefresh) {
      console.log('⚠️  Dry-run mode. Add --execute to actually refresh.');
      db.close();
      return;
    }

    // Perform refresh
    console.log('🔄 Refreshing token...');
    const refreshEndpoint = `${metadata.server}/v1/oauth/token`;
    
    const response = await fetch(refreshEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refresh,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('❌ Refresh failed:', response.status, error);
      db.close();
      process.exit(1);
    }

    const data = await response.json();
    console.log('✅ Refresh successful!');
    console.log('');

    // Parse response
    const newAccessToken = data.access_token;
    const newRefreshToken = data.refresh_token || refresh; // Some APIs don't rotate refresh token
    const expiresIn = data.expires_in; // Seconds
    const newExpiry = Date.now() + (expiresIn * 1000);

    console.log('📋 New Token:');
    console.log(`  Access: ${newAccessToken.substring(0, 20)}...`);
    console.log(`  Refresh: ${newRefreshToken === refresh ? '(same)' : newRefreshToken.substring(0, 20) + '...'}`);
    console.log(`  Expires in: ${Math.round(expiresIn / 3600)} hours`);
    console.log(`  Expires at: ${new Date(newExpiry).toLocaleString()}`);
    console.log('');

    // Update database
    console.log('💾 Updating database...');
    const updatedValue = JSON.stringify({
      ...credValue,
      access: newAccessToken,
      refresh: newRefreshToken,
      expires: newExpiry,
    });

    db.prepare(`
      UPDATE credential
      SET value = ?, time_updated = ?
      WHERE id = ?
    `).run(updatedValue, Date.now(), cred.id);

    console.log('✅ Database updated!');
    console.log('');
    console.log('🎉 Token refresh complete!');

    db.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

refreshToken();
