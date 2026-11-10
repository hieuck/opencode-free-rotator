import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveCommand, buildSpawn } from '../src/resolveCommand.mjs';

const isWindows = process.platform === 'win32';

test('resolveCommand returns null for obviously missing commands', () => {
  assert.equal(resolveCommand('definitely-not-a-real-binary-xyz'), null);
});

test('resolveCommand resolves a bare command found on PATH', { skip: !isWindows }, () => {
  const resolved = resolveCommand('node');
  assert.ok(resolved, 'node should resolve on Windows');
  assert.match(resolved.command, /node(\.exe)?$/i);
  assert.equal(resolved.shell, false);
});

test('buildSpawn runs a resolved .exe directly', { skip: !isWindows }, () => {
  const launch = buildSpawn('node', ['--version']);
  assert.match(launch.command, /node\.exe$/i);
  assert.deepEqual(launch.args, ['--version']);
  assert.deepEqual(launch.options, {});
});

test('buildSpawn wraps .cmd shims in cmd.exe with verbatim arguments', { skip: !isWindows }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotator-cmd-'));
  const shim = path.join(dir, 'fake-tool.cmd');
  fs.writeFileSync(shim, '@echo off\r\necho hi\r\n');

  const previous = process.env.PATH;
  process.env.PATH = `${dir};${previous}`;
  try {
    const launch = buildSpawn('fake-tool', ['--port', '3001']);
    assert.equal(launch.command.toLowerCase(), (process.env.ComSpec || 'cmd.exe').toLowerCase());
    assert.deepEqual(launch.args.slice(0, 3), ['/d', '/s', '/c']);
    assert.match(launch.args[3], /^""/);
    assert.match(launch.args[3], /--port 3001"?$/);
    assert.equal(launch.options.windowsVerbatimArguments, true);
  } finally {
    process.env.PATH = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('buildSpawn throws a helpful error for a missing executable', () => {
  assert.throws(
    () => buildSpawn('definitely-not-a-real-binary-xyz', []),
    /Could not find executable/,
  );
});

test('resolveCommand accepts an absolute path with spaces', { skip: !isWindows }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rotator space '));
  const file = path.join(dir, 'tool.exe');
  fs.writeFileSync(file, 'not really an exe');

  const resolved = resolveCommand(file);
  assert.ok(resolved);
  assert.equal(resolved.command, path.resolve(file));

  fs.rmSync(dir, { recursive: true, force: true });
});
