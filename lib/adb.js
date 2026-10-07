const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const DEADLINES = Object.freeze({ status: 3000, connect: 5000, pair: 12000 });
let pendingDevices = null;

function adbExecutable() {
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, 'adb');
    try { fs.accessSync(file, fs.constants.X_OK); if (fs.statSync(file).isFile()) return file; } catch (_) {}
  }
  return null;
}

async function runAdb(args, timeout) {
  const binary = adbExecutable();
  if (!binary) return { ok: false, timedOut: false, output: '目前環境未安裝 ADB。', stdout: '' };
  const env = { ...process.env };
  if (fs.realpathSync(binary).startsWith('/data/data/com.termux/')) {
    delete env.LD_LIBRARY_PATH;
    delete env.LD_PRELOAD;
  }
  try {
    const result = await execute(binary, args, { timeout, killSignal: 'SIGKILL', maxBuffer: 512 * 1024, env });
    return { ok: true, timedOut: false, stdout: result.stdout,
      output: `${result.stdout}\n${result.stderr}`.trim() };
  } catch (error) {
    const timedOut = Boolean(error.killed || error.signal === 'SIGKILL');
    const output = timedOut ? `ADB 等待超過 ${timeout / 1000} 秒，這次操作已停止。請確認 Wi-Fi、無線偵錯和目前 Port。`
      : `${error.stdout || ''}\n${error.stderr || ''}`.trim() || 'ADB 執行失敗，請確認無線偵錯與配對狀態。';
    return { ok: false, timedOut, stdout: error.stdout || '', output };
  }
}

function connectedDevice(stdout, target) {
  return stdout.split('\n').some(line => {
    const [serial, state] = line.trim().split(/\s+/);
    return state === 'device' && (target ? serial === target : /:\d+$/.test(serial || ''));
  });
}

function normalizeEndpoint(input) {
  let endpoint = String(input || '').trim();
  if (/^\d+$/.test(endpoint)) endpoint = `127.0.0.1:${endpoint}`;
  const match = /^(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:]+\]):([1-9][0-9]{0,4})$/.exec(endpoint);
  if (!match || Number(match[1]) > 65535) {
    const error = new Error('請輸入有效的 IP:Port；Port 必須介於 1 到 65535。');
    error.statusCode = 400;
    throw error;
  }
  return endpoint;
}

function readDevices() {
  // Repeated UI requests share one bounded status probe, rather than piling up.
  if (!pendingDevices) pendingDevices = runAdb(['devices', '-l'], DEADLINES.status)
    .finally(() => { pendingDevices = null; });
  return pendingDevices;
}

module.exports = { DEADLINES, adbExecutable, runAdb, connectedDevice, normalizeEndpoint, readDevices };
