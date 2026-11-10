import fs from 'fs';

const spec = JSON.parse(fs.readFileSync('docs/opencode-openapi.json', 'utf8'));
const want = process.argv.slice(2);

function resolve(schema, depth = 0) {
  if (!schema || depth > 6) return schema;
  if (schema.$ref) {
    const name = schema.$ref.replace('#/components/schemas/', '');
    return { $ref: name, ...spec.components?.schemas?.[name] };
  }
  return schema;
}

for (const w of want) {
  const [method, ...rest] = w.split(' ');
  const p = rest.join(' ');
  const op = spec.paths[p]?.[method.toLowerCase()];
  console.log(`\n===== ${w.toUpperCase()} ${p} =====`);
  if (!op) {
    console.log('  (not found)');
    continue;
  }
  console.log(JSON.stringify(op, null, 2).slice(0, 4000));
}
