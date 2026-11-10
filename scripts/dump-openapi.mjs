/**
 * Dump the OpenAPI spec of a running OpenCode server.
 * Usage: node scripts/dump-openapi.mjs [baseUrl] [user] [pass] [outFile]
 */
import fs from 'fs';

const base = process.argv[2] || 'http://127.0.0.1:3011';
const user = process.argv[3] || process.env.OPENCODE_SERVER_USERNAME || '';
const pass = process.argv[4] || process.env.OPENCODE_SERVER_PASSWORD || '';
const out = process.argv[5] || 'docs/opencode-openapi.json';

const headers = {};
if (user && pass) headers.Authorization = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

const spec = await fetch(`${base}/openapi.json`, { headers, signal: AbortSignal.timeout(20000) })
  .then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status} from /openapi.json`);
    return r.json();
  });

fs.mkdirSync('docs', { recursive: true });
fs.writeFileSync(out, JSON.stringify(spec, null, 2));
console.log(`Wrote ${out} (${Object.keys(spec.paths).length} paths)`);

for (const [p, methods] of Object.entries(spec.paths)) {
  const list = Object.entries(methods)
    .map(([m, op]) => `${m.toUpperCase()} ${op.operationId || ''}`.trim())
    .join(', ');
  console.log(`  ${p}  ->  ${list}`);
}
