/**
 * Probe a running OpenCode server for its actual API surface.
 * Usage: node scripts/probe-api.mjs [baseUrl] [username] [password]
 */
const base = process.argv[2] || 'http://127.0.0.1:3011';
const user = process.argv[3] || process.env.OPENCODE_SERVER_USERNAME || '';
const pass = process.argv[4] || process.env.OPENCODE_SERVER_PASSWORD || '';

const basic = user && pass ? 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64') : null;

const paths = [
  '/',
  '/health',
  '/global/health',
  '/api/health',
  '/api',
  '/api/',
  '/v1/chat/completions',
  '/api/v1/chat/completions',
  '/api/chat/completions',
  '/api/completion',
  '/api/session',
  '/api/sessions',
  '/api/config',
  '/api/provider',
  '/api/model',
  '/api/models',
  '/api/event',
  '/api/doc',
  '/doc',
  '/openapi.json',
  '/api/openapi.json',
  '/global/openapi.json',
];

function summarize(text, limit = 300) {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > limit ? t.slice(0, limit) + '…' : t;
}

async function probe(method, p, headers = {}) {
  const url = base + p;
  try {
    const ctrl = AbortSignal.timeout(5000);
    const res = await fetch(url, { method, headers, signal: ctrl, redirect: 'manual' });
    const ct = res.headers.get('content-type') || '';
    let body = '';
    if (ct.includes('json') || (res.headers.get('content-length') || '0') !== '0') {
      body = await res.text();
    }
    return { status: res.status, ct, body: summarize(body) };
  } catch (e) {
    return { status: 'ERR', ct: '', body: e.message };
  }
}

const rows = [];
for (const p of paths) {
  const anon = await probe('GET', p);
  const auth = basic ? await probe('GET', p, { Authorization: basic }) : null;
  rows.push({ p, anon, auth });
}

for (const r of rows) {
  console.log(`GET ${r.p}`);
  console.log(`   anon: ${r.anon.status} [${r.anon.ct}] ${r.anon.body}`);
  if (r.auth) console.log(`   auth: ${r.auth.status} [${r.auth.ct}] ${r.auth.body}`);
}

console.log('\n--- POST /api/... chat probes (auth) ---');
for (const p of ['/v1/chat/completions', '/api/chat/completions', '/api/v1/chat/completions']) {
  const r = await probe(
    'POST',
    p,
    {
      'Content-Type': 'application/json',
      ...(basic ? { Authorization: basic } : {}),
    },
  );
  const post = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(basic ? { Authorization: basic } : {}) },
    body: JSON.stringify({ model: 'test', messages: [{ role: 'user', content: 'hi' }] }),
    signal: AbortSignal.timeout(10000),
  }).then(async (res) => ({ status: res.status, ct: res.headers.get('content-type') || '', body: summarize(await res.text()) })).catch((e) => ({ status: 'ERR', ct: '', body: e.message }));
  console.log(`POST ${p} -> ${post.status} [${post.ct}] ${post.body}`);
}
