const net = require('node:net');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BRIDGE_HOST = '127.0.0.1';
// 8766 is reserved for Crew Helper's private bridge. Crew Pocket owns 8767.
const DEFAULT_BRIDGE_PORT = 8767;
const DEFAULT_BRIDGE_TIMEOUT_MS = 350;

class SocketCodexTransport extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.stdin = socket;
    this.stdout = socket;
    this.stderr = new PassThrough();
    this.killed = false;
    this.runtimeType = 'embedded-android-bridge';

    socket.once('error', err => this.emit('error', err));
    socket.once('close', hadError => {
      this.killed = true;
      this.stderr.end();
      this.emit('close', hadError ? 1 : 0);
    });
  }

  kill() {
    if (this.killed) return false;
    this.killed = true;
    this.socket.destroy();
    return true;
  }
}

function bridgeConfig(env = process.env) {
  const rawMode = String(env.CREW_CODEX_BRIDGE || 'auto').trim().toLowerCase();
  const mode = ['auto', 'required', 'off'].includes(rawMode) ? rawMode : 'auto';
  const port = Number(env.CREW_CODEX_BRIDGE_PORT || DEFAULT_BRIDGE_PORT);
  const timeoutMs = Number(env.CREW_CODEX_BRIDGE_TIMEOUT_MS || DEFAULT_BRIDGE_TIMEOUT_MS);
  const tokenPath = env.CREW_CODEX_BRIDGE_TOKEN_FILE ||
    path.join(env.HOME || '', '.crew-pocket', 'embedded-bridge-token');
  let token = '';
  try {
    token = fs.readFileSync(tokenPath, 'utf8').trim();
  } catch (_) {}

  return {
    mode,
    host: env.CREW_CODEX_BRIDGE_HOST || DEFAULT_BRIDGE_HOST,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_BRIDGE_PORT,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_BRIDGE_TIMEOUT_MS,
    token
  };
}

function connectBridge(config) {
  return new Promise((resolve, reject) => {
    if (!/^[0-9a-f]{64}$/.test(config.token || '')) {
      return reject(new Error('Embedded Codex bridge token is unavailable'));
    }

    const socket = net.createConnection({ host: config.host, port: config.port });
    let settled = false;
    let response = '';

    const cleanup = () => {
      socket.setTimeout(0);
      socket.removeListener('connect', onConnect);
      socket.removeListener('data', onData);
      socket.removeListener('timeout', onTimeout);
      socket.removeListener('error', onError);
    };
    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      handler(value);
    };
    const onConnect = () => {
      socket.setNoDelay(true);
      socket.write(`CREW-CODEX-BRIDGE/1 ${config.token}\n`);
    };
    const onData = chunk => {
      response += chunk.toString('utf8');
      const newline = response.indexOf('\n');
      if (newline < 0) {
        if (response.length > 32) onError(new Error('Invalid embedded bridge handshake'));
        return;
      }

      const line = response.slice(0, newline).trim();
      const remainder = response.slice(newline + 1);
      if (line !== 'OK') {
        onError(new Error('Embedded bridge rejected authentication'));
        return;
      }
      if (remainder) socket.unshift(Buffer.from(remainder, 'utf8'));
      finish(resolve, new SocketCodexTransport(socket));
    };
    const onTimeout = () => {
      onError(new Error(`Embedded Codex bridge timed out at ${config.host}:${config.port}`));
    };
    const onError = err => {
      socket.destroy();
      finish(reject, err);
    };

    socket.setTimeout(config.timeoutMs);
    socket.on('connect', onConnect);
    socket.on('data', onData);
    socket.once('timeout', onTimeout);
    socket.once('error', onError);
  });
}

async function startCodexTransport({ cwd, env = process.env } = {}) {
  const config = bridgeConfig(env);

  if (config.mode !== 'off') {
    try {
      const transport = await connectBridge(config);
      console.log(`[Codex Runtime] Connected to embedded Android bridge at ${config.host}:${config.port}`);
      return transport;
    } catch (error) {
      if (config.mode === 'required') {
        const wrapped = new Error(`Embedded Codex bridge required but unavailable: ${error.message}`);
        wrapped.cause = error;
        throw wrapped;
      }
      console.log('[Codex Runtime] Embedded bridge unavailable; using local codex process.');
    }
  }

  const child = spawn('codex', ['app-server', '--listen', 'stdio://'], {
    cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  child.runtimeType = 'local-codex-process';
  return child;
}

module.exports = {
  DEFAULT_BRIDGE_HOST,
  DEFAULT_BRIDGE_PORT,
  bridgeConfig,
  startCodexTransport
};
