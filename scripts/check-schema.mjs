#!/usr/bin/env node
import Database from 'better-sqlite3';

const dbPath = process.argv[2] || 'C:/Users/hieut/.local/share/opencode/opencode.db';
const db = new Database(dbPath, { readonly: true });

console.log(`\n📋 Schema of credential table in ${dbPath}:\n`);

const schema = db.prepare('PRAGMA table_info(credential)').all();
schema.forEach(col => {
  console.log(`   ${col.name.padEnd(20)} ${col.type}`);
});

console.log('\n📋 Sample credential:\n');
const sample = db.prepare('SELECT * FROM credential WHERE integration_id = "opencode" LIMIT 1').get();
if (sample) {
  Object.keys(sample).forEach(key => {
    console.log(`   ${key}: ${typeof sample[key]}`);
  });
}

db.close();
