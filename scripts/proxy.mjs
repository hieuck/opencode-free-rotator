#!/usr/bin/env node
/**
 * Proxy Pool CLI
 * Manage proxy pool for OpenCode rotator
 */

import ProxyPoolManager from '../src/ProxyPoolManager.mjs';

const manager = new ProxyPoolManager();
const args = process.argv.slice(2);
const command = args[0];

function printUsage() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║  🔧 Proxy Pool Manager                                    ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝

Usage:
  node scripts/proxy.mjs <command> [args]

Commands:
  add <url>          Add proxy (socks5://host:port or http://user:pass@host:port)
  list               List all proxies with health status
  next               Show next proxy in rotation
  remove <index>     Remove proxy by index
  clear              Remove all proxies
  test <index>       Test specific proxy (coming soon)
  stats              Show proxy pool statistics

Examples:
  node scripts/proxy.mjs add socks5://127.0.0.1:1080
  node scripts/proxy.mjs add http://user:pass@proxy.example.com:3128
  node scripts/proxy.mjs list
  node scripts/proxy.mjs remove 0
`);
}

async function main() {
  if (!command) {
    printUsage();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'add': {
        const url = args[1];
        if (!url) {
          console.error('❌ Proxy URL required');
          console.log('\nExample: node scripts/proxy.mjs add socks5://127.0.0.1:1080');
          process.exit(1);
        }

        const proxy = manager.add(url);
        console.log('\n✅ Proxy added successfully!\n');
        console.log(`   Protocol: ${proxy.protocol}`);
        console.log(`   Host: ${proxy.host}`);
        console.log(`   Port: ${proxy.port}`);
        if (proxy.username) {
          console.log(`   Username: ${proxy.username}`);
        }
        console.log();
        break;
      }

      case 'list': {
        const proxies = manager.list();
        
        if (proxies.length === 0) {
          console.log('\n⚪ No proxies in pool\n');
          console.log('Add one with: node scripts/proxy.mjs add <url>\n');
          break;
        }

        console.log('\n📊 Proxy Pool:\n');
        
        proxies.forEach(p => {
          const isCurrent = p.current ? '→ ' : '  ';
          const status = p.health.quarantineUntil 
            ? '🔴 Quarantined'
            : p.health.failures > 0
            ? '🟡 Degraded'
            : p.health.lastChecked
            ? '🟢 Healthy'
            : '⚪ Untested';
          
          console.log(`${isCurrent}[${p.index}] ${status}`);
          console.log(`   ${p.url}`);
          
          if (p.health.lastChecked) {
            console.log(`   Latency: ${p.health.latency || 'N/A'}ms`);
            console.log(`   Failures: ${p.health.failures}`);
          }
          
          if (p.health.quarantineUntil) {
            const until = new Date(p.health.quarantineUntil);
            console.log(`   Quarantine until: ${until.toLocaleString()}`);
          }
          
          console.log();
        });

        console.log(`Total: ${proxies.length} proxy(ies)\n`);
        break;
      }

      case 'next': {
        const proxy = manager.next();
        
        if (!proxy) {
          console.log('\n⚪ No proxies available\n');
          break;
        }

        console.log('\n📍 Next proxy:\n');
        console.log(`   ${proxy.protocol}://${proxy.host}:${proxy.port}`);
        console.log();
        break;
      }

      case 'remove': {
        const index = parseInt(args[1]);
        
        if (isNaN(index)) {
          console.error('❌ Invalid index');
          process.exit(1);
        }

        manager.remove(index);
        console.log(`\n✅ Proxy ${index} removed\n`);
        break;
      }

      case 'clear': {
        manager.clear();
        console.log('\n✅ All proxies removed\n');
        break;
      }

      case 'stats': {
        const proxies = manager.list();
        const healthy = proxies.filter(p => p.health.failures === 0 && p.health.lastChecked);
        const degraded = proxies.filter(p => p.health.failures > 0 && !p.health.quarantineUntil);
        const quarantined = proxies.filter(p => p.health.quarantineUntil);
        const untested = proxies.filter(p => !p.health.lastChecked);

        console.log('\n📊 Proxy Pool Statistics:\n');
        console.log(`   Total: ${proxies.length}`);
        console.log(`   🟢 Healthy: ${healthy.length}`);
        console.log(`   🟡 Degraded: ${degraded.length}`);
        console.log(`   🔴 Quarantined: ${quarantined.length}`);
        console.log(`   ⚪ Untested: ${untested.length}`);
        console.log();
        break;
      }

      default:
        console.error(`❌ Unknown command: ${command}`);
        printUsage();
        process.exit(1);
    }
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}\n`);
    process.exit(1);
  }
}

main();
