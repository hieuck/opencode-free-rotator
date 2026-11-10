/**
 * Start `opencode serve` WITHOUT OPENCODE_SERVER_PASSWORD and report whether
 * the API allows anonymous access, prints a generated password, or refuses.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const port = 3012;
const logPath = process.env.TEMP + '\\oc-nopw-out.log';
const errPath = process.env.TEMP + '\\oc-nopw-err.log';

const env = { ...process.env };
delete env.OPENCODE_SERVER_PASSWORD;
delete env.OPENCODE_SERVER_USERNAME;

const out = fs.openSync(logPath, 'w');
const err = fs.openSync(errPath, 'w');

const child = spawn('C:\\Users\\hieut\\AppData\\Roaming\\npm\\opencode.cmd', ['serve', '--port', String(port), '--hostname', '127.0.0.1'], {
  env,
  stdio: ['ignore', out, err],
  shell: true,
  windowsHide: true,
  detached: false,
});

await new Promise((r) => setTimeout(r, 9000));

console.log('--- stdout ---');
console.log(fs.readFileSync(logPath, 'utf8').slice(0, 2000));
console.log('--- stderr ---');
console.log(fs.readFileSync(errPath, 'utf8').slice(0, 2000));

try {
  const res = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(5000) });
  console.log(`\nGET /api/info (no auth) -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
} catch (e) {
  console.log(`\nGET /api/info (no auth) -> ERR ${e.message}`);
}

child.kill();
process.exit(0);
