#!/usr/bin/env node
/**
 * Start AccountManager in background (detached mode)
 */

import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');

console.log('\n🚀 Starting AccountManager...\n');

// Kill any existing processes first
try {
  execSync('node scripts/kill-gateway.mjs', { 
    cwd: ROOT_DIR, 
    stdio: 'inherit' 
  });
  console.log('⏳ Waiting for cleanup...\n');
  await new Promise(resolve => setTimeout(resolve, 2000));
} catch (err) {
  // OK if nothing to kill
}

// Check if already running
const PORTS = [3200];
for (const port of PORTS) {
  try {
    const output = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf8' });
    if (output.includes('LISTENING')) {
      console.log(`❌ AccountManager already running on port ${port}!\n`);
      console.log('💡 To restart: node scripts/restart-gateway.mjs');
      console.log('💡 To stop: node scripts/kill-gateway.mjs\n');
      process.exit(1);
    }
  } catch (err) {
    // Port free - OK
  }
}

// Start process and show output
console.log('═══════════════════════════════════════════════════════════\n');

const child = spawn('node', ['src/AccountManager.mjs'], {
  cwd: ROOT_DIR,
  stdio: 'inherit',
  detached: false
});

// Don't exit when child exits - let it run
process.on('SIGINT', () => {
  console.log('\n\n🛑 Stopping AccountManager...');
  child.kill();
  process.exit(0);
});

console.log('\n💡 Press Ctrl+C to stop\n');

// Keep running until Ctrl+C
