/**
 * Test /api/experimental/generate/text with an explicit free model.
 */
const base = process.argv[2] || 'http://127.0.0.1:3011';
const model = process.argv[3] || 'big-pickle';
const user = process.env.OPENCODE_SERVER_USERNAME || '';
const pass = process.env.OPENCODE_SERVER_PASSWORD || '';
const headers = { 'Content-Type': 'application/json' };
if (user && pass) headers.Authorization = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');

const candidates = [
  { providerID: 'opencode', id: model },
  { providerID: 'opencode-go', id: model },
];

for (const m of candidates) {
  try {
    const res = await fetch(`${base}/api/experimental/generate/text`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ prompt: 'Reply with exactly: PONG', model: m }),
      signal: AbortSignal.timeout(60000),
    });
    const text = await res.text();
    console.log(`\n${m.providerID}/${m.id} -> ${res.status}`);
    console.log(text.slice(0, 1200));
  } catch (e) {
    console.log(`\n${m.providerID}/${m.id} -> ERR ${e.message}`);
  }
}
