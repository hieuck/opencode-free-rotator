#!/usr/bin/env node
/**
 * Safe restart - Kill old processes then start fresh
 */

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║                                                            ║');
console.log('║  🔄 Restart AccountManager                                ║');
console.log('║                                                            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

// Step 1: Kill old processes
console.log('📋 Step 1: Stopping old processes...\n');

try {
  execSync('node scripts/kill-gateway.mjs', { 
    cwd: ROOT_DIR, 
    stdio: 'inherit' 
  });
} catch (err) {
  console.log('\n⚠️  Kill script failed, but continuing...\n');
}

// Step 2: Wait a moment
console.log('⏳ Step 2: Waiting for cleanup...\n');
await new Promise(resolve => setTimeout(resolve, 2000));

// Step 3: Verify databases
console.log('📋 Step 3: Verifying accounts...\n');

try {
  execSync('node scripts/list-accounts.mjs', { 
    cwd: ROOT_DIR, 
    stdio: 'inherit' 
  });
} catch (err) {
  console.error('\n❌ Failed to list accounts!\n');
  process.exit(1);
}

console.log('\n📋 Step 4: Starting AccountManager...\n');

// Step 4: Start AccountManager
const child = spawn('node', ['src/AccountManager.mjs'], {
  cwd: ROOT_DIR,
  stdio: 'inherit',
  detached: true
});

child.unref(); // Let it run independently

console.log('⏳ Waiting for startup...\n');
await new Promise(resolve => setTimeout(resolve, 5000));

// Step 5: Verify it's running
console.log('📋 Step 5: Verifying gateway is running...\n');

const PORTS = [3200, 3201, 3202, 3203];
let runningPorts = 0;

for (const port of PORTS) {
  try {
    const output = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf8' });
    if (output.includes('LISTENING')) {
      console.log(`   ✅ Port ${port} is listening`);
      runningPorts++;
    }
  } catch (err) {
    // Port not in use
  }
}

console.log();

if (runningPorts > 0) {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║                                                            ║');
  console.log('║  ✅ AccountManager is Running!                            ║');
  console.log('║                                                            ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log();
  console.log('📡 Gateway API: http://localhost:3200/v1/chat/completions');
  console.log('🎛️  Web UI: http://localhost:3200/');
  console.log();
  console.log('💡 To stop: node scripts/kill-gateway.mjs');
  console.log();
} else {
  console.log('❌ AccountManager failed to start!');
  console.log();
  console.log('💡 Check logs manually:');
  console.log('   node src/AccountManager.mjs');
  console.log();
  process.exit(1);
}
