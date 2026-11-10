import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import os from 'os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(os.homedir(), '.local/share/opencode/opencode.db');

console.log('🧪 Testing Hosted OpenCode API\n');

// Extract token
const db = new Database(dbPath, { readonly: true });
const row = db.prepare(`
  SELECT id, label, value 
  FROM credential 
  WHERE label = 'hieuck.dev@gmail.com'
  LIMIT 1
`).get();

if (!row) {
  console.error('❌ No OpenCode credential found');
  process.exit(1);
}

const cred = JSON.parse(row.value);
const accessToken = cred.access;

console.log(`📧 Account: ${row.label}`);
console.log(`🔑 Token: ${accessToken.substring(0, 10)}...${accessToken.slice(-8)}`);
console.log(`⏰ Expires: ${new Date(cred.expires).toISOString()}\n`);

// Test hosted API
console.log('🌐 Testing https://api.opencode.ai/v1/chat/completions\n');

try {
  const response = await fetch('https://api.opencode.ai/v1/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'opencode/deepseek-v4.1-flash-free',
      messages: [
        { role: 'user', content: 'Say "Hello from hosted API!" in one sentence.' }
      ],
      max_tokens: 50,
    }),
  });

  console.log(`📊 Status: ${response.status} ${response.statusText}`);
  console.log(`📋 Headers:`, Object.fromEntries([...response.headers.entries()].slice(0, 5)));

  if (response.ok) {
    const data = await response.json();
    console.log('\n✅ SUCCESS! Hosted API works!\n');
    console.log('📨 Response:', JSON.stringify(data, null, 2));
    
    if (data.choices && data.choices[0]) {
      console.log('\n💬 Message:', data.choices[0].message.content);
    }
  } else {
    const errorText = await response.text();
    console.log('\n❌ API Error:', errorText);
  }

  db.close();
} catch (error) {
  console.error('\n❌ Request failed:', error.message);
  db.close();
  process.exit(1);
}
