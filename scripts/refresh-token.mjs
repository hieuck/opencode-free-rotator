/**
 * Manually refresh the OpenCode OAuth token in an OpenCode SQLite database.
 *
 * The gateway refreshes tokens on its own when they are close to expiry, so this
 * script is a repair tool: it forces one refresh now, prints the result and
 * (unless --dry-run) writes the rotated pair back into the database.
 *
 *   node scripts/refresh-token.mjs             # refresh and write back
 *   node scripts/refresh-token.mjs --dry-run   # show what would happen
 *   node scripts/refresh-token.mjs --db <path> # use a different database
 *
 * Endpoint (found in the opencode binary, not documented):
 *   POST https://opencode.ai/console/auth/device/token
 *   { grant_type: "refresh_token", refresh_token, client_id: "opencode-cli" }
 */
import path from 'path';
import { TokenManager, TokenError, expandHome, maskToken, consoleBase } from '../src/TokenManager.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dbFlag = args.indexOf('--db');
const dbPath = expandHome(
  dbFlag >= 0 && args[dbFlag + 1]
    ? args[dbFlag + 1]
    : path.join(process.env.XDG_DATA_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '', '.local', 'share'), 'opencode', 'opencode.db'),
);

const account = { name: 'manual', db: dbPath };

async function main() {
  console.log('🔄 OpenCode OAuth token refresh\n');
  console.log(`📁 Database: ${dbPath}`);
  console.log(`🚦 Mode: ${dryRun ? 'dry-run (no write-back)' : 'refresh + write-back'}\n`);

  const manager = new TokenManager([account], { writeBack: !dryRun, cacheTtlMs: 0 });

  try {
    const credential = await manager.readCredential(account);

    console.log('📋 Current credential');
    console.log(`   Email:   ${credential.email ?? 'unknown'}`);
    console.log(`   Org:     ${credential.orgId ?? 'unknown'}`);
    console.log(`   Type:    ${credential.type}`);
    console.log(`   Access:  ${maskToken(credential.token)}`);
    console.log(`   Refresh: ${credential.refresh ? maskToken(credential.refresh) : '(none)'}`);
    console.log(
      `   Expires: ${credential.expiresAt ? new Date(credential.expiresAt).toISOString() : 'never'} ` +
        (credential.expiresAt ? `(${Math.round((credential.expiresAt - Date.now()) / 1000)}s)` : ''),
    );
    console.log(`   Auth:    ${consoleBase(credential.metadata)}/auth/device/token\n`);

    if (credential.type !== 'oauth') {
      console.log('ℹ️  This credential is a static key — nothing to refresh.');
      return;
    }
    if (!credential.refresh) {
      console.log('❌ No refresh token stored. Run `opencode auth login` again.');
      process.exitCode = 1;
      return;
    }

    if (dryRun) {
      console.log('⚠️  Dry-run: skipping the network call. Re-run without --dry-run to refresh.');
      return;
    }

    console.log('🔄 Refreshing...');
    const updated = await manager.refresh(account, credential);

    console.log('\n✅ Refresh succeeded');
    console.log(`   Access:  ${maskToken(updated.access)}`);
    console.log(`   Refresh: ${maskToken(updated.refresh)}${updated.refresh === credential.refresh ? ' (unchanged)' : ' (rotated)'}`);
    console.log(`   Expires: ${new Date(updated.expires).toISOString()}`);
    console.log(`\n✅ New token written back to ${dbPath}`);
  } catch (error) {
    if (error instanceof TokenError) {
      console.error(`\n❌ ${error.message}`);
      console.error(`   code: ${error.code}`);
      if (error.code === 'reauth_required') {
        console.error('   → The refresh token is no longer valid. Run `opencode auth login` for this account.');
      }
    } else {
      console.error(`\n❌ ${error.message}`);
    }
    process.exitCode = 1;
  } finally {
    manager.close();
  }
}

main();
