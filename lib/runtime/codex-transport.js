const net = require('node:net');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const DEFAULT_BRIDGE_HOST = '127.0.0.1';
const DEFAULT_BRIDGE_PORT = 8766;
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
  return {
    mode,
    host: env.CREW_CODEX_BRIDGE_HOST || DEFAULT_BRIDGE_HOST,
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_BRIDGE_PORT,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_BRIDGE_TIMEOUT_MS
  };
}

function connectBridge(config) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: config.host, port: config.port });
    let settled = false;

    const finish = (handler, value) => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      socket.removeListener('connect', onConnect);
      socket.removeListener('timeout', onTimeout);
      socket.removeListener('error', onError);
      handler(value);
    };

    const onConnect = () => {
      socket.setNoDelay(true);
      finish(resolve, new SocketCodexTransport(socket));
    };
    const onTimeout = () => {
      const error = new Error(`Embedded Codex bridge timed out at ${config.host}:${config.port}`);
      socket.destroy();
      finish(reject, error);
    };
    const onError = err => {
      socket.destroy();
      finish(reject, err);
    };

    socket.setTimeout(config.timeoutMs);
    socket.once('connect', onConnect);
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
