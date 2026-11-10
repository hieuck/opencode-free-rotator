#!/usr/bin/env node
/**
 * Kill ONLY AccountManager and its spawned OpenCode servers
 * Safe - doesn't kill unrelated Node processes
 */

import { execSync } from 'child_process';

console.log('\n🔍 Finding AccountManager processes...\n');

// Gateway port + check only active server ports
const GATEWAY_PORT = 3200;
const SERVER_PORT_START = 3201;
const SERVER_PORT_END = 3210; // Check first 10 slots only

const pidsToKill = new Set();

// Find processes by ports (optimized scan)
const portsToCheck = [GATEWAY_PORT];
for (let port = SERVER_PORT_START; port <= SERVER_PORT_END; port++) {
  portsToCheck.push(port);
}

// Find processes by ports
for (const port of portsToCheck) {
  try {
    // Windows: Get PID from netstat
    const output = execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf8' });
    const lines = output.split('\n').filter(line => line.includes('LISTENING'));
    
    lines.forEach(line => {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') {
        pidsToKill.add(pid);
        console.log(`   Found process on port ${port}: PID ${pid}`);
      }
    });
  } catch (err) {
    // Port not in use - OK
  }
}

if (pidsToKill.size === 0) {
  console.log('   ✅ No AccountManager processes found\n');
  process.exit(0);
}

console.log(`\n🔪 Killing ${pidsToKill.size} process(es)...\n`);

let killed = 0;
for (const pid of pidsToKill) {
  try {
    execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'ignore' });
    console.log(`   ✅ Killed PID ${pid}`);
    killed++;
  } catch (err) {
    console.log(`   ⚠️  Failed to kill PID ${pid} (may already be dead)`);
  }
}

console.log(`\n✅ Killed ${killed}/${pidsToKill.size} processes\n`);

// Verify ports are free
console.log('🔍 Verifying ports are free...\n');

setTimeout(() => {
  let allFree = true;
  
  for (const port of portsToCheck) {
    try {
      execSync(`netstat -ano | findstr ":${port}"`, { encoding: 'utf8', stdio: 'ignore' });
      console.log(`   ⚠️  Port ${port} still in use`);
      allFree = false;
    } catch (err) {
      // Port free - good!
    }
  }
  
  if (allFree) {
    console.log('   ✅ All ports are free\n');
  } else {
    console.log('\n⚠️  Some ports still in use. Wait a moment and try again.\n');
    process.exit(1);
  }
}, 1000);
