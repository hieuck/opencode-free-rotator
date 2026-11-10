#!/usr/bin/env node
/**
 * Quick test - Send 1 request to verify rotation works
 */

console.log('\n🧪 Testing Account Rotation...\n');

try {
  const response = await fetch('http://localhost:3200/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4',
      messages: [{ role: 'user', content: 'Say "Test successful!"' }],
      max_tokens: 50
    })
  });

  if (response.ok) {
    const data = await response.json();
    console.log('✅ Response received:');
    console.log('   Status:', response.status);
    console.log('   Account used:', response.headers.get('x-account-slot') || 'Unknown');
    console.log('   Content:', data.choices?.[0]?.message?.content || 'N/A');
    console.log();
    console.log('🎉 Rotation is working!');
  } else {
    console.error('❌ Request failed:', response.status, response.statusText);
    const text = await response.text();
    console.error('   Error:', text);
  }
} catch (err) {
  console.error('❌ Connection failed:', err.message);
  console.log('\n💡 Tip: Start AccountManager first with: node src/AccountManager.mjs');
}

console.log();
