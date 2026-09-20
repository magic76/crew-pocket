const http = require('node:http');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const url = require('node:url');
const crypto = require('node:crypto');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const RUNTIME_HOME = path.resolve(process.env.HOME || '/data/data/com.termux/files/home');
const REUSABLE_TOOL_DIR = process.env.CREW_REUSABLE_TOOL_DIR || path.join(__dirname, 'public', 'extra');

const {
  PORT,
  HOST,
  PUBLIC_DIR,
  LEGACY_UPLOADS_DIR,
  PREVIOUS_UPLOADS_DIR,
  UPLOADS_DIR,
  BRAIN_DIR,
  MIME_TYPES,
  THINKING_EFFORTS,
  parseJsonBody
} = require('./lib/config');

const { sessionManager } = require('./lib/session');
const { getProvider, normalizeProviderId, listProviders, listProviderMetadata } = require('./lib/providers');
const { handleLiveSync, handleLiveTranscribe, handleQuickTranscribe } = require('./lib/history');
const { generateCompactedSummary, buildCompactionSource } = require('./lib/compact');
const { handleRunCode } = require('./lib/sandbox');
const { handleUsage } = require('./lib/usage');
const { handleListFiles, handleReadFile, handleSaveFile, handleDeleteFile, handleTransferFile } = require('./lib/files');
const { handleListPublicAssets } = require('./lib/public-assets');
const { createExtensionBridge } = require('./lib/extension_bridge');
const { getStorageReport, deleteMediaItems, getMediaThumbnail } = require('./lib/storage');
const { getConversationSettings, getProviderConversationSettings, saveConversationSettings, saveConversationTitle, deleteConversationSettings } = require('./lib/conversation-settings');
const { createTask, getTask, listTasks, updateTask } = require('./lib/tasks');
const { listWorkspaces, resolveWorkspace, createWorkspace } = require('./lib/workspaces');
const auth = require('./lib/auth');
const { applyCors, authorizeApiRequest, maybeSetAuthCookie, securityStatus, getApiToken, isLoopbackAddress } = require('./lib/http-security');
const { createHistoryMigration } = require('./lib/runtime/history-migration');
const { getProviderRuntimeStatus, updateProvider } = require('./lib/runtime/provider-manager');
const { resolveExecutionPolicy } = require('./lib/execution-policy');
const { getJevCliStatus, looksLikeContinuation, reviewExecutionIntentWithJev, routeTaskWithJev, shouldRouteWithJev } = require('./lib/jev-router');
const { buildApprovedIntent, normalizeExecutionIntent, policyConflicts, shouldCreateExecutionIntent } = require('./lib/execution-intent');
const { reviewSoftBudgetWithJev, reviewToolFailureWithJev, sanitizeText: sanitizeRuntimeDecisionText, shouldUseRuntimeSnapshots } = require('./lib/runtime-decision');


async function handleStorageReport(res) {
  try {
    const report = await getStorageReport();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(report));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleStorageDelete(req, res) {
  try {
    const body = await parseJsonBody(req);
    const result = await deleteMediaItems(body.items);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...result }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleStorageThumbnail(parsedUrl, res) {
  try {
    const image = await getMediaThumbnail({ root: parsedUrl.query.root, path: parsedUrl.query.path });
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=86400' });
    res.end(image);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('HEIC thumbnail unavailable');
  }
}

// 🔌 Central ADB Wireless Debugging Handlers (~/.adb_port)
const ADB_PORT_FILE = path.join(os.homedir(), '.adb_port');
const ADB_RESULT_FILE = path.join(os.homedir(), '.crew-pocket', 'adb-last-result');

async function handleAdbStatus(res) {
  try {
    let target = '';
    let lastOutput = '';
    try {
      target = (await fsPromises.readFile(ADB_PORT_FILE, 'utf-8')).trim();
    } catch (_) {}
    try {
      lastOutput = (await fsPromises.readFile(ADB_RESULT_FILE, 'utf-8')).trim().slice(-2000);
    } catch (_) {}

    let connected = false;
    let devicesOutput = '';
    try {
      const { stdout } = await execFileAsync('adb', ['devices', '-l']);
      devicesOutput = stdout;
      if (target) {
        connected = stdout.includes(target) && stdout.includes('device');
      } else {
        connected = stdout.split('\n').slice(1).some(line => line.includes('device '));
      }
    } catch (_) {}

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ target, connected, devices: devicesOutput.trim(), last_output: lastOutput }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleAdbUpdate(req, res) {
  try {
    const body = await parseJsonBody(req);
    let target = (body.target || body.port || '').toString().trim();
    let pairingTarget = (body.pairing_target || body.pair_target || '').toString().trim();
    const pairingCode = (body.pairing_code || body.pair_code || '').toString().trim();
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Port or target is required' }));
    }
    if (/^\d+$/.test(target)) {
      target = `127.0.0.1:${target}`;
    }
    if (pairingTarget && /^\d+$/.test(pairingTarget)) {
      pairingTarget = `127.0.0.1:${pairingTarget}`;
    }
    const endpointPattern = /^(?:[A-Za-z0-9._-]+|\[[0-9A-Fa-f:]+\]):[1-9][0-9]{0,4}$/;
    if (!endpointPattern.test(target)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Invalid ADB target' }));
    }
    const targetPort = Number(target.slice(target.lastIndexOf(':') + 1));
    if (targetPort > 65535) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Invalid ADB port' }));
    }
    if (pairingTarget || pairingCode) {
      if (!endpointPattern.test(pairingTarget) || !/^\d{6}$/.test(pairingCode)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ success: false, error: 'Pairing target and six-digit pairing code are required' }));
      }
    }
    await fsPromises.writeFile(ADB_PORT_FILE, target + '\n', 'utf-8');

    let connectOutput = '';
    let pairOutput = '';
    let connected = false;
    if (pairingTarget) {
      try {
        const { stdout, stderr } = await execFileAsync('adb', ['pair', pairingTarget, pairingCode]);
        pairOutput = (stdout + '\n' + stderr).trim();
      } catch (e) {
        pairOutput = (e.stdout || '') + '\n' + (e.stderr || e.message || 'pair failed');
        pairOutput = pairOutput.trim();
      }
    }
    try {
      const { stdout, stderr } = await execFileAsync('adb', ['connect', target]);
      connectOutput = (stdout + '\n' + stderr).trim();
      const devices = await execFileAsync('adb', ['devices', '-l']);
      connected = devices.stdout.includes(target) && devices.stdout.includes('device');
    } catch (e) {
      connectOutput = e.message;
    }

    await fsPromises.mkdir(path.dirname(ADB_RESULT_FILE), { recursive: true });
    const resultLines = [];
    if (pairOutput) resultLines.push(`pair: ${pairOutput}`);
    if (connectOutput) resultLines.push(`connect: ${connectOutput}`);
    await fsPromises.writeFile(ADB_RESULT_FILE, resultLines.join('\n') + '\n', 'utf-8');

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      target,
      connected,
      output: connectOutput,
      pair_output: pairOutput
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

// Unified inbound message broker for Browser Extension and other external clients.
const pendingInboundMessages = [];
const inboundEventClients = new Set();
const INBOUND_QUEUE_LIMIT = 50;
let inboundMessageCounter = 0;

function normalizeInboundMessage(body) {
  const text = body && (body.text || body.message || body.prompt);
  if (!text || !String(text).trim()) return null;

  const receivedAt = Date.now();
  const message = {
    id: `inbound_${receivedAt.toString(36)}_${(++inboundMessageCounter).toString(36)}`,
    source: String(body.source || 'External').slice(0, 48),
    text: String(text),
    created_at: Number(body.created_at || body.timestamp) || receivedAt,
    received_at: receivedAt
  };

  for (const key of ['image_path', 'url', 'title', 'lastError']) {
    if (typeof body[key] === 'string' && body[key]) message[key] = body[key];
  }
  return message;
}

async function storeInboundImage(body) {
  const encoded = typeof body?.image_base64 === 'string' ? body.image_base64.trim() : '';
  if (!encoded) return;
  if (encoded.length > 12 * 1024 * 1024) throw new Error('圖片資料過大');
  const image = Buffer.from(encoded, 'base64');
  if (image.length === 0 || image.length > 8 * 1024 * 1024) throw new Error('圖片資料無效或過大');
  await fsPromises.mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `helper_${Date.now()}_${crypto.randomUUID().slice(0, 8)}.jpg`;
  await fsPromises.writeFile(path.join(UPLOADS_DIR, filename), image, { mode: 0o600 });
  body.image_path = `/uploads/${filename}`;
  delete body.image_base64;
}

function writeInboundEvent(res, message) {
  res.write(`id: ${message.id}\nevent: inbound-message\ndata: ${JSON.stringify(message)}\n\n`);
}

function enqueueInboundMessage(body) {
  const message = normalizeInboundMessage(body);
  if (!message) return null;

  let delivered = 0;
  for (const client of inboundEventClients) {
    try {
      writeInboundEvent(client, message);
      delivered++;
    } catch (_) {
      inboundEventClients.delete(client);
    }
  }

  if (delivered === 0) {
    pendingInboundMessages.push(message);
    if (pendingInboundMessages.length > INBOUND_QUEUE_LIMIT) pendingInboundMessages.shift();
  }
  return message;
}

function handleInboundEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  });
  res.write('retry: 5000\n\n');
  inboundEventClients.add(res);
  while (pendingInboundMessages.length > 0) writeInboundEvent(res, pendingInboundMessages.shift());

  const keepAlive = setInterval(() => {
    try { res.write(`: keepalive ${Date.now()}\n\n`); } catch (_) {}
  }, 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    inboundEventClients.delete(res);
  });
}

async function handleInboundMessage(req, res) {
  try {
    const body = await parseJsonBody(req);
    await storeInboundImage(body);
    const message = enqueueInboundMessage(body);
    if (!message) throw new Error('訊息不可為空');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      id: message.id,
      delivered: inboundEventClients.size > 0,
      pending: pendingInboundMessages.length
    }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

const extensionBridge = createExtensionBridge({ onInboundMessage: enqueueInboundMessage });

// 📦 Export / Copy Browser Extension to custom location
async function handleExportExtension(req, res) {
  try {
    const { execSync } = require('node:child_process');
    const body = await parseJsonBody(req);
    const targetDir = body.targetDir || '/sdcard/crew-pocket-extension';
    const sourceDir = path.join(__dirname, 'extensions', 'crew-pocket-bridge');

    await fsPromises.mkdir(targetDir, { recursive: true });

    // Dynamic repack of all latest files and icons
    const zipScript = `python3 -c "
import zipfile, os
src = '${sourceDir}'
tgt = '${targetDir}'
files = [f for f in os.listdir(src) if not f.endswith('.zip') and not f.endswith('.log') and os.path.isfile(os.path.join(src, f))]
for d in [src, tgt]:
    with zipfile.ZipFile(os.path.join(d, 'crew-pocket-bridge.zip'), 'w') as z:
        for f in files:
            z.write(os.path.join(src, f), arcname=f)
"`;
    try { execSync(zipScript); } catch (e) {}

    const files = await fsPromises.readdir(sourceDir);
    for (const f of files) {
      await fsPromises.copyFile(path.join(sourceDir, f), path.join(targetDir, f));
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, targetDir, filesCount: files.length }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

// 🤖 List Available Models & Thinking Efforts
async function handleGetModels(res) {
  const discoverModels = async (provider) => {
    if (!provider.metadata.capabilities.models || typeof provider.listModels !== 'function') return [];
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('model discovery timed out')), 2000));
    try { return await Promise.race([provider.listModels(), timeout]); }
    catch (err) {
      console.warn(`[${provider.id} Models] Discovery failed:`, err.message);
      return provider.fallbackModels || [];
    }
  };
  const modelGroups = await Promise.all(listProviders().map(discoverModels));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ models: modelGroups.flat(), efforts: THINKING_EFFORTS }));
}

function handleGetProviders(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ providers: listProviderMetadata() }));
}

async function handleRuntimeStatus(res) {
  try {
    const providerRuntime = await getProviderRuntimeStatus();
    const host = {
      runtime: 'termux-node',
      pid: process.pid,
      home: RUNTIME_HOME,
      updateModel: 'provider-managed'
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ host, providers: providerRuntime.providers }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleRuntimeProviders(req, res) {
  try {
    if (req.method === 'GET') {
      const status = await getProviderRuntimeStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(status));
    }

    const body = await parseJsonBody(req);
    const providerId = body?.provider === 'agy' ? 'antigravity' : body?.provider;
    if (!['codex', 'antigravity'].includes(providerId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'provider must be codex or antigravity' }));
    }

    if (providerId === 'codex') {
      const codex = getProvider('codex');
      if (typeof codex.shutdownRuntime === 'function') {
        await Promise.resolve(codex.shutdownRuntime()).catch(() => {});
      } else {
        await Promise.resolve(codex.stop(null)).catch(() => {});
      }
    } else {
      await Promise.resolve(getProvider('antigravity').stop()).catch(() => {});
    }

    const result = await updateProvider(providerId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...result }));
  } catch (err) {
    const details = String(err.stderr || err.stdout || err.message || err).trim();
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: false,
      error: err.message || 'Provider update failed',
      details: details.slice(-8000)
    }));
  }
}

const historyMigration = process.env.CREW_HISTORY_IMPORT_TOKEN
  ? createHistoryMigration({ homeDir: RUNTIME_HOME, token: process.env.CREW_HISTORY_IMPORT_TOKEN })
  : null;

const runtimeSelfDebug = {
  status: 'idle',
  startedAt: null,
  completedAt: null,
  response: '',
  error: '',
  reason: ''
};

function launchRuntimeSelfDebug(reason = 'Embedded Node runtime failure') {
  if (runtimeSelfDebug.status === 'running') return false;

  const provider = getProvider('codex');
  runtimeSelfDebug.status = 'running';
  runtimeSelfDebug.startedAt = Date.now();
  runtimeSelfDebug.completedAt = null;
  runtimeSelfDebug.response = '';
  runtimeSelfDebug.error = '';
  runtimeSelfDebug.reason = String(reason || 'Embedded Node runtime failure').slice(0, 1200);

  const prompt = `[Crew Pocket Autonomous Self-Debug]

The Android Runtime Supervisor detected an Embedded Node failure and temporarily switched to the Termux rescue host.

Failure reason:
${runtimeSelfDebug.reason}

You are repairing Crew Pocket itself. Your cwd is mapped to the APK-private agy-web workspace.

Required procedure:
1. Read .crew-runtime/state.json.
2. Read the end of .crew-runtime/node.log.
3. Identify the concrete startup/runtime failure.
4. Apply the smallest safe source fix in the current workspace.
5. Do not start server.js yourself.
6. Do not delete or rewrite .crew-runtime.
7. Do not git reset, checkout, or discard unrelated changes.
8. Finish after the patch. Android Runtime Supervisor will detect the source fingerprint change and automatically restart + health-check Embedded Node.

If the failure is caused by a missing native runtime dependency that cannot be fixed in JS, do not invent a workaround. Explain the exact missing dependency in your final response and leave source unchanged.`;

  Promise.resolve(provider.startTurn({
    conversationId: null,
    model: undefined,
    effort: 'high',
    workspace: process.env.HOME || RUNTIME_HOME,
    prompt,
    onAbort() {},
    onEvent(event) {
      if (!event) return;
      if (event.type === 'text_delta') {
        runtimeSelfDebug.response = String(event.accumulated || `${runtimeSelfDebug.response}${event.delta || ''}`).slice(-12000);
      } else if (event.type === 'error') {
        runtimeSelfDebug.status = 'failed';
        runtimeSelfDebug.error = String(event.message || 'Self-debug failed').slice(0, 4000);
        runtimeSelfDebug.completedAt = Date.now();
      } else if (event.type === 'turn_completed') {
        runtimeSelfDebug.status = 'completed';
        runtimeSelfDebug.response = String(event.response || runtimeSelfDebug.response || '').slice(-12000);
        runtimeSelfDebug.completedAt = Date.now();
      }
    }
  })).catch(error => {
    runtimeSelfDebug.status = 'failed';
    runtimeSelfDebug.error = String(error?.message || error || 'Self-debug failed').slice(0, 4000);
    runtimeSelfDebug.completedAt = Date.now();
  });

  return true;
}

async function handleRuntimeSelfDebug(req, res) {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(runtimeSelfDebug));
  }

  try {
    const body = await parseJsonBody(req).catch(() => ({}));
    const started = launchRuntimeSelfDebug(body?.reason);
    res.writeHead(started ? 202 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ started, ...runtimeSelfDebug }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// ⚡ Check Conversation Session Busy Status
function handleSessionStatus(parsedUrl, res) {
  const convId = parsedUrl.query.id;
  if (!convId) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Missing convId' }));
  }
  const providerId = normalizeProviderId(parsedUrl.query.provider);
  const status = getProvider(providerId).getStatus(convId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ...status, provider: providerId }));
}

const LIVE_DELEGATE_TIMEOUT_MS = 60000;
const LIVE_DELEGATE_JOB_TTL_MS = 5 * 60 * 1000;
const liveDelegateJobs = new Map();

function liveDelegateError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function runLiveDelegatedTurn({ providerId, conversationId, model, effort, task, onAbortReady }) {
  const provider = getProvider(providerId);
  const status = provider.getStatus(conversationId);
  if (status && status.isBusy) {
    throw liveDelegateError('主對話正在處理另一個任務，請稍候再交辦。', 409);
  }

  const delegationPrompt = `[🎙️ Live 已確認委派]\n${task}\n\n【回覆規則】這是使用者透過 Live 語音確認後交辦給你的任務。請自行使用你原有且必要的工具完成它；不要把任務委派回 Live，不要要求 Live 執行工具。完成後只回傳可直接口語報告的精簡結論，以及必要的關鍵證據或下一步。`;

  return new Promise((resolve, reject) => {
    let settled = false;
    let abortTurn = () => {};
    let streamedResponse = '';
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback(value);
    };
    const timeout = setTimeout(() => {
      try { abortTurn(); } catch (_) {}
      finish(reject, liveDelegateError('主對話逾時未完成，任務已停止。', 504));
    }, LIVE_DELEGATE_TIMEOUT_MS);

    Promise.resolve(provider.startTurn({
      conversationId,
      model,
      effort: effort || 'low',
      prompt: delegationPrompt,
      onAbort(handler) {
        abortTurn = typeof handler === 'function' ? handler : abortTurn;
        if (typeof onAbortReady === 'function') onAbortReady(abortTurn);
      },
      onEvent(event) {
        if (settled || !event) return;
        if (event.type === 'text_delta') {
          streamedResponse = event.accumulated || `${streamedResponse}${event.delta || ''}`;
        } else if (event.type === 'error') {
          finish(reject, liveDelegateError(event.message || '主對話執行失敗。', 502));
        } else if (event.type === 'turn_completed') {
          finish(resolve, {
            conversationId: event.conversationId || conversationId,
            response: String(event.response || streamedResponse || '').trim(),
            status: event.status || 'completed'
          });
        }
      }
    })).catch(error => finish(reject, error));
  });
}

async function launchLiveDelegateJob(taskRecord) {
  const existingJob = liveDelegateJobs.get(taskRecord.id);
  if (existingJob && existingJob.status === 'running') return existingJob;
  const providerId = normalizeProviderId(taskRecord.provider);
  const status = getProvider(providerId).getStatus(taskRecord.conversationId);
  if (status && status.isBusy) throw liveDelegateError('主對話正在處理另一個任務，請稍候再交辦。', 409);

  const job = {
    id: taskRecord.id,
    status: 'running',
    provider: providerId,
    conversationId: taskRecord.conversationId,
    createdAt: Date.now(),
    abort: null
  };
  liveDelegateJobs.set(job.id, job);
  await updateTask(job.id, { status: 'running', error: '', result: '' }, { type: 'running', message: '主對話正在背景處理。' });
  runLiveDelegatedTurn({
    providerId,
    conversationId: taskRecord.conversationId,
    model: taskRecord.model,
    effort: taskRecord.effort,
    task: taskRecord.task,
    onAbortReady(abort) {
      job.abort = abort;
      if (job.cancelled) abort();
    }
  }).then(async result => {
    const latest = await getTask(job.id);
    if (latest?.status === 'cancelled') return;
    job.status = 'completed';
    job.conversationId = result.conversationId;
    job.reply = result.response.slice(0, 7000);
    await updateTask(job.id, {
      status: 'completed',
      conversationId: result.conversationId,
      result: job.reply,
      error: ''
    }, { type: 'completed', message: '主對話已完成任務。' });
  }).catch(async error => {
    const latest = await getTask(job.id);
    if (latest?.status === 'cancelled') return;
    job.status = 'failed';
    job.error = error.message || '主對話委派失敗';
    await updateTask(job.id, { status: 'failed', error: job.error }, { type: 'failed', message: job.error });
  }).finally(() => setTimeout(() => liveDelegateJobs.delete(job.id), LIVE_DELEGATE_JOB_TTL_MS));
  return job;
}

async function resolveTaskConversationTitle(providerId, conversationId, providedTitle = '') {
  const explicit = String(providedTitle || '').trim().slice(0, 160);
  if (explicit) return explicit;

  try {
    const settings = await getConversationSettings(providerId, conversationId);
    if (settings?.title) return String(settings.title).trim().slice(0, 160);
  } catch (_) {}

  try {
    const provider = getProvider(providerId);
    if (provider.metadata.capabilities.history && typeof provider.listConversations === 'function') {
      const conversations = await provider.listConversations();
      const match = conversations.find(item => item.id === conversationId);
      if (match?.title) return String(match.title).trim().slice(0, 160);
    }
  } catch (_) {}

  return conversationId ? `對話 ${conversationId.slice(0, 8)}` : '未知對話';
}

async function handleLiveDelegate(req, res) {
  try {
    const body = await parseJsonBody(req);
    const providerId = normalizeProviderId(body.provider);
    const conversationId = String(body.conversation_id || '').trim();
    const task = String(body.task || '').trim();
    if (!conversationId || !/^[a-zA-Z0-9_-]+$/.test(conversationId)) {
      throw liveDelegateError('找不到目前主對話，請先在主聊天開啟或建立一個對話。', 400);
    }
    if (!task || task.length > 5000) {
      throw liveDelegateError('交辦內容不可為空，且最多 5000 字。', 400);
    }

    const requestedTaskId = String(body.task_id || '').trim();
    let taskRecord = requestedTaskId ? await getTask(requestedTaskId) : null;
    if (requestedTaskId && !taskRecord) throw liveDelegateError('找不到待交辦任務，請重新建立。', 404);
    if (taskRecord && taskRecord.status === 'running') throw liveDelegateError('這個任務已在背景處理。', 409);
    if (taskRecord && taskRecord.status === 'completed') throw liveDelegateError('這個任務已完成。', 409);
    if (taskRecord && taskRecord.status === 'cancelled') throw liveDelegateError('這個任務已取消，請重新建立。', 409);
    const conversationTitle = await resolveTaskConversationTitle(
      providerId,
      conversationId,
      body.conversation_title || taskRecord?.conversationTitle
    );
    if (!taskRecord) {
      taskRecord = await createTask({
        source: 'live', provider: providerId, conversationId, conversationTitle, model: body.model,
        effort: body.effort, task, status: 'pending_confirmation',
        event: 'Live 已確認交辦，等待主對話接手。'
      });
    }
    taskRecord = await updateTask(taskRecord.id, {
      provider: providerId, conversationId, conversationTitle, model: body.model || taskRecord.model,
      effort: body.effort || taskRecord.effort, status: 'pending_confirmation'
    }) || taskRecord;
    const job = await launchLiveDelegateJob(taskRecord);

    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      accepted: true,
      job_id: job.id,
      task_id: taskRecord.id,
      provider: providerId,
      conversation_id: conversationId,
      status: 'running'
    }));
  } catch (err) {
    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message || '主對話委派失敗' }));
  }
}

async function handleLiveDelegateStatus(parsedUrl, res) {
  const jobId = String(parsedUrl.query.job_id || '').trim();
  const job = liveDelegateJobs.get(jobId);
  const task = await getTask(jobId);
  if (!job && !task) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: '委派工作不存在或已過期。' }));
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    success: true,
    job_id: job?.id || task.id,
    status: task?.status || job.status,
    provider: task?.provider || job.provider,
    conversation_id: task?.conversationId || job.conversationId,
    conversation_title: task?.conversationTitle || undefined,
    task_id: task?.id || job.id,
    task_title: task?.title || undefined,
    task: task?.task || undefined,
    reply: (task?.status || job.status) === 'completed' ? (task?.result || job.reply) : undefined,
    error: (task?.status || job.status) === 'failed' ? (task?.error || job.error) : undefined
  }));
}

async function handleTasks(req, res, parsedUrl) {
  try {
    if (req.method === 'GET') {
      const tasks = await listTasks(parsedUrl.query.limit);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, tasks }));
    }
    const body = await parseJsonBody(req);
    const action = String(body.action || '').trim();
    const taskId = String(body.task_id || '').trim();
    if (action === 'create') {
      const task = String(body.task || '').trim();
      const conversationId = String(body.conversation_id || '').trim();
      if (!task || !conversationId) throw liveDelegateError('任務內容與主對話不可為空。', 400);
      const providerId = normalizeProviderId(body.provider);
      const conversationTitle = await resolveTaskConversationTitle(providerId, conversationId, body.conversation_title);
      const record = await createTask({
        source: body.source || 'main_chat', provider: providerId, conversationId, conversationTitle,
        model: body.model, effort: body.effort, task, status: 'pending_confirmation'
      });
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, task: record }));
    }
    const record = await getTask(taskId);
    if (!record) throw liveDelegateError('找不到任務。', 404);
    if (action === 'update') {
      if (record.status !== 'pending_confirmation') {
        throw liveDelegateError('只有等待確認中的任務可以修改。', 409);
      }
      const nextTask = String(body.task || '').trim();
      if (!nextTask) throw liveDelegateError('任務內容不可為空。', 400);
      const updated = await updateTask(
        taskId,
        { task: nextTask, title: String(body.title || '').trim() || nextTask.split(/\r?\n/)[0].slice(0, 160) },
        { type: 'updated', message: 'Live 已更新待交辦內容。' }
      );
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, task: updated }));
    }
    if (action === 'cancel') {
      const job = liveDelegateJobs.get(taskId);
      if (job) {
        job.cancelled = true;
        job.status = 'cancelled';
      }
      if (job?.abort) job.abort();
      const task = await updateTask(taskId, { status: 'cancelled' }, { type: 'cancelled', message: '使用者已取消任務。' });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, task }));
    }
    if (action === 'retry') {
      if (!['failed', 'cancelled'].includes(record.status)) throw liveDelegateError('只有失敗或已取消的任務可以重試。', 409);
      const prepared = await updateTask(taskId, { status: 'pending_confirmation', error: '', result: '' }, { type: 'retry', message: '正在重新交辦主對話。' });
      const job = await launchLiveDelegateJob(prepared);
      res.writeHead(202, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, accepted: true, task_id: prepared.id, job_id: job.id }));
    }
    throw liveDelegateError('不支援的任務操作。', 400);
  } catch (err) {
    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message || '任務操作失敗。' }));
  }
}

async function handleProviderConversations(parsedUrl, res) {
  const providerId = normalizeProviderId(parsedUrl.query.provider);
  try {
    const provider = getProvider(providerId);
    if (!provider.metadata.capabilities.history || typeof provider.listConversations !== 'function') throw new Error('Provider does not support conversation history');
    const [conversations, settingsByConversation] = await Promise.all([
      provider.listConversations(),
      getProviderConversationSettings(providerId)
    ]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ conversations: conversations.map(conversation => ({
      ...conversation,
      workspace: settingsByConversation.get(conversation.id)?.workspace || null,
      role: settingsByConversation.get(conversation.id)?.role || 'general',
      model: settingsByConversation.get(conversation.id)?.model || null,
      effort: settingsByConversation.get(conversation.id)?.effort || null
    })) }));
  } catch (err) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, conversations: [] }));
  }
}

async function handleProviderCompact(req, res, forcedProviderId = null) {
  try {
    const body = await parseJsonBody(req);
    const providerId = normalizeProviderId(forcedProviderId || body.provider);
    if (!body.conversation_id || !/^[a-zA-Z0-9_-]+$/.test(body.conversation_id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid conversation_id' }));
    }
    const provider = getProvider(providerId);
    if (!provider.metadata.capabilities.compact || typeof provider.compactConversation !== 'function') throw new Error('Provider does not support conversation compaction');
    const result = await provider.compactConversation(body.conversation_id, {
      focus: body.focus,
      mode: body.mode === 'max' ? 'max' : 'continue',
      locale: body.locale === 'en' ? 'en' : 'zh-TW'
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      provider: providerId,
      conversation_id: result.conversationId || body.conversation_id,
      summary: result.summary,
      message: result.message,
      context_verification: result.contextVerification || null
    }));
  } catch (err) {
    console.error('[Provider Compact Error]', err);
    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || '對話壓縮失敗' }));
  }
}

// Create only the compact handoff needed for a fresh Codex thread. The source
// thread is never changed or deleted, so its complete history stays available.
async function handleCodexContinuationSummary(req, res) {
  try {
    const body = await parseJsonBody(req);
    const conversationId = String(body.conversation_id || '');
    if (!conversationId || !/^[a-zA-Z0-9_-]+$/.test(conversationId)) throw new Error('Invalid conversation_id');

    const provider = getProvider('codex');
    const history = await provider.getHistory(conversationId);
    const segments = (history.messages || []).flatMap(message => {
      const content = String(message.content || '').trim();
      return content ? [`${message.role === 'user' ? 'User' : 'Assistant'}: ${content}`] : [];
    });
    if (segments.length < 2) throw new Error('尚無足夠對話可建立續接摘要');

    const locale = body.locale === 'en' ? 'en' : 'zh-TW';
    const source = buildCompactionSource(segments, 24000);
    const summary = await generateCompactedSummary(source, String(body.focus || ''), locale, 'continue');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, source_conversation_id: conversationId, source_title: history.title || '', summary }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message || '無法建立續接摘要' }));
  }
}

async function handleProviderHistory(parsedUrl, res) {
  const providerId = normalizeProviderId(parsedUrl.query.provider);
  try {
    const provider = getProvider(providerId);
    if (!provider.metadata.capabilities.history || typeof provider.getHistory !== 'function') throw new Error('Provider does not support conversation history');
    const history = await provider.getHistory(parsedUrl.query.id);
    const conversationSettings = await getConversationSettings(providerId, parsedUrl.query.id);
    if (Array.isArray(history.messages)) {
      history.messages = history.messages.map(message => message.role === 'user'
        ? { ...message, content: stripLegacyLanguageInstruction(message.content) }
        : message);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ...history, conversation_settings: conversationSettings }));
  } catch (err) {
    res.writeHead(err.statusCode || 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleProviderDelete(parsedUrl, res) {
  const providerId = normalizeProviderId(parsedUrl.query.provider);
  try {
    const conversationId = parsedUrl.query.id;
    if (!conversationId || !/^[a-zA-Z0-9_-]+$/.test(conversationId)) {
      const error = new Error('Invalid conversation id');
      error.statusCode = 400;
      throw error;
    }
    const provider = getProvider(providerId);
    if (!provider.metadata.capabilities.delete || typeof provider.deleteConversation !== 'function') throw new Error('Provider does not support deleting conversations');
    const result = await provider.deleteConversation(conversationId);
    await deleteConversationSettings(providerId, conversationId).catch(() => {});
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      id: conversationId,
      provider: providerId,
      localDataDeleted: result?.localDataDeleted !== false,
      storageFreedBytes: Number.isFinite(result?.storageFreedBytes) ? result.storageFreedBytes : null
    }));
  } catch (err) {
    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleConversationSettings(req, res) {
  try {
    const body = await parseJsonBody(req);
    const providerId = normalizeProviderId(body.provider);
    const previous = await getConversationSettings(providerId, body.conversation_id);
    const targetWorkspace = body.workspace || previous?.workspace;
    const workspace = targetWorkspace ? await resolveWorkspace(targetWorkspace) : null;
    const settings = await saveConversationSettings(providerId, body.conversation_id, {
      model: body.model || previous?.model || 'gemini-3.7-flash',
      effort: body.effort || previous?.effort || 'low',
      ...(workspace ? { workspace } : {}),
      role: body.role || previous?.role || 'general'
    });
    if (previous?.workspace && workspace && previous.workspace !== workspace && providerId === 'antigravity') {
      sessionManager.closeSession(body.conversation_id);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, conversation_settings: settings }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleWorkspaces(res) {
  try {
    const workspaces = await listWorkspaces();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ workspaces }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleCreateWorkspace(req, res) {
  try {
    const body = await parseJsonBody(req);
    const workspace = await createWorkspace(body.name);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, workspace }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function handleProviderRewind(req, res) {
  try {
    const body = await parseJsonBody(req);
    const providerId = normalizeProviderId(body.provider);
    if (!body.conversation_id || !/^[a-zA-Z0-9_-]+$/.test(body.conversation_id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid conversation id' }));
    }
    const userTurnIndex = Number(body.user_turn_index);
    if (!Number.isInteger(userTurnIndex) || userTurnIndex < 0) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid user turn index' }));
    }
    const provider = getProvider(providerId);
    if (!provider.metadata.capabilities.rewind || typeof provider.rewindConversation !== 'function') throw new Error('Provider does not support conversation rewind');
    const result = await provider.rewindConversation(body.conversation_id, userTurnIndex);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      provider: providerId,
      conversation_id: result.conversationId,
      user_turn_index: userTurnIndex,
      removed_turns: result.removedTurns
    }));
  } catch (err) {
    console.error('[Provider Rewind Error]', err);
    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || '回溯對話失敗' }));
  }
}

// 🖼️ Safe Image Proxy Handler (Directory Whitelisted)
async function handleImageProxy(parsedUrl, res) {
  try {
    const imgPath = parsedUrl.query.path;
    if (!imgPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Image not found');
    }

    const HOME_DIR = RUNTIME_HOME;
    const allowedRoots = [UPLOADS_DIR, BRAIN_DIR, HOME_DIR, '/sdcard', '/storage'];
    const isLegacyUploadPath = [LEGACY_UPLOADS_DIR, PREVIOUS_UPLOADS_DIR]
      .some(root => imgPath.startsWith(`${root}${path.sep}`));
    const requestedPath = isLegacyUploadPath
      ? path.join(UPLOADS_DIR, path.basename(imgPath))
      : imgPath;
    let resolvedPath;
    try {
      // realpath resolves symlinks first, so a permitted-looking path cannot escape via one.
      resolvedPath = await fsPromises.realpath(requestedPath);
    } catch (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Image not found');
    }
    const isAllowed = allowedRoots.some(root => {
      const normalizedRoot = path.resolve(root);
      return resolvedPath === normalizedRoot || resolvedPath.startsWith(`${normalizedRoot}${path.sep}`);
    });

    if (!isAllowed) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('Forbidden');
    }

    const stat = await fsPromises.stat(resolvedPath);
    if (!stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Image not found');
    }

    const ext = path.extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // History cards only need a lightweight preview.  The original is fetched
    // on demand by the lightbox, so long photo-heavy conversations do not
    // decode several full-resolution photos while scrolling.
    const wantsThumbnail = parsedUrl.query.thumbnail === '1';
    const thumbnailable = ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.heif'].includes(ext);
    if (wantsThumbnail && thumbnailable) {
      try {
        const { stdout } = await execFileAsync('magick', [
          resolvedPath,
          '-auto-orient',
          '-thumbnail', '480x480>',
          '-strip',
          '-quality', '78',
          'jpeg:-'
        ], { encoding: 'buffer', maxBuffer: 2 * 1024 * 1024, timeout: 15000 });
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=86400'
        });
        return res.end(stdout);
      } catch (err) {
        // Keep every existing image viewable even if ImageMagick cannot decode
        // a particular source format.
        console.warn('[Image Thumbnail] Falling back to original:', err.message);
      }
    }

    const data = await fsPromises.readFile(resolvedPath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400'
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(err.message);
  }
}

// 📷 Safe Image Upload Handler
async function handleUpload(req, res) {
  try {
    const body = await parseJsonBody(req);
    const { imageBase64, filename } = body;
    if (!imageBase64) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'No image data provided' }));
    }

    const ext = (filename && path.extname(filename)) ? path.extname(filename) : '.jpg';
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const targetName = `photo_${Date.now()}${ext}`;
    const targetPath = path.join(UPLOADS_DIR, targetName);

    await fsPromises.writeFile(targetPath, buffer);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      filePath: targetPath,
      url: `/api/image?path=${encodeURIComponent(targetPath)}`
    }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// Live frames are normally sent browser -> Gemini only. Keep one explicit,
// on-demand frame locally so a delegated main-chat task can inspect the same
// current view without turning Live into a continuous recorder.
async function handleLiveCameraSnapshot(req, res) {
  try {
    const body = await parseJsonBody(req);
    const raw = String(body.imageBase64 || '');
    if (!raw.startsWith('data:image/jpeg;base64,')) throw new Error('Live 相機影像格式無效');
    const buffer = Buffer.from(raw.slice('data:image/jpeg;base64,'.length), 'base64');
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) throw new Error('Live 相機影像大小無效');
    const targetPath = path.join(UPLOADS_DIR, 'live_camera_latest.jpg');
    const tempPath = `${targetPath}.tmp`;
    await fsPromises.writeFile(tempPath, buffer);
    await fsPromises.rename(tempPath, targetPath);
    const capturedAt = String(body.capturedAt || new Date().toISOString());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      captured_at: capturedAt,
      file_path: targetPath,
      url: `/api/image?path=${encodeURIComponent(targetPath)}&v=${Date.now()}`
    }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}




// 🏷️ Crew Pocket capability guidance
// Keep the base prompt small. Detailed delivery constraints are only attached
// to a new conversation when the first request actually needs that capability.
const CREW_POCKET_CAPABILITY_INDEX = '[Crew Pocket：支援互動 HTML、Chart.js 圖表、Google Maps、Android APK 與本機檔案；依使用者需求套用對應規則。]';

const CAPABILITY_RULES = {
  html: `[Crew Pocket Capability Rules]
若建立或更新互動工具，輸出完整、自包含的 \`\`\`html\`\`\`；純 HTML 區塊不得混入說明文字。需要載入本機資產時使用絕對路徑，不用 file://。明確要求可重複使用的本機工具頁時，寫入 ${REUSABLE_TOOL_DIR}/<safe-name>.html。`,
  chart: `[Crew Pocket Capability Rules]
若建立資料圖表，輸出含 Chart.js CDN 與 <canvas id="chart"> 的完整 HTML。獨立向量圖或流程圖使用 SVG 或 Mermaid。`,
  maps: `[Crew Pocket Capability Rules]
提及地點、路線或地圖時，使用 Markdown Google Maps 連結：https://www.google.com/maps/search/?api=1&query=...。`,
  apk: `[Crew Pocket Capability Rules]
建置、安裝或測試 Android APK 時，執行 ~/install-apk.sh <path-to-apk>；若失敗，說明 Wireless Debugging 需重新開啟或設定目前 Port。`
};

function buildCapabilityGuide(userPrompt) {
  const text = String(userPrompt || '').toLowerCase();
  const rules = [];
  if (/(互動|html|網頁|web\s*(?:app|tool|ui)?|小工具|計算機|遊戲|widget|dashboard|儀表板|動畫|animation|preview|預覽)/i.test(text)) rules.push(CAPABILITY_RULES.html);
  if (/(圖表|chart|統計|趨勢|比較|分布|distribution)/i.test(text)) rules.push(CAPABILITY_RULES.chart);
  if (/(地點|地址|餐廳|景點|路線|導航|地圖|google\s*maps?|\bmaps?\b)/i.test(text)) rules.push(CAPABILITY_RULES.maps);
  if (/(\bapk\b|android.{0,24}(?:建置|編譯|安裝|測試|build|install|test)|(?:建置|編譯|安裝|測試|build|install|test).{0,24}android)/i.test(text)) rules.push(CAPABILITY_RULES.apk);
  return `${CREW_POCKET_CAPABILITY_INDEX}${rules.length ? `\n${rules.join('\n')}` : ''}`;
}

function stripLegacyLanguageInstruction(content) {
  if (typeof content !== 'string') return content;
  return content
    .replace(/\[回覆語言：除非使用者明確指定其他語言，請使用自然的繁體中文（台灣）回覆。\]\s*/g, '')
    .replace(/\[Response Language: Reply in clear, natural English unless the user explicitly asks for another language\.\]\s*/g, '');
}

function stableToolSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableToolSerialize).join(',') + ']';
  return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableToolSerialize(value[key])).join(',') + '}';
}

function getServerToolKey(event) {
  const explicit = event.toolGroupId || event.tool_group_id || event.toolId || event.tool_id;
  if (explicit) return 'tool:' + explicit;
  const name = event.name || event.tool_name || 'tool';
  const parameters = event.info && event.info.parameters ? event.info.parameters : {};
  return name + ':' + stableToolSerialize(parameters);
}

function isTerminalToolState(state) {
  return ['completed', 'done', 'failed', 'error', 'cancelled', 'canceled'].includes(String(state || '').toLowerCase());
}

function isFailedToolState(state) {
  return ['failed', 'error'].includes(String(state || '').toLowerCase());
}

function isPollingToolEvent(event) {
  const name = String(event.name || event.tool_name || '').toLowerCase();
  const parameters = stableToolSerialize(event.info && event.info.parameters ? event.info.parameters : {}).toLowerCase();
  return name.includes('write_stdin') || name.includes('poll') || parameters.includes('session_id') || parameters.includes('yield_time_ms');
}

function collectChangedFiles(event, target) {
  if (!target || !(target instanceof Set)) return;
  const name = String(event.name || event.tool_name || '').toLowerCase();
  if (!/(apply|patch|edit|write|change)/.test(name)) return;
  const parameters = event.info && event.info.parameters ? event.info.parameters : {};

  const visit = (value, key = '') => {
    if (typeof value === 'string') {
      if (/(^|_)(path|file|filename)$/.test(String(key).toLowerCase()) && value.trim()) {
        target.add(value.trim());
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [childKey, childValue] of Object.entries(value)) visit(childValue, childKey);
  };

  visit(parameters);
}

// 💬 SSE Chat Streaming with Resident Pipe
async function handleChat(req, res) {
  const requestId = crypto.randomUUID();
  const requestStartedAt = Date.now();
  const turnTiming = {
    body_ms: null,
    workspace_ms: null,
    to_sse_ms: null,
    to_first_event_ms: null,
    to_session_ms: null,
    to_first_text_ms: null,
    to_first_tool_ms: null,
    jev_ms: null,
    intent_ms: null,
    intent_review_ms: null,
    to_done_ms: null
  };
  const elapsed = () => Date.now() - requestStartedAt;
  const markOnce = (key) => {
    if (turnTiming[key] == null) turnTiming[key] = elapsed();
  };

  let body;
  const bodyStartedAt = Date.now();
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
  }
  turnTiming.body_ms = Date.now() - bodyStartedAt;

  const { prompt, conversation_id, image_path, model, effort } = body;
  const providerId = normalizeProviderId(body.provider);
  const explicitExecutionMode =
    body.execution_mode ||
    body.executionMode ||
    body.execution_policy?.mode ||
    body.executionPolicy?.mode ||
    null;
  if (!prompt && !image_path) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Prompt or image is required' }));
  }
  // 🛡️ Resolve workspace:
  // For an existing conversation, lock to the conversation's saved workspace from database,
  // preventing accidental workspace hijacking from stale frontend state.
  const workspaceStartedAt = Date.now();
  let workspace;
  let savedSettings = null;
  try {
    if (conversation_id) {
      savedSettings = await getConversationSettings(providerId, conversation_id);
      if (savedSettings?.workspace) {
        workspace = await resolveWorkspace(savedSettings.workspace);
      } else {
        workspace = await resolveWorkspace(body.workspace);
        // Backfill workspace in settings so this conversation remains locked to it
        saveConversationSettings(providerId, conversation_id, {
          model: model || savedSettings?.model || 'gemini-3.7-flash',
          effort: effort || savedSettings?.effort || 'low',
          workspace,
          role: body.role || savedSettings?.role || 'general'
        }).catch(() => {});
      }
    } else {
      workspace = await resolveWorkspace(body.workspace);
    }
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message }));
  }
  turnTiming.workspace_ms = Date.now() - workspaceStartedAt;

  const effectiveModel = model || savedSettings?.model || null;
  const jevInputSummary = String(prompt || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(["']?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password|authorization)["']?\s*[:=]\s*)[^,\s"']+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/g, '[ENV_REDACTED]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED]')
    .slice(0, 160);
  let routedExecutionMode = explicitExecutionMode;
  let executionSource = explicitExecutionMode ? 'request' : null;
  let jevRoute = null;

  const reusableContinuationMode = providerId === 'codex' &&
    effectiveModel === 'gpt-5.6-luna' &&
    looksLikeContinuation(prompt) &&
    ['SURGICAL_EDIT', 'DEBUG', 'BUILD'].includes(savedSettings?.executionMode)
    ? savedSettings.executionMode
    : null;

  if (!routedExecutionMode && reusableContinuationMode) {
    routedExecutionMode = reusableContinuationMode;
    executionSource = 'conversation';
    jevRoute = {
      accepted: true,
      mode: reusableContinuationMode,
      source: 'conversation',
      reason: 'continuation_reuse',
      confidence: null,
      latencyMs: 0
    };
  } else if (shouldRouteWithJev({
    provider: providerId,
    model: effectiveModel,
    explicitExecutionMode,
    prompt
  })) {
    const jevStartedAt = Date.now();
    jevRoute = await routeTaskWithJev(prompt);
    turnTiming.jev_ms = Date.now() - jevStartedAt;
    if (jevRoute?.mode) {
      routedExecutionMode = jevRoute.mode;
      executionSource = 'jev';
    }
  }

  let executionPolicy = resolveExecutionPolicy({
    provider: providerId,
    model: effectiveModel,
    executionMode: routedExecutionMode,
    executionPolicy: body.execution_policy || body.executionPolicy,
    executionSource
  });

  let executionIntent = null;
  let intentReview = null;
  let approvedExecutionIntent = null;
  const isContinuation = Boolean(reusableContinuationMode);

  if (shouldCreateExecutionIntent({
    provider: providerId,
    model: effectiveModel,
    executionPolicy,
    explicitExecutionMode,
    continuation: isContinuation
  })) {
    const planningProvider = getProvider(providerId);
    if (typeof planningProvider.planExecutionIntent === 'function') {
      try {
        const intentStartedAt = Date.now();
        const rawIntent = await planningProvider.planExecutionIntent({
          model: effectiveModel,
          prompt,
          workspace,
          executionPolicy
        });
        turnTiming.intent_ms = Date.now() - intentStartedAt;
        executionIntent = normalizeExecutionIntent(rawIntent);
        if (executionIntent) {
          const conflicts = policyConflicts(executionIntent, executionPolicy);
          const reviewStartedAt = Date.now();
          intentReview = await reviewExecutionIntentWithJev({
            task: prompt,
            intent: executionIntent,
            currentMode: executionPolicy.mode,
            conflicts
          });
          turnTiming.intent_review_ms = Date.now() - reviewStartedAt;

          if (intentReview?.accepted &&
              intentReview.mode &&
              intentReview.mode !== executionPolicy.mode) {
            routedExecutionMode = intentReview.mode;
            executionSource = 'jev-intent';
            executionPolicy = resolveExecutionPolicy({
              provider: providerId,
              model: effectiveModel,
              executionMode: routedExecutionMode,
              executionPolicy: body.execution_policy || body.executionPolicy,
              executionSource
            });
          }

          approvedExecutionIntent = buildApprovedIntent(
            executionIntent,
            executionPolicy,
            intentReview
          );
        }
      } catch (error) {
        intentReview = {
          accepted: false,
          decision: null,
          mode: executionPolicy?.mode || null,
          reason: 'preflight_error',
          error: String(error.message || error).slice(0, 600)
        };
        console.warn('[ExecutionIntent] preflight skipped:', error.message || error);
      }
    }
  }

  if (executionIntent || intentReview) {
    console.log('[ExecutionIntent] ' + JSON.stringify({
      request_id: requestId,
      conversation_id: conversation_id || null,
      mode_before_review: jevRoute?.mode || routedExecutionMode || null,
      mode_after_review: executionPolicy?.mode || null,
      intent: executionIntent,
      review: intentReview,
      intent_ms: turnTiming.intent_ms,
      review_ms: turnTiming.intent_review_ms
    }));
  }

  if (jevRoute) {
    console.log('[JevRoute] ' + JSON.stringify({
      request_id: requestId,
      conversation_id: conversation_id || null,
      provider: providerId,
      model: effectiveModel,
      accepted: Boolean(jevRoute.accepted),
      mode: jevRoute.mode || null,
      suggested_mode: jevRoute.suggestedMode || null,
      confidence: jevRoute.confidence ?? null,
      threshold: jevRoute.threshold ?? null,
      latency_ms: jevRoute.latencyMs ?? turnTiming.jev_ms,
      reason: jevRoute.reason || null
    }));
  }

  let finalPrompt = prompt || 'Analyze this image';

  // The provider records prompt text as a user turn. Keep continuation text
  // byte-for-byte user-authored so internal capability guidance never appears
  // in conversation history or is mistaken for user input.
  if (!conversation_id) {
    finalPrompt = `${buildCapabilityGuide(finalPrompt)}\n\n[User Request]:\n${finalPrompt}`;
  }

  if (image_path) {
    finalPrompt = `[Uploaded Image: ${image_path}]\n${finalPrompt}`;
  }


  // Set SSE Headers
  const origin = req.headers.origin;
  const allowOrigin = (origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) ? origin : '';
  const headers = {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  };
  if (allowOrigin) headers['Access-Control-Allow-Origin'] = allowOrigin;
  res.writeHead(200, headers);
  markOnce('to_sse_ms');

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const provider = getProvider(providerId);
    const toolRuns = new Map();
    const changedFiles = new Set();
    let toolEventCount = 0;
    let metricsLogged = false;
    let ended = false;
    let abortTurn = () => {};
    let lastContextStats = null;
    let policyWarned = false;
    let policyStopped = false;
    let runtimeStopped = false;
    let softBudgetSnapshotQueued = false;
    let activeConversationId = conversation_id || null;
    const runtimeSnapshotsEnabled = shouldUseRuntimeSnapshots({
      provider: providerId,
      model: effectiveModel
    });
    const runtimeDecisions = [];
    const pendingRuntimeDecisions = new Set();
    let runtimeDecisionQueue = Promise.resolve();

    const getToolMetrics = () => {
      let executions = 0;
      let polls = 0;
      for (const run of toolRuns.values()) {
        executions += run.attempts;
        polls += run.pollCount;
      }
      return {
        events: toolEventCount,
        unique_tools: toolRuns.size,
        executions,
        polls,
        changed_files: [...changedFiles]
      };
    };
    const logToolMetrics = (reason) => {
      if (metricsLogged) return;
      metricsLogged = true;
      console.log('[ToolMetrics] ' + JSON.stringify({
        request_id: requestId,
        provider: providerId,
        conversation_id: conversation_id || null,
        execution_mode: executionPolicy?.mode || null,
        execution_policy_source: executionPolicy?.source || null,
        jev_route: jevRoute ? {
          input_summary: jevInputSummary,
          accepted: Boolean(jevRoute.accepted),
          mode: jevRoute.mode || null,
          suggested_mode: jevRoute.suggestedMode || null,
          confidence: jevRoute.confidence ?? null,
          reason: jevRoute.reason || null,
          latency_ms: jevRoute.latencyMs ?? null
        } : null,
        execution_intent: approvedExecutionIntent,
        intent_review: intentReview,
        runtime_decisions: runtimeDecisions.slice(-8),
        reason,
        elapsed_ms: elapsed(),
        turn_timing: turnTiming,
        context_stats: lastContextStats ? {
          active_tokens: lastContextStats.active_tokens,
          total_tokens: lastContextStats.total_tokens,
          context_window: lastContextStats.context_window,
          status_level: lastContextStats.status_level
        } : null,
        ...getToolMetrics()
      }));
    };
    const recordToolEvent = (event) => {
      const key = getServerToolKey(event);
      const state = String(event.state || '').toLowerCase();
      const existing = toolRuns.get(key);
      const previousState = existing ? existing.lastState : '';
      const run = existing || {
        name: event.name || event.tool_name || 'tool',
        attempts: 1,
        pollCount: 0,
        lastState: '',
        notified: false
      };
      const retryStarted = Boolean(existing && state === 'running' && isTerminalToolState(previousState));
      const polling = isPollingToolEvent(event);
      if (retryStarted) {
        if (polling) run.pollCount += 1;
        else run.attempts += 1;
      }
      run.lastState = state || run.lastState;
      const shouldNotify = !run.notified || (retryStarted && !polling);
      run.notified = true;
      toolRuns.set(key, run);
      toolEventCount += 1;
      collectChangedFiles(event, changedFiles);
      return {
        key,
        attempts: run.attempts,
        pollCount: run.pollCount,
        shouldNotify,
        state,
        previousState,
        failedTransition: isFailedToolState(state) && !isFailedToolState(previousState)
      };
    };
    const finish = (payload) => {
      if (ended) return;
      ended = true;
      markOnce('to_done_ms');
      const finalPayload = {
        ...(payload || {}),
        request_id: requestId,
        tool_metrics: getToolMetrics(),
        execution_policy: executionPolicy || undefined,
        jev_route: jevRoute ? {
          input_summary: jevInputSummary,
          accepted: Boolean(jevRoute.accepted),
          mode: jevRoute.mode || null,
          suggested_mode: jevRoute.suggestedMode || null,
          confidence: jevRoute.confidence ?? null,
          threshold: jevRoute.threshold ?? null,
          reason: jevRoute.reason || null,
          latency_ms: jevRoute.latencyMs ?? null,
          model: jevRoute.model || null
        } : undefined,
        execution_intent: approvedExecutionIntent || undefined,
        intent_review: intentReview || undefined,
        runtime_decisions: runtimeDecisions.length ? runtimeDecisions : undefined,
        turn_timing: turnTiming
      };
      logToolMetrics(finalPayload.error ? 'error' : 'completed');
      sendEvent('done', finalPayload);
      res.end();
    };

    const persistRuntimeMode = () => {
      if (!activeConversationId || !executionPolicy?.mode) return;
      saveConversationSettings(providerId, activeConversationId, {
        model: effectiveModel || model || savedSettings?.model || 'gpt-5.6-luna',
        effort: effort || savedSettings?.effort || 'low',
        workspace,
        role: body.role || savedSettings?.role || 'general',
        executionMode: executionPolicy.mode
      }).catch(error => console.warn('[RuntimeDecision] Save mode failed:', error.message));
    };

    const applyRuntimeEscalation = (targetMode, trigger) => {
      const ranks = { CHAT: 0, INSPECT: 0, SURGICAL_EDIT: 1, DEBUG: 2, BUILD: 3 };
      const currentMode = executionPolicy?.mode || null;
      if (!targetMode || !currentMode) return false;
      if (explicitExecutionMode) return false;
      if ((ranks[targetMode] || 0) <= (ranks[currentMode] || 0)) return false;

      const nextPolicy = resolveExecutionPolicy({
        provider: providerId,
        model: effectiveModel,
        executionMode: targetMode,
        executionPolicy: body.execution_policy || body.executionPolicy,
        executionSource: 'jev-runtime'
      });
      if (!nextPolicy) return false;

      executionPolicy = nextPolicy;
      routedExecutionMode = targetMode;
      executionSource = 'jev-runtime';
      persistRuntimeMode();
      console.log('[RuntimeDecision] policy escalation ' + JSON.stringify({
        request_id: requestId,
        trigger,
        from: currentMode,
        to: targetMode
      }));
      sendEvent('policy', {
        mode: targetMode,
        level: 'escalated',
        source: 'jev-runtime',
        trigger,
        hard_tool_limit: executionPolicy.hardToolExecutions,
        poll_limit: executionPolicy.maxPolls,
        file_limit: executionPolicy.maxFilesChanged
      });
      return true;
    };

    const steerRuntime = async (lines) => {
      if (ended || runtimeStopped || !activeConversationId || typeof provider.steerActiveTurn !== 'function') {
        return { accepted: false, reason: 'not_available' };
      }
      const directive = [
        '<ADDITIONAL_METADATA>',
        '[Crew Runtime Decision Snapshot]',
        'This is internal runtime control, not a new user request.',
        'Continue only the original user task and stay within the current execution policy.',
        ...lines,
        '</ADDITIONAL_METADATA>'
      ].join('\n');
      return provider.steerActiveTurn(activeConversationId, directive);
    };

    const stopForRuntimeDecision = (snapshot, message) => {
      if (ended || runtimeStopped) return;
      runtimeStopped = true;
      policyStopped = true;
      try { abortTurn(); } catch (_) {}
      sendEvent('policy', {
        mode: executionPolicy?.mode || null,
        level: 'runtime-stop',
        source: 'jev-runtime',
        snapshot_type: snapshot?.type || null,
        reason: message
      });
      finish({
        error: message,
        provider: providerId,
        conversation_id: activeConversationId || conversation_id,
        runtime_decision_stop: true
      });
    };

    const applyRuntimeDecision = async (snapshot, trigger) => {
      if (!snapshot) return;
      const record = {
        ...snapshot,
        trigger,
        at: Date.now()
      };
      runtimeDecisions.push(record);
      if (runtimeDecisions.length > 12) runtimeDecisions.splice(0, runtimeDecisions.length - 12);
      console.log('[RuntimeDecision] ' + JSON.stringify({
        request_id: requestId,
        conversation_id: activeConversationId || conversation_id || null,
        ...record
      }));
      sendEvent('decision', record);

      if (!snapshot.ok || ended || runtimeStopped) return;

      if (snapshot.type === 'TOOL_FAILURE') {
        if (snapshot.askUser) {
          return stopForRuntimeDecision(
            snapshot,
            'Crew Runtime paused because this tool failure needs user input, authentication, permission, or an external action before useful work can continue.'
          );
        }
        if (snapshot.shouldStop) {
          return stopForRuntimeDecision(
            snapshot,
            'Crew Runtime stopped this turn because Jev judged that more autonomous tool calls are unlikely to help the original task.'
          );
        }

        let escalated = false;
        if (snapshot.escalation === 'BUILD') {
          escalated = applyRuntimeEscalation('BUILD', trigger);
        } else if (snapshot.escalation === 'DEBUG') {
          escalated = applyRuntimeEscalation('DEBUG', trigger);
        }

        const directive = [];
        if (!snapshot.retrySame) {
          directive.push('Do not retry essentially the same failed tool/action with the same approach.');
        }
        if (snapshot.tryAlternative) {
          directive.push('Use a meaningfully different, narrower approach based on the failure evidence already available.');
        }
        if (!snapshot.taskOnTrack) {
          directive.push('Re-anchor on the original user goal before taking another tool action; drop unrelated exploration.');
        }
        if (snapshot.stuckRisk === 'HIGH') {
          directive.push('High loop risk: avoid repeated probing and use the minimum additional tools needed to resolve or report the blocker.');
        }
        if (escalated) {
          directive.push(`Runtime approved escalation to ${executionPolicy.mode}; use the broader budget only for work required by the original task.`);
        }
        if (directive.length) await steerRuntime(directive);
        return;
      }

      if (snapshot.type === 'SOFT_BUDGET') {
        if (snapshot.askUser) {
          return stopForRuntimeDecision(
            snapshot,
            'Crew Runtime paused at the soft budget because useful continuation requires user input or an external action.'
          );
        }
        if (snapshot.action === 'STOP') {
          return stopForRuntimeDecision(
            snapshot,
            'Crew Runtime stopped at the soft budget because the current autonomous path is unlikely to finish the original task efficiently.'
          );
        }

        let escalated = false;
        if (snapshot.action === 'ESCALATE_BUILD') {
          escalated = applyRuntimeEscalation('BUILD', trigger);
        } else if (snapshot.action === 'ESCALATE_DEBUG') {
          escalated = applyRuntimeEscalation('DEBUG', trigger);
        }

        const directive = [];
        if (snapshot.action === 'CHANGE_APPROACH') {
          directive.push('Stop broad or repeated exploration. Reassess the evidence already collected and switch to a narrower different approach.');
        }
        if (snapshot.stuckRisk === 'HIGH') {
          directive.push('High loop risk: do not spend the remaining budget on repeated checks or unrelated improvements.');
        }
        if (!snapshot.finishWithinHardBudget) {
          directive.push('The remaining hard budget is tight. Prioritize the minimum path to the requested result or clearly report the blocker.');
        }
        if (escalated) {
          directive.push(`Runtime approved escalation to ${executionPolicy.mode}; do not use it for unrelated scope.`);
        }
        if (directive.length) await steerRuntime(directive);
      }
    };

    const queueRuntimeDecision = (trigger, runner) => {
      const promise = runtimeDecisionQueue
        .catch(() => {})
        .then(async () => {
          if (ended || runtimeStopped) return null;
          try {
            const snapshot = await runner();
            await applyRuntimeDecision(snapshot, trigger);
            return snapshot;
          } catch (error) {
            const snapshot = {
              type: trigger,
              ok: false,
              reason: 'snapshot_error',
              error: String(error.message || error).slice(0, 600)
            };
            await applyRuntimeDecision(snapshot, trigger);
            return snapshot;
          }
        });
      runtimeDecisionQueue = promise;
      pendingRuntimeDecisions.add(promise);
      promise.finally(() => pendingRuntimeDecisions.delete(promise));
      return promise;
    };

    const queueToolFailureDecision = (event, tracking) => {
      if (!runtimeSnapshotsEnabled || !executionPolicy || !tracking.failedTransition || ended || runtimeStopped) return;
      const parameters = event.info?.parameters || {};
      const output = event.info?.output;
      queueRuntimeDecision('tool_failure', () => reviewToolFailureWithJev({
        task: prompt,
        mode: executionPolicy?.mode,
        tool: {
          name: event.name || event.tool_name || 'tool',
          state: tracking.state,
          attempts: tracking.attempts,
          parameters: sanitizeRuntimeDecisionText(stableToolSerialize(parameters), 1400),
          output: sanitizeRuntimeDecisionText(
            stableToolSerialize({
              output: typeof output === 'string' ? output : (output || null),
              exitCode: event.info?.exitCode ?? null,
              error: event.info?.error ?? null
            }),
            2200
          )
        },
        metrics: getToolMetrics(),
        intent: approvedExecutionIntent
      }));
    };

    const queueSoftBudgetDecision = () => {
      if (!runtimeSnapshotsEnabled || !executionPolicy || softBudgetSnapshotQueued || ended || runtimeStopped) return;
      softBudgetSnapshotQueued = true;
      queueRuntimeDecision('soft_budget', () => reviewSoftBudgetWithJev({
        task: prompt,
        mode: executionPolicy?.mode,
        metrics: getToolMetrics(),
        policy: {
          mode: executionPolicy.mode,
          softToolExecutions: executionPolicy.softToolExecutions,
          hardToolExecutions: executionPolicy.hardToolExecutions,
          maxPolls: executionPolicy.maxPolls,
          maxFilesChanged: executionPolicy.maxFilesChanged,
          allowBuild: executionPolicy.allowBuild,
          allowDependencyChanges: executionPolicy.allowDependencyChanges
        },
        intent: approvedExecutionIntent,
        recentFailures: runtimeDecisions
          .filter(item => item.type === 'TOOL_FAILURE')
          .slice(-3)
          .map(item => ({
            failureType: item.failureType,
            retrySame: item.retrySame,
            tryAlternative: item.tryAlternative,
            stuckRisk: item.stuckRisk
          }))
      }));
    };

    const finishAfterRuntimeDecisions = (payload) => {
      const pending = [...pendingRuntimeDecisions];
      if (!pending.length) return finish(payload);
      Promise.allSettled(pending).then(() => {
        if (!ended) finish(payload);
      });
    };

    const enforceExecutionPolicy = () => {
      if (!executionPolicy || policyStopped || ended) return;
      const metrics = getToolMetrics();
      const softReached = executionPolicy.softToolExecutions > 0 &&
        metrics.executions >= executionPolicy.softToolExecutions;
      if (softReached && !policyWarned) {
        policyWarned = true;
        const warning = {
          mode: executionPolicy.mode,
          level: 'soft',
          executions: metrics.executions,
          polls: metrics.polls,
          changed_files: metrics.changed_files.length,
          hard_tool_limit: executionPolicy.hardToolExecutions,
          poll_limit: executionPolicy.maxPolls,
          file_limit: executionPolicy.maxFilesChanged
        };
        console.warn('[ExecutionPolicy] soft budget reached ' + JSON.stringify({ request_id: requestId, ...warning }));
        sendEvent('policy', warning);
        queueSoftBudgetDecision();
      }

      const violations = [];
      if (metrics.executions > executionPolicy.hardToolExecutions) {
        violations.push(`tool executions ${metrics.executions}/${executionPolicy.hardToolExecutions}`);
      }
      if (metrics.polls > executionPolicy.maxPolls) {
        violations.push(`polls ${metrics.polls}/${executionPolicy.maxPolls}`);
      }
      if (executionPolicy.maxFilesChanged >= 0 && metrics.changed_files.length > executionPolicy.maxFilesChanged) {
        violations.push(`changed files ${metrics.changed_files.length}/${executionPolicy.maxFilesChanged}`);
      }
      if (!violations.length) return;

      policyStopped = true;
      const message = `Execution policy stopped this turn: ${violations.join(', ')}. Keep the task narrower or retry with a broader execution mode.`;
      console.warn('[ExecutionPolicy] hard stop ' + JSON.stringify({
        request_id: requestId,
        mode: executionPolicy.mode,
        violations
      }));
      try { abortTurn(); } catch (_) {}
      finish({
        error: message,
        provider: providerId,
        conversation_id,
        policy_stop: true,
        policy_violations: violations
      });
    };

    // The request body can close normally as soon as the browser has sent it.
    // Only the SSE response closing means the client is no longer watching.
    res.on('close', () => {
      if (!ended && !res.writableEnded) {
        ended = true;
        abortTurn();
        markOnce('to_done_ms');
        logToolMetrics('client_closed');
      }
    });

    await provider.startTurn({
      conversationId: conversation_id,
      model: effectiveModel || model,
      effort,
      workspace,
      executionMode: executionPolicy?.mode || routedExecutionMode || null,
      executionPolicy,
      executionIntent: approvedExecutionIntent,
      prompt: finalPrompt,
      imagePath: image_path,
      onAbort(handler) { abortTurn = handler; },
      onEvent(event) {
        if (ended) return;
        markOnce('to_first_event_ms');
        if (event.type === 'session_started') {
          markOnce('to_session_ms');
          activeConversationId = event.conversationId || activeConversationId;
          // A new thread only has an id after its provider starts. Persist here
          // as well as on manual selector changes so new conversations are
          // immediately bound to their first model.
          saveConversationSettings(providerId, event.conversationId, {
            model: event.model || effectiveModel || model || savedSettings?.model || (providerId === 'codex' ? 'gpt-5.6-luna' : 'gemini-3.7-flash'),
            effort: event.effort || effort || savedSettings?.effort || 'low',
            workspace,
            role: body.role || savedSettings?.role || 'general',
            ...(executionPolicy?.mode ? { executionMode: executionPolicy.mode } : {})
          }).catch(err => console.warn('[Conversation Settings] Save failed:', err.message));
          sendEvent('init', {
            conversation_id: event.conversationId,
            provider: providerId,
            model: event.model || effectiveModel,
            effort: event.effort,
            execution_mode: executionPolicy?.mode || null,
            execution_source: executionPolicy?.source || null,
            jev_route: jevRoute ? {
              input_summary: jevInputSummary,
              accepted: Boolean(jevRoute.accepted),
              mode: jevRoute.mode || null,
              suggested_mode: jevRoute.suggestedMode || null,
              confidence: jevRoute.confidence ?? null,
              reason: jevRoute.reason || null,
              latency_ms: jevRoute.latencyMs ?? null
            } : null,
            execution_intent: approvedExecutionIntent,
            intent_review: intentReview
          });
        } else if (event.type === 'text_delta') {
          markOnce('to_first_text_ms');
          // The browser already appends deltas locally. Sending the complete
          // response on every token makes one long answer O(n²) in SSE bytes
          // and JSON serialization work on the phone.
          sendEvent('chunk', { delta: event.delta });
        } else if (event.type === 'reasoning_delta') {
          sendEvent('thought', { delta: event.delta });
        } else if (event.type === 'reasoning_complete') {
          sendEvent('thought', { fullThinking: event.thinking });
        } else if (event.type === 'tool') {
          markOnce('to_first_tool_ms');
          const tracking = recordToolEvent(event);
          sendEvent('tool', {
            request_id: requestId,
            state: event.state,
            tool_id: event.toolId || event.tool_id || null,
            tool_group_id: event.toolGroupId || event.tool_group_id || tracking.key,
            tool_name: event.name || event.tool_name,
            tool_info: event.info,
            duration_seconds: event.durationSeconds,
            attempts: tracking.attempts,
            poll_count: tracking.pollCount,
            tool_event_count: toolEventCount,
            unique_tool_count: toolRuns.size
          });
          queueToolFailureDecision(event, tracking);
          enforceExecutionPolicy();
        } else if (event.type === 'context_usage') {
          lastContextStats = event.stats || null;
          sendEvent('context', event.stats);
        } else if (event.type === 'error') {
          finish({ error: event.message, provider: providerId, conversation_id });
        } else if (event.type === 'turn_completed') {
          finishAfterRuntimeDecisions({
            response: event.response,
            conversation_id: event.conversationId,
            provider: providerId,
            status: event.status
          });
        }
      }
    });

  } catch (err) {
    console.error('[Chat Error]', err);
    markOnce('to_done_ms');
    console.log('[TurnMetrics] ' + JSON.stringify({
      request_id: requestId,
      provider: providerId,
      conversation_id: conversation_id || null,
      reason: 'error',
      elapsed_ms: elapsed(),
      turn_timing: turnTiming
    }));
    if (!res.writableEnded && !res.destroyed) {
      sendEvent('done', { error: err.message, request_id: requestId, turn_timing: turnTiming });
      res.end();
    }
  }
}

// 🛑 Abort Active Generation
async function handleStop(req, res) {
  try {
    const body = await parseJsonBody(req);
    const providerId = normalizeProviderId(body.provider);
    const conversationId = String(body.conversation_id || '').trim();
    if (conversationId && !/^[a-zA-Z0-9_-]+$/.test(conversationId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid conversation_id' }));
    }
    console.log(`[Stop Request] Aborting ${providerId} generation${conversationId ? ` for ${conversationId}` : 's'}...`);
    const result = await getProvider(providerId).stop(conversationId || null);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      conversation_id: conversationId || null,
      stopped: result?.stopped !== false,
      message: conversationId ? 'Generation interrupted' : 'All generations interrupted'
    }));
  } catch (err) {
    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleProviderRename(req, res) {
  try {
    const body = await parseJsonBody(req);
    const providerId = normalizeProviderId(body.provider);
    const title = String(body.title || '').trim().slice(0, 60);
    if (!body.conversation_id || !title) throw new Error('conversation_id and title are required');
    const provider = getProvider(providerId);
    if (!provider.metadata.capabilities.rename || typeof provider.renameConversation !== 'function') throw new Error('Provider does not support renaming conversations');
    await provider.renameConversation(body.conversation_id, title);
    await saveConversationTitle(providerId, body.conversation_id, title);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, conversation_id: body.conversation_id, title, provider: providerId }));
  } catch (err) {
    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// 🌐 Static Assets Serving
async function handleStatic(parsedUrl, res) {
  const pathname = typeof parsedUrl === 'string' ? parsedUrl : parsedUrl.pathname;
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const data = await fsPromises.readFile(filePath);
    // The APK reads the UI from localhost. Always serve the checked-out
    // version so git pull + runtime restart is sufficient to update the app.
    // External CDN dependencies still use WebView/browser cache normally.
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, max-age=0',
      'Pragma': 'no-cache'
    };
    res.writeHead(200, headers);
    res.end(data);
  } catch (err) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
}

// ==========================================
// 🚀 Main HTTP Server Router
// ==========================================// 📋 Guidelines Manager (GEMINI.md / AGENTS.md)
async function handleGetGuidelines(res) {
  try {
    const candidates = [
      path.join(__dirname, 'GEMINI.md'),
      path.join(RUNTIME_HOME, 'GEMINI.md'),
      path.join(__dirname, 'AGENTS.md')
    ];
    let content = '';
    let foundPath = 'GEMINI.md';
    for (const p of candidates) {
      try {
        content = await fsPromises.readFile(p, 'utf8');
        foundPath = p;
        break;
      } catch (e) {}
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, content, path: foundPath }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

// 🚀 Sync & Save Guidelines to all default locations (~/ and ~/agy-web/)
async function handleSyncGuidelines(req, res) {
  try {
    const homeDir = RUNTIME_HOME;
    const agyWebDir = __dirname;
    let body = {};
    try {
      body = await parseJsonBody(req);
    } catch (e) {}

    // 1. Read base content or use posted custom content
    let content = (body && typeof body.content === 'string' && body.content.trim()) ? body.content : '';
    if (!content) {
      try {
        content = await fsPromises.readFile(path.join(agyWebDir, 'GEMINI.md'), 'utf8');
      } catch (e) {
        try {
          content = await fsPromises.readFile(path.join(homeDir, 'GEMINI.md'), 'utf8');
        } catch (e2) {}
      }
    }

    if (!content) {
      throw new Error('未找到 GEMINI.md 原始內容');
    }

    // 2. Target paths
    const targetPaths = [
      path.join(homeDir, 'GEMINI.md'),
      path.join(homeDir, 'AGENTS.md'),
      path.join(agyWebDir, 'GEMINI.md'),
      path.join(agyWebDir, 'AGENTS.md')
    ];

    const written = [];
    for (const p of targetPaths) {
      try {
        await fsPromises.writeFile(p, content, 'utf8');
        written.push(p.replace(homeDir, '~'));
      } catch (e) {}
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, count: written.length, paths: written }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

// 🧬 Voiceprint Profile & Threshold Sync Handlers (Stored under ~/.crew-pocket/)
const CREW_POCKET_DIR = path.join(os.homedir(), '.crew-pocket');
const voiceprintFilePath = path.join(CREW_POCKET_DIR, 'voiceprint.json');

async function handleGetVoiceprint(res) {
  try {
    if (fs.existsSync(voiceprintFilePath)) {
      const data = await fsPromises.readFile(voiceprintFilePath, 'utf8');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(data);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ enabled: false, threshold: 0.25, embedding: null }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message, threshold: 0.25, embedding: null }));
  }
}

async function handleSaveVoiceprint(req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!fs.existsSync(CREW_POCKET_DIR)) fs.mkdirSync(CREW_POCKET_DIR, { recursive: true });
    
    let current = { enabled: false, threshold: 0.25, embedding: null };
    if (fs.existsSync(voiceprintFilePath)) {
      try { current = JSON.parse(await fsPromises.readFile(voiceprintFilePath, 'utf8')); } catch (e) {}
    }
    
    if (typeof body.threshold === 'number') current.threshold = Math.max(0, Math.min(1.0, body.threshold));
    if (body.embedding !== undefined) {
      if (Array.isArray(body.embedding) && body.embedding.length === 192) {
        current.embedding = body.embedding;
        current.enabled = true;
      } else if (body.embedding === null) {
        current.embedding = null;
        current.enabled = false;
      }
    }
    if (typeof body.enabled === 'boolean') current.enabled = body.enabled;
    
    await fsPromises.writeFile(voiceprintFilePath, JSON.stringify(current, null, 2), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, voiceprint: current }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function handleGetAuthStatus(res) {
  try {
    const [codexStatus, providerStatus, jevCliStatus] = await Promise.all([
      getProvider('codex').getAuthStatus(),
      auth.getAuthStatus(),
      getJevCliStatus()
    ]);
    const status = {
      ...providerStatus,
      codex: codexStatus,
      jev: {
        ...(providerStatus.jev || {}),
        cliAvailable: Boolean(jevCliStatus.available),
        cliVersion: jevCliStatus.version || null,
        cliError: jevCliStatus.available ? null : (jevCliStatus.error || null)
      }
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleCodexDeviceStart(req, res) {
  try {
    const body = await parseJsonBody(req).catch(() => ({}));
    const mode = body?.mode === 'oauth' ? 'oauth' : 'device';
    const session = await getProvider('codex').startLogin(mode);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, ...session }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

function handleCodexDeviceStatus(parsedUrl, res) {
  const sessionId = parsedUrl.query?.sessionId;
  const status = getProvider('codex').getLoginStatus(sessionId);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status));
}

async function handleCodexDeviceCancel(req, res) {
  try {
    const body = await parseJsonBody(req);
    const result = await getProvider('codex').cancelLogin(body?.sessionId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleCodexApiKey(req, res) {
  try {
    const body = await parseJsonBody(req);
    const result = await getProvider('codex').loginWithApiKey(body.apiKey);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleAgyToken(req, res) {
  try {
    const body = await parseJsonBody(req);
    const result = await auth.setAgyToken(body.token);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleJevApiKey(req, res) {
  try {
    const body = await parseJsonBody(req);
    const result = await auth.setJevApiKey(body.apiKey);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}


const REMOTE_ACCESS_DIR = path.join(os.homedir(), '.crew-pocket');
const REMOTE_ACCESS_FLAG = path.join(REMOTE_ACCESS_DIR, 'remote-enabled');

function lanAddresses() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries || []) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      if (!entry.address || entry.address.startsWith('169.254.')) continue;
      const lowerName = String(name || '').toLowerCase();
      const priority = /^(wlan|wifi)/.test(lowerName)
        ? 0
        : /^(eth|en)/.test(lowerName)
          ? 1
          : /^(rmnet|ccmni|pdp|wwan)/.test(lowerName)
            ? 3
            : 2;
      candidates.push({ address: entry.address, name, priority });
    }
  }
  candidates.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  return [...new Set(candidates.map(item => item.address))];
}

function remoteAccessSnapshot(req, configuredEnabled = fs.existsSync(REMOTE_ACCESS_FLAG)) {
  const active = !['127.0.0.1', 'localhost', '::1'].includes(String(HOST).toLowerCase());
  const addresses = lanAddresses();
  const urls = addresses.map(address => `http://${address}:${PORT}`);
  const localClient = isLoopbackAddress(req.socket?.remoteAddress || '');
  const token = getApiToken();
  return {
    configuredEnabled,
    active,
    bindHost: HOST,
    port: Number(PORT),
    lanAddresses: addresses,
    urls,
    shareUrl: localClient && configuredEnabled && urls[0]
      ? `${urls[0]}?token=${encodeURIComponent(token)}`
      : null,
    tokenRequiredForRemote: configuredEnabled || active
  };
}

async function handleCrewHome(req, res) {
  try {
    const tasks = await listTasks(200);
    const counts = {
      running: tasks.filter(task => task.status === 'running').length,
      pending: tasks.filter(task => task.status === 'pending_confirmation').length,
      completed: tasks.filter(task => task.status === 'completed').length,
      failed: tasks.filter(task => task.status === 'failed').length
    };
    const recentTasks = tasks
      .filter(task => task.status !== 'cancelled')
      .slice(0, 8)
      .map(task => ({
        id: task.id,
        status: task.status,
        provider: task.provider,
        conversationId: task.conversationId,
        conversationTitle: task.conversationTitle,
        title: task.title,
        updatedAt: task.updatedAt
      }));

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      success: true,
      counts,
      recentTasks,
      remote: remoteAccessSnapshot(req),
      runtime: {
        device: os.hostname(),
        platform: process.platform,
        uptimeSeconds: Math.floor(process.uptime())
      }
    }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message || 'Crew Home unavailable' }));
  }
}

function scheduleCrewRuntimeRestart() {
  const startScript = path.join(__dirname, 'scripts', 'android-runtime-start.sh');
  try {
    const child = spawn(
      'bash',
      ['-c', 'sleep 1; exec bash "$1"', 'crew-remote-restart', startScript],
      {
        cwd: __dirname,
        env: process.env,
        detached: true,
        stdio: 'ignore'
      }
    );
    child.unref();
    setTimeout(() => process.exit(0), 250);
    return true;
  } catch (error) {
    console.error('[Remote Access Restart Error]', error);
    return false;
  }
}

async function handleRemoteAccess(req, res) {
  if (req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ success: true, remote: remoteAccessSnapshot(req) }));
  }

  try {
    const body = await parseJsonBody(req);
    if (typeof body.enabled !== 'boolean') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'enabled must be boolean' }));
    }

    await fsPromises.mkdir(REMOTE_ACCESS_DIR, { recursive: true, mode: 0o700 });
    if (body.enabled) {
      await fsPromises.writeFile(REMOTE_ACCESS_FLAG, 'enabled\n', { mode: 0o600 });
    } else {
      await fsPromises.unlink(REMOTE_ACCESS_FLAG).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    }

    const snapshot = remoteAccessSnapshot(req, body.enabled);
    const restarting = scheduleCrewRuntimeRestart();
    res.writeHead(restarting ? 202 : 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: restarting,
      restarting,
      remote: snapshot,
      error: restarting ? undefined : 'Runtime restart could not be scheduled'
    }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message || 'Remote access update failed' }));
  }
}

// 🌐 HTTP Server Request Dispatcher
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  maybeSetAuthCookie(res, parsedUrl);
  applyCors(req, res);

  if (pathname === '/healthz') {
    res.writeHead(204, {
      'Cache-Control': 'no-store',
      'Content-Length': '0'
    });
    return res.end();
  }

  if (req.method === 'OPTIONS') {
    const origin = String(req.headers.origin || '').trim();
    if (origin && !res.getHeader('Access-Control-Allow-Origin')) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Cross-origin API access is not allowed' }));
    }
    res.writeHead(204);
    return res.end();
  }

  if (pathname.startsWith('/api/')) {
    const authorization = authorizeApiRequest(req, parsedUrl);
    if (!authorization.ok) {
      res.writeHead(authorization.statusCode || 403, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: authorization.error || 'Forbidden' }));
    }
  }

  if (pathname === '/api/home' && req.method === 'GET') {
    return handleCrewHome(req, res);
  } else if (pathname === '/api/remote-access' && (req.method === 'GET' || req.method === 'POST')) {
    return handleRemoteAccess(req, res);
  } else if (pathname === '/api/conversations' && req.method === 'GET') {
    return handleProviderConversations(parsedUrl, res);
  } else if (pathname === '/api/history' && req.method === 'GET') {
    return handleProviderHistory(parsedUrl, res);
  } else if (pathname === '/api/conversation' && req.method === 'DELETE') {
    return handleProviderDelete(parsedUrl, res);
  } else if (pathname === '/api/conversation-settings' && req.method === 'POST') {
    return handleConversationSettings(req, res);
  } else if (pathname === '/api/workspaces' && req.method === 'GET') {
    return handleWorkspaces(res);
  } else if (pathname === '/api/workspaces' && req.method === 'POST') {
    return handleCreateWorkspace(req, res);
  } else if (pathname === '/api/storage' && req.method === 'GET') {
    return handleStorageReport(res);
  } else if (pathname === '/api/storage/media' && req.method === 'DELETE') {
    return handleStorageDelete(req, res);
  } else if (pathname === '/api/storage/thumbnail' && req.method === 'GET') {
    return handleStorageThumbnail(parsedUrl, res);
  } else if (pathname === '/api/chat' && req.method === 'POST') {
    return handleChat(req, res);
  } else if (pathname === '/api/live-delegate' && req.method === 'POST') {
    return handleLiveDelegate(req, res);
  } else if (pathname === '/api/live-delegate' && req.method === 'GET') {
    return handleLiveDelegateStatus(parsedUrl, res);
  } else if (pathname === '/api/tasks' && (req.method === 'GET' || req.method === 'POST')) {
    return handleTasks(req, res, parsedUrl);
  } else if (pathname === '/api/stop' && req.method === 'POST') {
    return handleStop(req, res);
  } else if (pathname === '/api/upload' && req.method === 'POST') {
    return handleUpload(req, res);
  } else if (pathname === '/api/live-camera-snapshot' && req.method === 'POST') {
    return handleLiveCameraSnapshot(req, res);
  } else if (pathname === '/api/run-code' && req.method === 'POST') {
    return handleRunCode(req, res);
  } else if (pathname === '/api/compact' && req.method === 'POST') {
    return handleProviderCompact(req, res);
  } else if (pathname === '/api/codex/compact' && req.method === 'POST') {
    return handleProviderCompact(req, res, 'codex');
  } else if (pathname === '/api/codex/continuation-summary' && req.method === 'POST') {
    return handleCodexContinuationSummary(req, res);
  } else if (pathname === '/api/live-sync' && req.method === 'POST') {
    return handleLiveSync(req, res);
  } else if (pathname === '/api/live-transcribe' && req.method === 'POST') {
    return handleLiveTranscribe(req, res);
  } else if (pathname === '/api/quick-transcribe' && req.method === 'POST') {
    return handleQuickTranscribe(req, res);
  } else if (pathname === '/api/rewind' && req.method === 'POST') {
    return handleProviderRewind(req, res);
  } else if (pathname === '/api/prewarm' && req.method === 'POST') {
    const body = await parseJsonBody(req);
    const providerId = normalizeProviderId(body.provider);
    const workspace = await resolveWorkspace(body.workspace);
    const result = await getProvider(providerId).prewarm(body.model, body.effort, workspace);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, prewarmed: true, prewarm: result || null, provider: providerId }));
  } else if (pathname === '/api/rename-conversation' && req.method === 'POST') {
    return handleProviderRename(req, res);
  } else if (pathname === '/api/models' && req.method === 'GET') {
    return handleGetModels(res);
  } else if (pathname === '/api/providers' && req.method === 'GET') {
    return handleGetProviders(res);
  } else if (pathname === '/api/runtime/status' && req.method === 'GET') {
    return handleRuntimeStatus(res);
  } else if (pathname === '/api/runtime/providers' && (req.method === 'GET' || req.method === 'POST')) {
    return handleRuntimeProviders(req, res);
  } else if (pathname === '/api/runtime/history-migration' && req.method === 'GET') {
    if (!historyMigration) { res.writeHead(404); return res.end(); }
    return historyMigration.status(req, res);
  } else if (pathname === '/api/runtime/history-migration' && req.method === 'POST') {
    if (!historyMigration) { res.writeHead(404); return res.end(); }
    return historyMigration.receive(req, res);
  } else if (pathname === '/api/runtime/self-debug' && (req.method === 'GET' || req.method === 'POST')) {
    return handleRuntimeSelfDebug(req, res);
  } else if (pathname === '/api/auth/status' && req.method === 'GET') {
    return handleGetAuthStatus(res);
  } else if (pathname === '/api/auth/codex/device-start' && req.method === 'POST') {
    return handleCodexDeviceStart(req, res);
  } else if (pathname === '/api/auth/codex/device-status' && req.method === 'GET') {
    return handleCodexDeviceStatus(parsedUrl, res);
  } else if (pathname === '/api/auth/codex/device-cancel' && req.method === 'POST') {
    return handleCodexDeviceCancel(req, res);
  } else if (pathname === '/api/auth/codex/api-key' && req.method === 'POST') {
    return handleCodexApiKey(req, res);
  } else if (pathname === '/api/auth/agy/token' && req.method === 'POST') {
    return handleAgyToken(req, res);
  } else if (pathname === '/api/auth/jev/api-key' && req.method === 'POST') {
    return handleJevApiKey(req, res);
  } else if (pathname === '/api/session-status' && req.method === 'GET') {
    return handleSessionStatus(parsedUrl, res);
  } else if (pathname === '/api/usage' && req.method === 'GET') {
    return handleUsage(res, parsedUrl);
  } else if (pathname === '/api/files' && req.method === 'GET') {
    return handleListFiles(parsedUrl, res);
  } else if (pathname === '/api/public-assets' && req.method === 'GET') {
    return handleListPublicAssets(PUBLIC_DIR, res);
  } else if (pathname === '/api/file/read' && req.method === 'GET') {
    return handleReadFile(parsedUrl, res);
  } else if (pathname === '/api/file/save' && req.method === 'POST') {
    return handleSaveFile(req, res);
  } else if (pathname === '/api/file/delete' && req.method === 'POST') {
    return handleDeleteFile(req, res);
  } else if (pathname === '/api/file/transfer' && req.method === 'POST') {
    return handleTransferFile(req, res);
  } else if (pathname === '/api/image' && req.method === 'GET') {
    return handleImageProxy(parsedUrl, res);
  } else if (pathname === '/api/export-extension' && req.method === 'POST') {
    return handleExportExtension(req, res);
  } else if (pathname === '/api/inbound/events' && req.method === 'GET') {
    return handleInboundEvents(req, res);
  } else if (pathname === '/api/inbound/messages' && req.method === 'POST') {
    return handleInboundMessage(req, res);
  } else if (pathname.startsWith('/api/extension/')) {
    return extensionBridge.handle(req, res, pathname);
  } else if (pathname === '/api/adb' && req.method === 'GET') {
    return handleAdbStatus(res);
  } else if (pathname === '/api/adb' && req.method === 'POST') {
    return handleAdbUpdate(req, res);
  } else if (pathname === '/api/guidelines' && req.method === 'GET') {
    return handleGetGuidelines(res);
  } else if (pathname === '/api/guidelines/sync' && req.method === 'POST') {
    return handleSyncGuidelines(req, res);
  } else if (pathname === '/api/voiceprint' && req.method === 'GET') {
    return handleGetVoiceprint(res);
  } else if (pathname === '/api/voiceprint' && req.method === 'POST') {
    return handleSaveVoiceprint(req, res);
  } else if (pathname.startsWith('/api/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Unknown API endpoint' }));
  } else {
    return handleStatic(parsedUrl, res);
  }
});

extensionBridge.attach(server);

process.on('uncaughtException', (err) => {
  console.error('[Uncaught Exception]', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Unhandled Rejection]', reason);
});

server.listen(PORT, HOST, () => {
  console.log(`=================================================`);
  console.log(`🚀 Crew Pocket Web UI (Resident Pipe) at: http://${HOST}:${PORT}`);
  const runtimeSecurity = securityStatus();
  if (runtimeSecurity.tokenRequired) {
    console.log(`🔐 LAN API token: ${runtimeSecurity.token}`);
    console.log(`   第一次開啟 LAN UI 時在網址加上 ?token=<上方 token>，之後瀏覽器會記住。`);
  }
  console.log(`=================================================`);
});
