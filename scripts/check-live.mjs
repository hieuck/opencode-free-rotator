/**
 * Live-check the endpoints that matter for the rotator.
 * Usage: node scripts/check-live.mjs [baseUrl] [user] [pass]
 */
const base = process.argv[2] || 'http://127.0.0.1:3011';
const user = process.argv[3] || process.env.OPENCODE_SERVER_USERNAME || '';
const pass = process.argv[4] || process.env.OPENCODE_SERVER_PASSWORD || '';
const headers = {};
if (user && pass) headers.Authorization = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

async function call(method, p, body) {
  try {
    const res = await fetch(base + p, {
      method,
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    return { status: res.status, text };
  } catch (e) {
    return { status: 'ERR', text: e.message };
  }
}

for (const p of ['/api/info', '/api/experimental/usage/limits', '/api/model/default']) {
  const r = await call('GET', p);
  console.log(`\n=== GET ${p} -> ${r.status} ===`);
  console.log(r.text.slice(0, 1500));
}

const models = await call('GET', '/api/model');
console.log(`\n=== GET /api/model -> ${models.status} ===`);
try {
  const j = JSON.parse(models.text);
  const list = (j.data || []).map((m) => `${m.providerID}/${m.id}`).slice(0, 40);
  console.log(`count=${(j.data || []).length}`);
  console.log(list.join('\n'));
} catch {
  console.log(models.text.slice(0, 800));
}

const gen = await call('POST', '/api/experimental/generate/text', { prompt: 'Reply with exactly: PONG' });
console.log(`\n=== POST /api/experimental/generate/text -> ${gen.status} ===`);
console.log(gen.text.slice(0, 1500));
