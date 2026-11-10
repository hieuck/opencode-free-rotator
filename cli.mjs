#!/usr/bin/env node
import { InstanceManager } from './src/InstanceManager.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, 'config.yaml');

const command = process.argv[2];

const manager = new InstanceManager(configPath);

async function main() {
  switch (command) {
    case 'start':
      console.log('🚀 Starting all OpenCode instances...\n');
      await manager.startAll();
      
      // Keep process running
      console.log('\n✅ All instances running. Press Ctrl+C to stop.\n');
      
      // Setup daily quota reset
      setupDailyReset(manager);
      
      // Keep alive
      await new Promise(() => {}); // Never resolves
      break;

    case 'stop':
      await manager.stopAll();
      process.exit(0);
      break;

    case 'status':
      const status = manager.getStatus();
      console.log('\n📊 Instance Status:\n');
      console.log(`Total Instances: ${status.totalInstances}`);
      console.log(`Running: ${status.running}\n`);
      
      status.instances.forEach(inst => {
        const icon = inst.running ? '✅' : '⏹️';
        const enabledText = inst.enabled ? '' : ' (disabled)';
        console.log(`${icon} ${inst.name}${enabledText}`);
        console.log(`   Email: ${inst.email}`);
        console.log(`   Port: ${inst.port}`);
        
        if (inst.stats) {
          const quota = manager.config.instances.find(i => i.port === inst.port).quotaPerDay;
          console.log(`   Quota: ${inst.stats.requestsToday}/${quota} today`);
          console.log(`   Started: ${new Date(inst.stats.startedAt).toLocaleString()}`);
        }
        console.log('');
      });
      
      process.exit(0);
      break;

    case 'test-select':
      console.log('\n🧪 Testing instance selection...\n');
      const selected = manager.selectInstance();
      
      if (selected) {
        console.log(`✅ Selected: ${selected.config.name}`);
        console.log(`   Port: ${selected.config.port}`);
        console.log(`   Usage: ${selected.stats.requestsToday}/${selected.config.quotaPerDay}`);
      } else {
        console.log('❌ No instances available (all quota exhausted)');
      }
      
      process.exit(0);
      break;

    case 'reset-quota':
      manager.resetDailyQuota();
      process.exit(0);
      break;

    default:
      console.log(`
OpenCode Free Rotator - Instance Manager

Usage:
  node cli.mjs <command>

Commands:
  start         Start all enabled instances
  stop          Stop all running instances
  status        Show instance status
  test-select   Test instance selection strategy
  reset-quota   Manually reset daily quota counters

Examples:
  node cli.mjs start
  node cli.mjs status
      `);
      process.exit(command ? 1 : 0);
  }
}

function setupDailyReset(manager) {
  const resetHour = manager.config.gateway.quotaResetHour;
  
  // Calculate next reset time
  const now = new Date();
  const nextReset = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    resetHour,
    0,
    0
  ));
  
  // If reset time today already passed, schedule for tomorrow
  if (nextReset <= now) {
    nextReset.setUTCDate(nextReset.getUTCDate() + 1);
  }
  
  const msUntilReset = nextReset - now;
  
  console.log(`⏰ Next quota reset: ${nextReset.toISOString()} (in ${Math.round(msUntilReset / 1000 / 3600)} hours)`);
  
  setTimeout(() => {
    manager.resetDailyQuota();
    
    // Schedule next reset (24h)
    setInterval(() => {
      manager.resetDailyQuota();
    }, 24 * 60 * 60 * 1000);
  }, msUntilReset);
}

// Handle Ctrl+C
process.on('SIGINT', async () => {
  console.log('\n\n⏹️  Received SIGINT, stopping instances...\n');
  await manager.stopAll();
  process.exit(0);
});

main().catch(error => {
  console.error('❌ Error:', error.message);
  console.error(error.stack);
  process.exit(1);
});
