const path = require('node:path');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const { resolveCodexCommand } = require('./codex-transport');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const UPDATE_SCRIPT = path.join(ROOT_DIR, 'scripts', 'update-provider.sh');

const DEFINITIONS = {
  claude: { id: 'claude', label: 'Claude Code', binary: 'claude' },
  codex: {
    id: 'codex',
    label: 'OpenAI Codex',
    binary: 'codex'
  },
  antigravity: {
    id: 'antigravity',
    label: 'Google Antigravity',
    binary: 'agy'
  }
};

function execFileText(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout: options.timeout || 20_000,
      maxBuffer: 4 * 1024 * 1024,
      env: options.env || process.env,
      cwd: options.cwd || ROOT_DIR
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout || '';
        error.stderr = stderr || '';
        return reject(error);
      }
      resolve({
        stdout: String(stdout || '').trim(),
        stderr: String(stderr || '').trim()
      });
    });
  });
}

async function binaryVersion(binary) {
  try {
    // Match the Termux chat transport, bypassing a JS launcher's /usr/bin/env
    // shebang, which need not exist on Android.
    const script = binary === 'codex' ? resolveCodexCommand() : null;
    if (script) fs.accessSync(script, fs.constants.X_OK);
    const result = await execFileText(script ? process.execPath : binary,
      script ? [script, '--version'] : ['--version'], { timeout: 10_000 });
    const line = (result.stdout || result.stderr).split('\n').find(Boolean) || '';
    return {
      installed: true,
      version: line.trim() || 'installed'
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return { installed: false, version: null };
    }
    return {
      installed: true,
      version: null,
      error: String(error.stderr || error.message || error).trim()
    };
  }
}

async function providerStatus(id) {
  const definition = DEFINITIONS[id];
  if (!definition) throw new Error('Unsupported provider');

  const version = await binaryVersion(definition.binary);
  return {
    id: definition.id,
    label: definition.label,
    binary: definition.binary,
    installed: version.installed,
    version: version.version,
    error: version.error || null,
    updateSupported: id !== 'claude'
  };
}

async function getProviderRuntimeStatus() {
  const [codex, antigravity, claude] = await Promise.all([
    providerStatus('codex'),
    providerStatus('antigravity'),
    providerStatus('claude')
  ]);

  return {
    runtime: 'termux',
    providers: { codex, antigravity, claude }
  };
}

async function updateProvider(id) {
  if (!DEFINITIONS[id] || id === 'claude') throw new Error('Claude Code updates are managed by the official CLI; update it from your terminal');

  const result = await execFileText(
    'bash',
    [UPDATE_SCRIPT, id],
    { timeout: 10 * 60 * 1000 }
  );

  return {
    provider: await providerStatus(id),
    output: [result.stdout, result.stderr].filter(Boolean).join('\n').slice(-12000)
  };
}

module.exports = {
  getProviderRuntimeStatus,
  updateProvider
};
