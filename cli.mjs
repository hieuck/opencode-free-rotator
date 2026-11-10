#!/usr/bin/env node
import { AccountManager } from './src/AccountManager.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.CONFIG_PATH || path.join(__dirname, 'config.yaml');

const command = process.argv[2];

async function main() {
  switch (command) {
    case 'status':
    case 'check': {
      const manager = new AccountManager(configPath);
      const status = await manager.init();
      printStatus(status);
      await manager.stop();
      process.exit(status.available > 0 ? 0 : 2);
      break;
    }

    case 'accounts': {
      const manager = new AccountManager(configPath);
      const status = await manager.init();
      console.log('\n📋 Accounts\n');
      for (const account of status.accounts) {
        const flag = account.available ? '✅' : account.ready ? '⏸️ ' : '❌';
        console.log(`${flag} ${account.name}${account.enabled ? '' : ' (disabled)'}`);
        console.log(`   Email:  ${account.email ?? 'unknown'}`);
        console.log(`   Org:    ${account.orgId ?? 'unknown'}`);
        console.log(`   Token:  ${account.token?.tokenPreview ?? 'n/a'} (expires ${formatWhen(account.token?.expiresAt)})`);
        console.log(`   Quota:  ${account.stats.usage ? formatUsage(account.stats.usage) : 'not reported'}`);
        if (account.error) console.log(`   Error:  ${account.error}`);
        console.log('');
      }
      await manager.stop();
      process.exit(0);
      break;
    }

    case 'models': {
      const manager = new AccountManager(configPath);
      await manager.init();
      const account = manager.selectAccount();
      if (!account) {
        console.error('❌ No account can list models right now');
        await manager.stop();
        process.exit(2);
      }
      try {
        const auth = await manager.getAuth(account);
        const response = await fetch(`${manager.upstream.baseUrl}${manager.upstream.modelsPath}`, {
          headers: manager.authHeaders(auth),
          signal: AbortSignal.timeout(20000),
        });
        const payload = await response.json();
        if (!response.ok) {
          console.error(`❌ Models request failed (HTTP ${response.status}):`, JSON.stringify(payload));
          process.exitCode = 1;
        } else {
          console.log(`\n🧠 ${payload.data?.length ?? 0} models via ${account.name}\n`);
          for (const model of payload.data ?? []) {
            const free =
              model.cost?.text?.input?.price === 0 && model.cost?.text?.output?.price === 0 ? 'FREE' : '    ';
            console.log(`  ${free} ${String(model.id).padEnd(34)} ${model.name ?? ''}`);
          }
          console.log('');
        }
      } finally {
        manager.releaseAccount(account);
        await manager.stop();
      }
      process.exit(process.exitCode ?? 0);
      break;
    }

    case 'test-select': {
      const manager = new AccountManager(configPath);
      await manager.init();
      console.log('\n🧪 Testing account selection...\n');
      const selected = manager.selectAccount();
      if (selected) {
        console.log(`✅ Selected: ${selected.name}`);
        console.log(`   Used:  ${selected.stats.requestsToday + selected.stats.inFlight}/${manager.quotaFor(selected)}`);
        manager.releaseAccount(selected);
      } else {
        console.log('❌ No account available (missing token, cooling down, or out of quota)');
      }
      await manager.stop();
      process.exit(selected ? 0 : 2);
      break;
    }

    case 'reset-quota': {
      const manager = new AccountManager(configPath);
      manager.resetDailyQuota({ reason: 'manual' });
      manager.persistState();
      await manager.stop();
      process.exit(0);
      break;
    }

    default:
      console.log(`
OpenCode Free Rotator — hosted API pooling

Usage:
  node cli.mjs <command>

Commands:
  status        Validate credentials and show real provider quota (starts nothing)
  accounts      Detailed per-account view
  models        List the hosted model catalogue through one account
  test-select   Show which account the gateway would pick next
  reset-quota   Reset local daily counters

Start the proxy itself with:  node server.mjs
`);
      process.exit(command ? 1 : 0);
  }
}

function printStatus(status) {
  console.log('\n📊 Pool status\n');
  console.log(`Upstream: ${status.upstream.baseUrl}${status.upstream.chatPath}`);
  console.log(`Accounts: ${status.totalAccounts} total · ${status.ready} ready · ${status.available} available\n`);

  for (const account of status.accounts) {
    const flag = account.available ? '✅' : account.ready ? '⏸️ ' : '❌';
    const cooldown = account.stats.cooldownUntil > Date.now() ? ` · cooling ${formatWhen(account.stats.cooldownUntil)}` : '';
    console.log(`${flag} ${account.name} — ${account.email ?? 'unknown email'}`);
    console.log(`   Requests: ${account.used}/${account.quotaPerDay} today${cooldown}`);
    if (account.stats.usage) console.log(`   Provider: ${formatUsage(account.stats.usage)}`);
    if (account.stats.limited) console.log('   Limited:  yes (provider reported a rate limit)');
    if (account.stats.lastQuotaError) console.log(`   Usage:    ${account.stats.lastQuotaError}`);
    if (account.error) console.log(`   Error:    ${account.error}`);
    console.log('');
  }

  if (status.available === 0) {
    console.log('⚠️  No account can serve a request right now. See the reasons above.\n');
  }
}

function formatUsage(usage) {
  const part = (label, bucket) =>
    bucket ? `${label} ${bucket.percent ?? '?'}%${bucket.limited ? ' (rate-limited)' : ''}` : `${label} n/a`;
  return [part('rolling', usage.rolling), part('weekly', usage.weekly), part('monthly', usage.monthly)].join(' · ');
}

function formatWhen(timestamp) {
  if (!timestamp) return 'unknown';
  const date = new Date(timestamp);
  const delta = timestamp - Date.now();
  const rel =
    delta <= 0
      ? 'past'
      : delta > 86400000
        ? `in ${Math.round(delta / 86400000)}d`
        : delta > 3600000
          ? `in ${Math.round(delta / 3600000)}h`
          : `in ${Math.max(1, Math.round(delta / 60000))}m`;
  return `${date.toISOString()} (${rel})`;
}

main().catch((error) => {
  console.error('❌ Error:', error.message);
  if (process.env.DEBUG) console.error(error.stack);
  process.exit(1);
});
