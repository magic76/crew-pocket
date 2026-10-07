const path = require('node:path');
const { execFile } = require('node:child_process');

const ROOT_DIR = path.resolve(__dirname, '..', '..');
const UPDATE_SCRIPT = path.join(ROOT_DIR, 'scripts', 'update-provider.sh');
const DEFAULT_RUNTIME_PACKAGE = 'com.crewpocket.runtime';

function deliveryMode(env = process.env) {
  return String(env.CREW_PROVIDER_DELIVERY || 'termux').trim() || 'termux';
}

function runtimeAppMetadata(env = process.env) {
  return {
    packageName: String(env.CREW_RUNTIME_PACKAGE || DEFAULT_RUNTIME_PACKAGE).trim() || DEFAULT_RUNTIME_PACKAGE,
    version: String(env.CREW_RUNTIME_VERSION || '').trim() || null,
    updateMode: String(env.CREW_PROVIDER_UPDATE_MODE || 'runtime-app').trim() || 'runtime-app'
  };
}

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

  const delivery = deliveryMode();
  if (delivery === 'runtime-apk') {
    const envKey = id === 'codex' ? 'CREW_CODEX_VERSION' : 'CREW_AGY_VERSION';
    const runtimeApp = runtimeAppMetadata();
    return {
      id: definition.id,
      label: definition.label,
      binary: definition.binary,
      installed: true,
      version: process.env[envKey] || null,
      error: null,
      delivery,
      updateSupported: false,
      updateMode: runtimeApp.updateMode,
      updateScope: 'runtime',
      runtimePackage: runtimeApp.packageName,
      runtimeVersion: runtimeApp.version
    };
  }

  const version = await binaryVersion(definition.binary);
  return {
    id: definition.id,
    label: definition.label,
    binary: definition.binary,
    installed: version.installed,
    version: version.version,
    error: version.error || null,
    delivery,
    updateSupported: true,
    updateMode: 'provider',
    updateScope: 'provider',
    runtimePackage: null,
    runtimeVersion: null
  };
}

async function getProviderRuntimeStatus() {
  const [codex, antigravity] = await Promise.all([
    providerStatus('codex'),
    providerStatus('antigravity')
  ]);

  const delivery = deliveryMode();
  const runtimeApp = delivery === 'runtime-apk' ? runtimeAppMetadata() : null;
  return {
    runtime: delivery === 'runtime-apk' ? 'companion-runtime' : 'termux',
    delivery,
    updateMode: delivery === 'runtime-apk' ? runtimeApp.updateMode : 'provider',
    runtimePackage: runtimeApp?.packageName || null,
    runtimeVersion: runtimeApp?.version || null,
    providers: { codex, antigravity }
  };
}

async function updateProvider(id) {
  if (!DEFINITIONS[id]) throw new Error('Unsupported provider');

  if (deliveryMode() !== 'termux') {
    const runtimeApp = runtimeAppMetadata();
    const error = new Error('Codex and AGY are updated by updating the Crew Runtime app');
    error.statusCode = 409;
    error.code = 'RUNTIME_APP_UPDATE_REQUIRED';
    error.action = {
      type: 'update-runtime-app',
      packageName: runtimeApp.packageName,
      runtimeVersion: runtimeApp.version
    };
    throw error;
  }

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
