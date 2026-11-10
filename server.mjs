#!/usr/bin/env node
import { Gateway } from './src/Gateway.mjs';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveConfigPath() {
  const fromEnv = process.env.CONFIG_PATH;
  if (fromEnv) {
    if (!fs.existsSync(fromEnv)) {
      throw new Error(`CONFIG_PATH points at a missing file: ${fromEnv}`);
    }
    return path.resolve(fromEnv);
  }

  const local = path.join(__dirname, 'config.yaml');
  if (fs.existsSync(local)) return local;

  const example = path.join(__dirname, 'config.example.yaml');
  if (fs.existsSync(example)) {
    console.warn(`⚠️  No config.yaml found. Using ${path.basename(example)} — copy it and add real accounts.`);
    return example;
  }

  throw new Error('No config.yaml or config.example.yaml found');
}

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║        OpenCode Free Rotator Gateway                      ║
║                                                           ║
║  Multi-instance pooling for OpenCode free tier            ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

let configPath;
try {
  configPath = resolveConfigPath();
} catch (error) {
  console.error(`❌ Configuration error: ${error.message}`);
  process.exit(1);
}

let gateway;
try {
  gateway = new Gateway(configPath);
} catch (error) {
  console.error(`❌ Failed to load config ${configPath}: ${error.message}`);
  process.exit(1);
}

gateway.start().catch((error) => {
  console.error('❌ Failed to start gateway:', error.message);
  console.error(error.stack);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`\n\n⏹️  Received ${signal}, stopping gateway...\n`);
  try {
    await gateway.stop();
  } finally {
    process.exit(0);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
});
