const fs = require('node:fs');
const path = require('node:path');

const COMMANDS = ['bash', 'node', 'sh', 'df', 'tar', 'git', 'python3', 'magick', 'adb', 'curl', 'npm', 'npx', 'rg', 'jev'];

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
  const names = new Set(COMMANDS);
  let limitations = [];
  if (env.CREW_TOOLCHAIN_MANIFEST) {
    try {
      const manifest = JSON.parse(fs.readFileSync(env.CREW_TOOLCHAIN_MANIFEST, 'utf8'));
      const registered = Array.isArray(manifest.tools) ? manifest.tools
        : Object.keys(manifest.commands || {}).filter(command => !command.startsWith('git-'));
      registered.forEach(command => names.add(command));
      limitations = Array.isArray(manifest.limitations) ? manifest.limitations : [];
    } catch (_) {}
  }
  for (const command of names) {
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
    limitations,
    commands,
    missing: [...names].filter(command => !commands[command].available)
  };
}

module.exports = { findExecutable, toolchainSnapshot };
