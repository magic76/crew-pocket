const fs = require('node:fs');
const { spawn, execFile } = require('node:child_process');

function runtimeConfig(env = process.env) {
  const type = String(env.CREW_AGY_RUNTIME_TYPE || '').trim();
  const entry = String(env.CREW_AGY_ENTRY || '').trim();
  return { type, entry };
}

function spawnAgy(args = [], { cwd, env = process.env, stdio = ['pipe', 'pipe', 'pipe'] } = {}) {
  const config = runtimeConfig(env);

  if (config.type === 'node-script' && config.entry && fs.existsSync(config.entry)) {
    const child = spawn(process.execPath, [config.entry, ...args], { cwd, env, stdio });
    child.runtimeType = 'embedded-agy-node-script';
    return child;
  }

  const child = spawn('agy', args, { cwd, env, stdio });
  child.runtimeType = 'local-agy-process';
  return child;
}

function execAgy(args = [], { cwd, env = process.env, timeout = 25000 } = {}) {
  const config = runtimeConfig(env);
  const command = config.type === 'node-script' && config.entry && fs.existsSync(config.entry)
    ? process.execPath
    : 'agy';
  const finalArgs = command === process.execPath ? [config.entry, ...args] : args;

  return new Promise((resolve, reject) => {
    execFile(command, finalArgs, { cwd, env, timeout, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        error.stderr = stderr;
        return reject(error);
      }
      resolve({ stdout: stdout || '', stderr: stderr || '' });
    });
  });
}

function isAgyAvailable(env = process.env) {
  const config = runtimeConfig(env);
  if (config.type === 'node-script' && config.entry) return fs.existsSync(config.entry);

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
  spawnAgy,
  execAgy,
  isAgyAvailable
};
