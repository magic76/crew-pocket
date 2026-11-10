'use strict';

const fs = require('node:fs');
const fsPromises = fs.promises;
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const TUNNEL_HOSTNAME = 'auth.3sssi.com';
const CALLBACK_PATH = '^/oauth/meta/(facebook|threads)/callback$';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_CONFIG_KEYS = new Set(['tunnel', 'credentials-file', 'no-autoupdate', 'metrics', 'protocol', 'ingress']);
const ALLOWED_ROUTE_KEYS = new Set(['hostname', 'path', 'service']);

function controllerError(message, statusCode = 409) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.userMessage = message;
  return error;
}

function yamlScalar(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';
  if (value.startsWith('"') && value.endsWith('"')) {
    try { return JSON.parse(value); } catch (_) { throw controllerError('Tunnel 設定格式無法安全解析。'); }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  const commentIndex = value.search(/\s+#/);
  if (commentIndex >= 0) value = value.slice(0, commentIndex).trim();
  return value;
}

function parseSimpleConfig(source) {
  const top = {};
  const routes = [];
  let inIngress = false;
  let currentRoute = null;
  const addRouteValue = (line, target) => {
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match || !ALLOWED_ROUTE_KEYS.has(match[1]) || Object.prototype.hasOwnProperty.call(target, match[1])) {
      throw controllerError('Tunnel ingress 規則格式不符合安全範圍。');
    }
    target[match[1]] = yamlScalar(match[2]);
  };

  for (const line of String(source || '').split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;
    if (!inIngress) {
      const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
      if (!match || !ALLOWED_CONFIG_KEYS.has(match[1]) || Object.prototype.hasOwnProperty.call(top, match[1])) {
        throw controllerError('Tunnel 設定格式或額外路由不符合安全範圍。');
      }
      if (match[1] === 'ingress') {
        if (String(match[2] || '').trim()) throw controllerError('Tunnel ingress 規則格式不符合安全範圍。');
        inIngress = true;
        continue;
      }
      top[match[1]] = yamlScalar(match[2]);
      continue;
    }

    const routeStart = line.match(/^ {2}-\s*(.*)$/);
    if (routeStart) {
      if (currentRoute) routes.push(currentRoute);
      currentRoute = {};
      if (routeStart[1]) addRouteValue(routeStart[1], currentRoute);
      continue;
    }
    const routeValue = line.match(/^ {4}([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (routeValue && currentRoute) {
      addRouteValue(routeValue[1] + ':' + (routeValue[2] || ''), currentRoute);
      continue;
    }
    throw controllerError('Tunnel ingress 規則格式不符合安全範圍。');
  }
  if (currentRoute) routes.push(currentRoute);

  if (!UUID_PATTERN.test(String(top.tunnel || '')) || !top['credentials-file'] || routes.length < 2) {
    throw controllerError('既有 OAuth callback Tunnel 設定不完整。');
  }
  const targetRoutes = routes.filter(route => route.hostname === TUNNEL_HOSTNAME
    && route.path === CALLBACK_PATH
    && route.service === 'http://127.0.0.1:8000');
  const forwardedRoutes = routes.filter(route => route.service !== 'http_status:404');
  const fallback = routes[routes.length - 1];
  if (targetRoutes.length !== 1
      || forwardedRoutes.length !== 1
      || routes.some(route => !route.service
        || (route.hostname && route.hostname !== TUNNEL_HOSTNAME)
        || (route.service === 'http_status:404' && route.path))
      || fallback.service !== 'http_status:404'
      || fallback.hostname
      || fallback.path) {
    throw controllerError('Tunnel ingress 不只包含預期的 OAuth callback，控制已停用。');
  }
  return { tunnelId: String(top.tunnel), credentialValue: String(top['credentials-file']) };
}

function isOwnedByCurrentUser(stats) {
  return typeof process.getuid !== 'function' || stats.uid === process.getuid();
}

async function assertPrivateFile(filePath, kind) {
  let stats;
  try { stats = await fsPromises.lstat(filePath); }
  catch (_) { throw controllerError(kind + ' 不存在或不可讀取。', 503); }
  if (!stats.isFile() || stats.isSymbolicLink() || !isOwnedByCurrentUser(stats) || (stats.mode & 0o077) !== 0) {
    throw controllerError(kind + ' 權限不符合安全要求。', 503);
  }
  let realPath;
  try { realPath = await fsPromises.realpath(filePath); }
  catch (_) { throw controllerError(kind + ' 不存在或不可讀取。', 503); }
  if (realPath !== path.resolve(filePath)) throw controllerError(kind + ' 路徑不符合安全要求。', 503);
  return stats;
}

function executableDirectories(homeDir) {
  const prefix = path.resolve(process.env.PREFIX || '/data/data/com.termux/files/usr');
  return [
    path.join(prefix, 'bin'),
    path.join(homeDir, 'bin'),
    path.join(homeDir, '.local', 'bin')
  ];
}

async function findCloudflared(homeDir) {
  for (const directory of executableDirectories(homeDir)) {
    const candidate = path.join(directory, 'cloudflared');
    try {
      const realPath = await fsPromises.realpath(candidate);
      const stats = await fsPromises.stat(realPath);
      await fsPromises.access(realPath, fs.constants.X_OK);
      if (stats.isFile() && (stats.mode & 0o022) === 0
          && (isOwnedByCurrentUser(stats) || stats.uid === 0)) return realPath;
    } catch (_) {}
  }
  return '';
}

function parseMetricsPort(args) {
  let value = '';
  const index = args.indexOf('--metrics');
  if (index >= 0) value = args[index + 1] || '';
  if (!value) {
    const equalArg = args.find(arg => arg.startsWith('--metrics='));
    if (equalArg) value = equalArg.slice('--metrics='.length);
  }
  const match = String(value).match(/^(?:127\.0\.0\.1|localhost):(\d{1,5})$/i);
  if (!match) return 0;
  const port = Number(match[1]);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 0;
}

function hasConfigArgument(args, configPath) {
  const index = args.indexOf('--config');
  if (index >= 0 && path.resolve(args[index + 1] || '') === configPath) return true;
  return args.includes('--config=' + configPath);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function probeReady(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.resolve(false);
  return new Promise(resolve => {
    let finished = false;
    const done = value => {
      if (finished) return;
      finished = true;
      resolve(value);
    };
    const request = http.get({ host: '127.0.0.1', port, path: '/ready', timeout: 900 }, response => {
      response.resume();
      done(response.statusCode === 200);
    });
    request.on('error', () => done(false));
    request.on('timeout', () => request.destroy());
  });
}

async function allocateLoopbackPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}

function cleanCloudflaredEnv(homeDir) {
  const env = { ...process.env, HOME: homeDir };
  for (const name of Object.keys(env)) {
    if (/^(TUNNEL_|CLOUDFLARED_)/i.test(name)) delete env[name];
  }
  return env;
}

function safeSnapshot(state, message, extra = {}) {
  return {
    available: state !== 'unavailable',
    state,
    running: ['starting', 'connected', 'running'].includes(state),
    connected: state === 'connected',
    hostname: TUNNEL_HOSTNAME,
    scope: '僅 Meta／Threads OAuth callback；其他路徑回 404',
    message,
    ...extra
  };
}

function createAuthTunnelController({ homeDir = os.homedir() } = {}) {
  const resolvedHome = path.resolve(homeDir);
  const configDir = path.join(resolvedHome, '.cloudflared');
  const configPath = path.join(configDir, 'config.yml');
  const controlStatePath = path.join(configDir, 'auth-tunnel-control.json');
  let lastFailureAt = 0;
  let actionQueue = Promise.resolve();
  const managedPids = new Set();
  const intentionalStops = new Set();

  function serializeAction(action) {
    const next = actionQueue.then(action, action);
    actionQueue = next.catch(() => {});
    return next;
  }

  async function validateConfiguration() {
    let dirStats;
    try { dirStats = await fsPromises.lstat(configDir); }
    catch (_) { throw controllerError('找不到既有 OAuth callback Tunnel 設定。', 503); }
    if (!dirStats.isDirectory() || dirStats.isSymbolicLink() || !isOwnedByCurrentUser(dirStats) || (dirStats.mode & 0o077) !== 0) {
      throw controllerError('Tunnel 設定目錄權限不符合安全要求。', 503);
    }
    await assertPrivateFile(configPath, 'Tunnel 設定');
    let parsed;
    try { parsed = parseSimpleConfig(await fsPromises.readFile(configPath, 'utf8')); }
    catch (error) {
      if (error?.userMessage) throw error;
      throw controllerError('既有 OAuth callback Tunnel 設定無法安全讀取。', 503);
    }
    let credentialPath = parsed.credentialValue;
    if (credentialPath.startsWith('~/')) credentialPath = path.join(resolvedHome, credentialPath.slice(2));
    else if (!path.isAbsolute(credentialPath)) credentialPath = path.resolve(configDir, credentialPath);
    credentialPath = path.resolve(credentialPath);
    const relativeCredentialPath = path.relative(configDir, credentialPath);
    if (!relativeCredentialPath || relativeCredentialPath.startsWith('..') || path.isAbsolute(relativeCredentialPath)
        || path.basename(credentialPath) !== parsed.tunnelId + '.json') {
      throw controllerError('Tunnel 憑證檔路徑不符合安全要求。', 503);
    }
    await assertPrivateFile(credentialPath, 'Tunnel 憑證檔');
    return parsed;
  }

  async function inspectTunnelProcess(pid, tunnelId, binaryPath) {
    let args;
    try {
      const raw = await fsPromises.readFile(path.join('/proc', String(pid), 'cmdline'));
      args = raw.toString().split('\0').filter(Boolean);
    } catch (_) { return null; }
    if (args.length < 4 || !path.isAbsolute(args[0]) || path.resolve(args[0]) !== binaryPath
        || !args.includes('tunnel') || !args.includes('run') || !hasConfigArgument(args, configPath)) return null;
    const suppliedIds = args.filter(arg => UUID_PATTERN.test(arg));
    if (suppliedIds.some(id => id.toLowerCase() !== tunnelId.toLowerCase())) return null;
    return { pid, metricsPort: parseMetricsPort(args) };
  }

  async function findTunnelProcesses(tunnelId, binaryPath) {
    const found = [];
    let entries;
    try { entries = await fsPromises.readdir('/proc'); }
    catch (_) { entries = []; }
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      const pid = Number(entry);
      if (!Number.isSafeInteger(pid) || pid < 1 || pid === process.pid) continue;
      const processInfo = await inspectTunnelProcess(pid, tunnelId, binaryPath);
      if (processInfo) found.push(processInfo);
    }
    return found;
  }

  async function readStoredStartTime(pid) {
    try {
      await assertPrivateFile(controlStatePath, 'Tunnel 控制狀態');
      const raw = await fsPromises.readFile(controlStatePath, 'utf8');
      if (raw.length > 2048) return 0;
      const record = JSON.parse(raw);
      if (Number(record.pid) === pid && Number.isFinite(Number(record.startedAt))) return Number(record.startedAt);
    } catch (_) {}
    return 0;
  }

  async function writeStoredState(pid, startedAt) {
    const content = JSON.stringify({ pid, startedAt }) + '\n';
    try {
      const existing = await fsPromises.lstat(controlStatePath).catch(error => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
      if (existing && (!existing.isFile() || existing.isSymbolicLink() || !isOwnedByCurrentUser(existing))) {
        throw new Error('unsafe-state-file');
      }
      await fsPromises.writeFile(controlStatePath, content, { mode: 0o600 });
      await fsPromises.chmod(controlStatePath, 0o600);
    } catch (_) {
      throw controllerError('Tunnel 已啟動，但無法安全保存控制狀態；請立即重新整理狀態。', 503);
    }
  }

  async function clearStoredState() {
    try {
      const stats = await fsPromises.lstat(controlStatePath);
      if (stats.isFile() && !stats.isSymbolicLink() && isOwnedByCurrentUser(stats)) await fsPromises.unlink(controlStatePath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw controllerError('無法清除 Tunnel 控制狀態。', 503);
    }
  }

  async function snapshot(context = null, processes = null) {
    try {
      const config = context || await validateConfiguration();
      const binaryPath = await findCloudflared(resolvedHome);
      if (!binaryPath) return safeSnapshot('unavailable', 'Termux 找不到 cloudflared；尚未執行任何動作。');
      const matches = processes || await findTunnelProcesses(config.tunnelId, binaryPath);
      if (!matches.length) {
        if (Date.now() - lastFailureAt < 120000 && lastFailureAt > 0) {
          return safeSnapshot('error', 'cloudflared 未能維持執行；請檢查 Termux 執行環境後重試。');
        }
        return safeSnapshot('stopped', 'Tunnel 已停止。');
      }
      const checks = await Promise.all(matches.map(item => probeReady(item.metricsPort)));
      const connected = checks.some(Boolean);
      if (connected) {
        return safeSnapshot('connected', '已確認 Tunnel 連上 Cloudflare Edge。', { instances: matches.length });
      }
      const startTimes = await Promise.all(matches.map(item => readStoredStartTime(item.pid)));
      const starting = startTimes.some(startedAt => startedAt && Date.now() - startedAt < 20000);
      return safeSnapshot(starting ? 'starting' : 'running', starting
        ? 'Tunnel 程序已啟動，正在等待 Cloudflare Edge 連線。'
        : 'Tunnel 程序正在執行；目前無法確認 Edge 連線。', { instances: matches.length });
    } catch (error) {
      const message = error?.userMessage || '無法安全讀取既有 OAuth callback Tunnel 設定。';
      return safeSnapshot('unavailable', message);
    }
  }

  async function start() {
    return serializeAction(async () => {
      const config = await validateConfiguration();
      const binaryPath = await findCloudflared(resolvedHome);
      if (!binaryPath) throw controllerError('Termux 找不到 cloudflared。', 503);
      const currentProcesses = await findTunnelProcesses(config.tunnelId, binaryPath);
      if (currentProcesses.length) return snapshot(config, currentProcesses);

      const metricsPort = await allocateLoopbackPort();
      const args = [
        'tunnel', '--config', configPath,
        '--metrics', '127.0.0.1:' + metricsPort,
        '--no-autoupdate', 'run', config.tunnelId
      ];
      let child;
      try {
        child = spawn(binaryPath, args, {
          cwd: resolvedHome,
          env: cleanCloudflaredEnv(resolvedHome),
          detached: true,
          stdio: 'ignore'
        });
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('spawn-timeout')), 5000);
          child.once('spawn', () => { clearTimeout(timer); resolve(); });
          child.once('error', error => { clearTimeout(timer); reject(error); });
        });
        let childExited = false;
        child.once('exit', (code, signal) => {
          childExited = true;
          managedPids.delete(child.pid);
          if (!intentionalStops.delete(child.pid) && (code !== 0 || signal)) lastFailureAt = Date.now();
          fsPromises.readFile(controlStatePath, 'utf8').then(raw => {
            const storedState = JSON.parse(raw);
            if (Number(storedState.pid) === child.pid) return clearStoredState();
          }).catch(() => {});
        });
        child.unref();
        managedPids.add(child.pid);
        const startedAt = Date.now();
        await writeStoredState(child.pid, startedAt);
        if (childExited) await clearStoredState();
        return snapshot(config);
      } catch (_) {
        lastFailureAt = Date.now();
        if (child?.pid) {
          try { child.kill('SIGTERM'); } catch (_) {}
        }
        throw controllerError('cloudflared 無法啟動；設定與憑證未送入 WebView。', 503);
      }
    });
  }

  async function processStillMatches(pid, tunnelId, binaryPath) {
    return Boolean(await inspectTunnelProcess(pid, tunnelId, binaryPath));
  }

  async function stop() {
    return serializeAction(async () => {
      const config = await validateConfiguration();
      const binaryPath = await findCloudflared(resolvedHome);
      if (!binaryPath) throw controllerError('Termux 找不到 cloudflared。', 503);
      const matches = await findTunnelProcesses(config.tunnelId, binaryPath);
      if (!matches.length) {
        await clearStoredState();
        lastFailureAt = 0;
        return safeSnapshot('stopped', 'Tunnel 已停止。');
      }

      for (const processInfo of matches) {
        if (!await processStillMatches(processInfo.pid, config.tunnelId, binaryPath)) continue;
        if (managedPids.has(processInfo.pid)) intentionalStops.add(processInfo.pid);
        try { process.kill(processInfo.pid, 'SIGTERM'); }
        catch (error) { if (error?.code !== 'ESRCH') throw controllerError('停止 Tunnel 失敗。', 503); }
      }
      const deadline = Date.now() + 5000;
      let remaining = [];
      do {
        await delay(150);
        remaining = [];
        for (const processInfo of matches) {
          if (await processStillMatches(processInfo.pid, config.tunnelId, binaryPath)) remaining.push(processInfo);
        }
      } while (remaining.length && Date.now() < deadline);

      for (const processInfo of remaining) {
        if (!await processStillMatches(processInfo.pid, config.tunnelId, binaryPath)) continue;
        try { process.kill(processInfo.pid, 'SIGKILL'); }
        catch (error) { if (error?.code !== 'ESRCH') throw controllerError('Tunnel 未能正常停止。', 503); }
      }
      if (remaining.length) {
        await delay(250);
        for (const processInfo of remaining) {
          if (await processStillMatches(processInfo.pid, config.tunnelId, binaryPath)) {
            throw controllerError('Tunnel 程序仍在執行，請稍後重新整理狀態。', 503);
          }
        }
      }
      await clearStoredState();
      lastFailureAt = 0;
      return safeSnapshot('stopped', 'Tunnel 已停止。');
    });
  }

  return { getStatus: () => snapshot(), start, stop };
}

module.exports = { createAuthTunnelController };
