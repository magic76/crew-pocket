const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');

function parseCommand(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(value => String(value || '')).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function runtimeConfig(env = process.env) {
  const type = String(env.CREW_AGY_RUNTIME_TYPE || '').trim();
  const entry = String(env.CREW_AGY_ENTRY || '').trim();
  const command = parseCommand(env.CREW_AGY_COMMAND_JSON);
  return { type, entry, command };
}

function resolveAgyCommand(env = process.env) {
  const config = runtimeConfig(env);

  if (config.type === 'node-script' && config.entry && fs.existsSync(config.entry)) {
    return {
      command: process.execPath,
      prefixArgs: [config.entry],
      runtimeType: 'embedded-agy-node-script'
    };
  }

  if (
    config.type === 'native-command' &&
    config.command.length > 0 &&
    fs.existsSync(config.command[0])
  ) {
    return {
      command: config.command[0],
      prefixArgs: config.command.slice(1),
      runtimeType: 'embedded-agy-native-command'
    };
  }

  return {
    command: 'agy',
    prefixArgs: [],
    runtimeType: 'local-agy-process'
  };
}

function spawnAgy(args = [], { cwd, env = process.env, stdio = ['pipe', 'pipe', 'pipe'] } = {}) {
  const runtime = resolveAgyCommand(env);
  const child = spawn(runtime.command, [...runtime.prefixArgs, ...args], { cwd, env, stdio });
  child.runtimeType = runtime.runtimeType;
  return child;
}

function execAgy(args = [], { cwd, env = process.env, timeout = 25000 } = {}) {
  const runtime = resolveAgyCommand(env);
  return new Promise((resolve, reject) => {
    execFile(
      runtime.command,
      [...runtime.prefixArgs, ...args],
      { cwd, env, timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          return reject(error);
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    );
  });
}

function isAgyAvailable(env = process.env) {
  const config = runtimeConfig(env);
  if (config.type === 'node-script' && config.entry) {
    return fs.existsSync(config.entry);
  }
  if (config.type === 'native-command' && config.command.length > 0) {
    return fs.existsSync(config.command[0]);
  }

  try {
    require('node:child_process').execFileSync('sh', ['-lc', 'command -v agy'], {
      stdio: 'ignore',
      env
    });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  runtimeConfig,
  resolveAgyCommand,
  spawnAgy,
  execAgy,
  isAgyAvailable
};
