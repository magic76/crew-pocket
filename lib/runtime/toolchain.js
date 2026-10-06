const fs = require('node:fs');
const path = require('node:path');

const COMMANDS = ['bash', 'node', 'sh', 'df', 'tar', 'git', 'python3', 'magick', 'adb', 'curl', 'npm', 'rg'];

function findExecutable(command, env = process.env) {
  const candidates = command.includes(path.sep)
    ? [command]
    : String(env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, command));
  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) {}
  }
  return null;
}

// This is executable discovery, not proof that a loader or provider task works.
function toolchainSnapshot(env = process.env) {
  const commands = {};
  for (const command of COMMANDS) {
    const executable = command === 'node' ? process.execPath : findExecutable(command, env);
    let resolvedPath = executable;
    if (executable) {
      try { resolvedPath = fs.realpathSync(executable); } catch (_) {}
    }
    const delivery = !executable ? 'unavailable'
      : resolvedPath.startsWith('/data/app/') ? 'runtime-apk'
        : /^\/(?:system|product|apex|vendor)\//.test(resolvedPath) ? 'android-system'
          : resolvedPath.startsWith('/data/data/com.termux/') ? 'termux' : 'external';
    commands[command] = { available: Boolean(executable), path: executable, resolvedPath, delivery };
  }
  return {
    discoveryOnly: true,
    commands,
    missing: COMMANDS.filter(command => !commands[command].available)
  };
}

module.exports = { findExecutable, toolchainSnapshot };
