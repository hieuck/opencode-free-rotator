import Database from 'better-sqlite3';
import os from 'os';
import path from 'path';

const dbPath = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');

console.log('🧪 Test OpenCode API with Extracted Token\n');

async function testDirectAPI() {
  try {
    const db = new Database(dbPath, { readonly: true });

    // Get OpenCode credential
    const cred = db.prepare(`
      SELECT value FROM credential
      WHERE integration_id = 'opencode'
    `).get();

    if (!cred) {
      console.log('❌ No OpenCode credential found');
      process.exit(1);
    }

    const credValue = JSON.parse(cred.value);
    const { access, metadata } = credValue;

    console.log(`📧 Account: ${metadata.email}`);
    console.log(`🔑 Token: ${access.substring(0, 20)}...`);
    console.log('');

    // Test API call to OpenCode
    console.log('🔄 Testing chat completion...');
    
    const response = await fetch('https://opencode.ai/console/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'beam-free', // Free model
        messages: [
          { role: 'user', content: 'Say "hello" in one word' }
        ],
        stream: false,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`❌ API Error: ${response.status}`);
      console.error(error);
      db.close();
      process.exit(1);
    }

    const data = await response.json();
    console.log('✅ API Response:');
    console.log(JSON.stringify(data, null, 2));
    console.log('');
    console.log('🎉 Direct API access works!');
    console.log('');
    console.log('💡 This means we CAN pool tokens by:');
    console.log('  1. Reading tokens from multiple SQLite DBs');
    console.log('  2. Forwarding requests with those tokens');
    console.log('  3. Letting OpenCode CLI refresh tokens in background');

    db.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

testDirectAPI();
