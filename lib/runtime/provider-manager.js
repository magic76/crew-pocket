const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const UPDATE_SCRIPT = path.join(ROOT_DIR, 'scripts', 'update-provider.sh');

const DEFINITIONS = {
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
    const result = await execFileText(binary, ['--version'], { timeout: 10_000 });
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
    updateSupported: true
  };
}

async function getProviderRuntimeStatus() {
  const [codex, antigravity] = await Promise.all([
    providerStatus('codex'),
    providerStatus('antigravity')
  ]);

  return {
    runtime: 'termux',
    providers: { codex, antigravity }
  };
}

async function updateProvider(id) {
  if (!DEFINITIONS[id]) throw new Error('Unsupported provider');

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
