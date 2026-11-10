#!/usr/bin/env node
/**
 * Test quota hypothesis:
 * Is quota per account or per IP block?
 */

console.log('\n╔════════════════════════════════════════════════════════════╗');
console.log('║                                                            ║');
console.log('║  🧪 Quota Tracking Test                                   ║');
console.log('║                                                            ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📊 Current situation:\n');
console.log('  ✅ 2 different accounts (different emails)');
console.log('  ✅ 2 different tokens (verified)');
console.log('  ✅ 2 separate databases');
console.log('  ❌ Both show "exhausted"\n');

console.log('💡 Possible explanations:\n');

console.log('1️⃣  Quota is per IP block (like OpenCode-Unlimited says):');
console.log('   - Same computer = same IP = same quota pool');
console.log('   - Different accounts don\'t matter');
console.log('   - Need to change IP to get more quota\n');

console.log('2️⃣  Account 2 was already used before:');
console.log('   - Created on 4/11/2026 (6 days ago)');
console.log('   - May have been used and exhausted already');
console.log('   - Wait until 00:00 UTC to reset\n');

console.log('3️⃣  Gateway is not actually rotating:');
console.log('   - Both requests going to same server');
console.log('   - Rotation logic has a bug\n');

console.log('═══════════════════════════════════════════════════════════\n');

console.log('🔬 TO TEST:\n');

console.log('Option A: Wait until 00:00 UTC (tomorrow 7:00 AM VN time)');
console.log('  - If quota resets for BOTH accounts at same time');
console.log('  - Then quota is per IP block ❌\n');

console.log('Option B: Change your IP now (VPN/hotspot)');
console.log('  - If quota becomes available immediately');
console.log('  - Then quota is per IP block ❌\n');

console.log('Option C: Add a 3rd account with BRAND NEW email');
console.log('  - Never used before');
console.log('  - If still shows exhausted');
console.log('  - Then quota is per IP block ❌\n');

console.log('═══════════════════════════════════════════════════════════\n');

console.log('⏰ Current time:', new Date().toLocaleString());
console.log('⏰ Next quota reset: 00:00 UTC (7:00 AM VN)\n');
