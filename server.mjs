#!/usr/bin/env node
import { Gateway } from './src/Gateway.mjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const configPath = path.join(__dirname, 'config.yaml');

console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║        OpenCode Free Rotator Gateway                      ║
║                                                           ║
║  Multi-instance pooling for OpenCode free tier           ║
║  200 req/day × N accounts                                 ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);

const gateway = new Gateway(configPath);

// Start gateway
gateway.start().catch(error => {
  console.error('❌ Failed to start gateway:', error.message);
  console.error(error.stack);
  process.exit(1);
});

// Handle Ctrl+C
process.on('SIGINT', async () => {
  console.log('\n\n⏹️  Received SIGINT, stopping gateway...\n');
  await gateway.stop();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n\n⏹️  Received SIGTERM, stopping gateway...\n');
  await gateway.stop();
  process.exit(0);
});

// Keep process alive
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled rejection:', reason);
});
