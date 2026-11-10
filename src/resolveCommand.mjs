import fs from 'fs';
import path from 'path';

const isWindows = process.platform === 'win32';

function pathDirs() {
  return (process.env.PATH || process.env.Path || '')
    .split(path.delimiter)
    .map((dir) => dir.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);
}

function isRunnable(file) {
  try {
    if (!fs.statSync(file).isFile()) return false;
    if (!isWindows) fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * npm installs a POSIX shell script next to the Windows shims. It is a regular
 * file, but spawn() cannot execute it. Real Windows binaries start with "MZ".
 */
function looksLikeWindowsBinary(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const header = Buffer.alloc(2);
    const read = fs.readSync(fd, header, 0, 2, 0);
    fs.closeSync(fd);
    return read === 2 && header.toString('latin1') === 'MZ';
  } catch {
    return false;
  }
}

function isRunnableWindowsTarget(file) {
  return isRunnable(file) && looksLikeWindowsBinary(file);
}

/**
 * Resolve a bare command name to an actual file on disk.
 *
 * Node cannot spawn npm's `.cmd` shims directly on Windows (spawn throws EINVAL),
 * so `.exe` targets are preferred and `.cmd`/`.bat` targets are reported so the
 * caller can wrap them with cmd.exe.
 *
 * Returns { command, shell } or null when nothing matches.
 */
export function resolveCommand(command) {
  if (!command || typeof command !== 'string') return null;

  const hasSeparator = command.includes('/') || command.includes('\\');

  if (hasSeparator) {
    const candidates = isWindows && !path.extname(command)
      ? [command, `${command}.exe`, `${command}.cmd`, `${command}.bat`]
      : [command];
    for (const candidate of candidates) {
      const resolved = path.resolve(candidate);
      if (!isRunnable(resolved)) continue;
      // On Windows an extensionless file is usually the POSIX shell script npm
      // installs beside the .cmd shim; only accept it when it is a real binary.
      if (isWindows && !path.extname(resolved) && !looksLikeWindowsBinary(resolved)) continue;
      return { command: resolved, shell: isShim(resolved) };
    }
    return null;
  }

  const dirs = pathDirs();

  if (isWindows) {
    // Prefer a real executable so no cmd.exe wrapper is needed.
    for (const dir of dirs) {
      const candidate = path.join(dir, `${command}.exe`);
      if (isRunnableWindowsTarget(candidate)) return { command: candidate, shell: false };
    }
    for (const dir of dirs) {
      const candidate = path.join(dir, command);
      if (isRunnableWindowsTarget(candidate)) return { command: candidate, shell: false };
    }
    for (const dir of dirs) {
      for (const ext of ['.cmd', '.bat']) {
        const candidate = path.join(dir, `${command}${ext}`);
        if (isRunnable(candidate)) return { command: candidate, shell: true };
      }
    }
    return null;
  }

  for (const dir of dirs) {
    const candidate = path.join(dir, command);
    if (isRunnable(candidate)) return { command: candidate, shell: false };
  }
  return null;
}

function isShim(file) {
  return isWindows && /\.(cmd|bat)$/i.test(file);
}

/** Quote one argument for the cmd.exe command line. */
function quoteArg(arg) {
  const value = String(arg);
  if (value === '') return '""';
  if (!/[\s"&|<>^()%!]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Build the actual { command, args, options } for spawn().
 * `.cmd`/`.bat` targets are run through cmd.exe using the documented
 * `cmd /d /s /c ""<exe>" <args>"` form with verbatim arguments.
 */
export function buildSpawn(command, args = []) {
  const resolved = resolveCommand(command);
  if (!resolved) {
    const error = new Error(
      `Could not find executable "${command}". Install it or set opencode.command to an absolute path.`,
    );
    error.code = 'ENOENT';
    throw error;
  }

  if (!resolved.shell) {
    return { command: resolved.command, args, options: {} };
  }

  const comspec = process.env.ComSpec || 'cmd.exe';
  const line = `"${resolved.command}" ${args.map(quoteArg).join(' ')}`.trim();
  return {
    command: comspec,
    args: ['/d', '/s', '/c', `"${line}"`],
    options: { windowsVerbatimArguments: true },
  };
}
