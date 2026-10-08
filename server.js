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
const TURN_METRICS_DIR = path.join(os.homedir(), '.crew-pocket');
const TURN_METRICS_FILE = path.join(TURN_METRICS_DIR, 'turn-metrics.jsonl');

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
  parseJsonBody,
  cleanUserContent
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
const { listWorkspaces, resolveWorkspace, createWorkspace } = require('./lib/workspaces');
const { listCrewMembers, saveCrewMember } = require('./lib/crew-members');
const { DEFAULT_ROLE_ID, roleIdForProject, listRoles, getRole, saveRole } = require('./lib/roles');
const { deleteRoleLifecycle } = require('./lib/role-delete');
const { listCrewRoles, sendCrewMessage, getCrewInbox, getCrewMessageActivity, markCrewMessagesDelivered } = require('./lib/crew-messages');
const { createCrewAutoResponder } = require('./lib/crew-auto-response');
const { getRoleRuntime, listRoleRuntimes, activateRoleConversation, prepareNewRoleConversation, clearRoleConversation, clearRoleConversationByConversation } = require('./lib/role-runtime');
const { buildCrewStatus } = require('./lib/crew-status');
const { listProjects, getProject } = require('./lib/projects');
const { listRoleQueuedMessages, enqueueRoleMessage, removeRoleQueuedMessage, clearRoleMessageQueue } = require('./lib/role-message-queue');
const { defaultMemoryProvider } = require('./lib/memory');
const {
  buildAgentContext,
  buildStaticContextContributions,
  formatMemoryEvidence,
  formatAgentContext
} = require('./lib/context-builder');
const { analyzeConversationContext } = require('./lib/context/health');
const { planContextCompaction } = require('./lib/context/compaction');
const { contributionFromText } = require('./lib/context/estimator');
const { ContextSourceType, ContextPriority } = require('./lib/context/types');
const {
  getContextSnapshot,
  saveContextSnapshot,
  markContextMemoryReretrieve,
  deleteContextSnapshot
} = require('./lib/context/state');
const auth = require('./lib/auth');
const {
  applyCors,
  authorizeApiRequest,
  maybeSetAuthCookie,
  maybeSetPairingCookie,
  securityStatus,
  isLoopbackAddress,
  createRemotePairing,
  getRemoteConnectionSummary,
  revokeRemoteConnection,
  revokeAllRemoteConnections
} = require('./lib/http-security');
const { createHistoryMigration } = require('./lib/runtime/history-migration');
const { getProviderRuntimeStatus, updateProvider } = require('./lib/runtime/provider-manager');
const { prepareTurnExecution } = require('./lib/runtime/turn-orchestrator');
const { normalizeExecutionIntent } = require('./lib/execution-intent');
const { getDefaultModel } = require('./lib/model-runtime');
const { buildTurnResult } = require('./lib/turn-result');
const { saveExecutionFeedback, enrichExecutionHistory } = require('./lib/execution-feedback');
const { renderVisualAnswer } = require('./lib/visual-answer');


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
      crewMemberId: settingsByConversation.get(conversation.id)?.crewMemberId || null,
      roleId: settingsByConversation.get(conversation.id)?.roleId || DEFAULT_ROLE_ID,
      role: settingsByConversation.get(conversation.id)?.role || 'general',
      model: settingsByConversation.get(conversation.id)?.model || null,
      effort: settingsByConversation.get(conversation.id)?.effort || null,
      roleNameSnapshot: settingsByConversation.get(conversation.id)?.roleNameSnapshot || null,
      roleDeletedAt: settingsByConversation.get(conversation.id)?.roleDeletedAt || null
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
      const content = message.role === 'user'
        ? cleanUserContent(String(message.content || '')).trim()
        : String(message.content || '').trim();
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

function normalizeHistoryForContextHealth(history = {}) {
  const cleanMessages = messages => Array.isArray(messages)
    ? messages.map(message => message.role === 'user'
      ? { ...message, content: stripLegacyLanguageInstruction(cleanUserContent(message.content)) }
      : message)
    : messages;

  return {
    ...history,
    messages: cleanMessages(history.messages),
    ...(Array.isArray(history.active_messages)
      ? { active_messages: cleanMessages(history.active_messages) }
      : {})
  };
}

async function getConversationContextHealth(providerId, conversationId, providedHistory = null) {
  const provider = getProvider(providerId);
  if (!provider.metadata.capabilities.history || typeof provider.getHistory !== 'function') {
    throw new Error('Provider does not support conversation history');
  }

  const rawHistory = providedHistory || await provider.getHistory(conversationId);
  const history = normalizeHistoryForContextHealth(rawHistory);
  const conversationSettings = await getConversationSettings(providerId, conversationId);
  const contextSnapshot = await getContextSnapshot(providerId, conversationId).catch(() => null);

  let additionalContributions = Array.isArray(contextSnapshot?.contributions)
    ? contextSnapshot.contributions
    : [];

  if (!additionalContributions.length) {
    let role = null;
    let project = null;
    try {
      role = await getRole(conversationSettings?.roleId || DEFAULT_ROLE_ID);
      const effectiveProjectId = role?.projectId || null;
      project = effectiveProjectId ? await getProject(effectiveProjectId) : null;
    } catch (error) {
      console.warn('[Context Health] Identity context unavailable:', error.message);
    }
    additionalContributions = buildStaticContextContributions({ role, project });
  }

  const contextHealth = analyzeConversationContext(history, {
    additionalContributions
  });

  return {
    history,
    conversationSettings,
    contextSnapshot,
    contextHealth
  };
}

async function handleContextCompactionPlan(parsedUrl, res) {
  try {
    const providerId = normalizeProviderId(parsedUrl.query.provider);
    const conversationId = String(parsedUrl.query.id || parsedUrl.query.conversation_id || '').trim();
    if (!conversationId || !/^[a-zA-Z0-9_-]+$/.test(conversationId)) throw new Error('Invalid conversation id');

    const provider = getProvider(providerId);
    const bundle = await getConversationContextHealth(providerId, conversationId);
    const plan = planContextCompaction({ health: bundle.contextHealth });

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      success: true,
      provider: providerId,
      conversation_id: conversationId,
      can_compact: Boolean(provider.metadata.capabilities.compact && typeof provider.compactConversation === 'function'),
      health: bundle.contextHealth,
      plan
    }));
  } catch (error) {
    res.writeHead(error.statusCode || 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

async function handleSafeContextCompact(req, res) {
  try {
    const body = await parseJsonBody(req);
    if (body.confirmed !== true) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: false, error: 'Safe compaction requires explicit confirmation' }));
    }

    const providerId = normalizeProviderId(body.provider);
    const conversationId = String(body.conversation_id || '').trim();
    if (!conversationId || !/^[a-zA-Z0-9_-]+$/.test(conversationId)) throw new Error('Invalid conversation id');

    const provider = getProvider(providerId);
    if (!provider.metadata.capabilities.compact || typeof provider.compactConversation !== 'function') {
      throw new Error('Provider does not support conversation compaction');
    }

    const beforeBundle = await getConversationContextHealth(providerId, conversationId);
    const plan = planContextCompaction({ health: beforeBundle.contextHealth });
    if (!plan.hasActionableWork) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        success: false,
        error: '目前沒有可安全精簡的舊 Context；最近工作內容會保留。',
        health: beforeBundle.contextHealth,
        plan
      }));
    }

    const result = await provider.compactConversation(conversationId, {
      focus: body.focus,
      mode: 'continue',
      locale: body.locale === 'en' ? 'en' : 'zh-TW'
    });

    if (plan.reretrieve.length > 0) {
      await markContextMemoryReretrieve(providerId, conversationId);
    }

    const afterBundle = await getConversationContextHealth(providerId, conversationId);
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      success: true,
      provider: providerId,
      conversation_id: result.conversationId || conversationId,
      message: result.message,
      summary: result.summary,
      checkpoint: result.checkpoint || null,
      context_verification: result.contextVerification || null,
      plan,
      before_health: beforeBundle.contextHealth,
      after_health: afterBundle.contextHealth
    }));
  } catch (error) {
    console.error('[Safe Context Compact Error]', error);
    res.writeHead(error.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message || 'Context compaction failed' }));
  }
}

async function handleProviderHistory(parsedUrl, res) {
  const providerId = normalizeProviderId(parsedUrl.query.provider);
  try {
    const conversationId = parsedUrl.query.id;
    const bundle = await getConversationContextHealth(providerId, conversationId);
    const settings = bundle.conversationSettings;
    if (settings?.roleId) {
      await activateRoleConversation({
        roleId: settings.roleId,
        providerId,
        conversationId,
        model: settings.model || getDefaultModel(providerId),
        effort: settings.effort || 'low',
        workspace: settings.workspace || null
      }).catch(error => console.warn('[Role Runtime] History activation failed:', error.message));
    }
    const publicHistory = await enrichExecutionHistory(providerId, conversationId, bundle.history).catch(error => {
      console.warn('[Execution Feedback] Read failed:', error.message);
      return { ...bundle.history };
    });
    delete publicHistory.active_messages;

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ...publicHistory,
      conversation_settings: bundle.conversationSettings,
      context_health: bundle.contextHealth
    }));
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
    await deleteContextSnapshot(providerId, conversationId).catch(() => {});
    await clearRoleConversationByConversation(providerId, conversationId).catch(() => {});
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

function requestedRoleId(body = {}) {
  return String(body.role_id || body.roleId || '').trim();
}

async function resolveConversationRole({ body = {}, previous = null } = {}) {
  const requested = requestedRoleId(body);
  const persisted = String(previous?.roleId || '').trim();

  if (persisted && requested && persisted !== requested) {
    const error = new Error('這個 conversation 已屬於另一個 Role；請切換 Role 後建立新 conversation。');
    error.statusCode = 409;
    throw error;
  }

  const roleId = persisted || requested || DEFAULT_ROLE_ID;
  const role = await getRole(roleId);
  if (!role) {
    const error = new Error('Role 不存在');
    error.statusCode = 400;
    throw error;
  }

  const project = role.projectId ? await getProject(role.projectId) : null;
  if (role.projectId && !project) {
    const error = new Error('Role 綁定的 Project 已不可用');
    error.statusCode = 400;
    throw error;
  }

  return {
    role,
    project,
    projectId: project?.id || null,
    workspace: project?.workspace || null
  };
}

async function handleConversationSettings(req, res) {
  try {
    const body = await parseJsonBody(req);
    const providerId = normalizeProviderId(body.provider);
    const previous = await getConversationSettings(providerId, body.conversation_id);
    const identity = await resolveConversationRole({ body, previous });
    const workspace = await resolveWorkspace(identity.workspace || body.workspace || previous?.workspace || RUNTIME_HOME);
    const settings = await saveConversationSettings(providerId, body.conversation_id, {
      model: body.model || previous?.model || getDefaultModel(providerId),
      effort: body.effort || previous?.effort || 'low',
      roleId: identity.role.id,
      workspace,
      role: body.role || previous?.role || 'general'
    });
    await activateRoleConversation({
      roleId: identity.role.id,
      providerId,
      conversationId: body.conversation_id,
      model: settings.model,
      effort: settings.effort,
      workspace
    });
    broadcastCrewStatusEvent('conversation-settings', identity.role.id);
    if (previous?.workspace && previous.workspace !== workspace && providerId === 'antigravity') {
      sessionManager.closeSession(body.conversation_id);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      conversation_settings: settings,
      role: identity.role,
      project: identity.project
    }));
  } catch (err) {
    res.writeHead(err.statusCode || 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function handleCrewMembers(req, res) {
  try {
    if (req.method === 'GET') {
      const members = await listCrewMembers();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: true, crewMembers: members }));
    }
    const body = await parseJsonBody(req);
    const member = await saveCrewMember(body);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, crewMember: member }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function handleProjects(res) {
  try {
    const projects = await listProjects();
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: true, projects }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: false, projects: [], error: error.message || 'Projects unavailable' }));
  }
}

async function stopActiveRoleWork(role) {
  const runtime = await getRoleRuntime(role.id).catch(() => null);
  if (!runtime?.conversationId || !runtime.providerId) return false;
  const provider = getProvider(runtime.providerId);
  let busy = false;
  try {
    busy = Boolean(provider.getStatus(runtime.conversationId)?.isBusy);
  } catch (_) {}
  if (!busy) return false;
  await provider.stop(runtime.conversationId);
  return true;
}

async function handleRoles(req, res, parsedUrl) {
  try {
    if (req.method === 'GET') {
      const roles = await listRoles();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: true, roles }));
    }

    if (req.method === 'DELETE') {
      const roleId = String(parsedUrl?.query?.id || parsedUrl?.query?.roleId || '').trim();
      const result = await deleteRoleLifecycle(roleId, {
        stopActiveRoleFn: stopActiveRoleWork
      });
      broadcastCrewStatusEvent('role-delete', roleId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: true, deleted: result }));
    }

    const body = await parseJsonBody(req);
    const role = await saveRole(body);
    broadcastCrewStatusEvent('role-save', role.id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, role }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

const crewStatusEventClients = new Set();

function writeCrewStatusEvent(res, reason = 'update', roleId = null) {
  res.write(`event: crew-status\ndata: ${JSON.stringify({ reason, roleId, at: Date.now() })}\n\n`);
}

function broadcastCrewStatusEvent(reason = 'update', roleId = null) {
  for (const client of crewStatusEventClients) {
    try { writeCrewStatusEvent(client, reason, roleId); }
    catch (_) { crewStatusEventClients.delete(client); }
  }
}

function handleCrewStatusEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive'
  });
  res.write('retry: 3000\n\n');
  crewStatusEventClients.add(res);
  writeCrewStatusEvent(res, 'connected', null);
  const keepAlive = setInterval(() => {
    try { res.write(`: keepalive ${Date.now()}\n\n`); } catch (_) {}
  }, 25000);
  req.on('close', () => {
    clearInterval(keepAlive);
    crewStatusEventClients.delete(res);
  });
}

async function handleRoleQueue(req, res, parsedUrl) {
  try {
    if (req.method === 'GET') {
      const roleId = String(parsedUrl.query.role_id || parsedUrl.query.roleId || '').trim();
      const messages = await listRoleQueuedMessages(roleId || null);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: true, messages }));
    }

    const body = await parseJsonBody(req);
    const action = String(body.action || '').trim();
    const roleId = String(body.role_id || body.roleId || '').trim();
    if (!roleId || !(await getRole(roleId))) throw new Error('Role does not exist');

    if (action === 'enqueue') {
      const message = await enqueueRoleMessage({
        roleId,
        providerId: normalizeProviderId(body.provider),
        conversationId: body.conversation_id || body.conversationId || null,
        text: body.text || body.message,
        imagePath: body.image_path || body.imagePath || null,
        source: body.source || 'chat'
      });
      broadcastCrewStatusEvent('queue-enqueue', roleId);
      res.writeHead(201, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: true, message }));
    }

    if (action === 'remove') {
      const removed = await removeRoleQueuedMessage(roleId, body.message_id || body.messageId);
      broadcastCrewStatusEvent('queue-remove', roleId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: true, removed }));
    }

    if (action === 'clear') {
      const removed = await clearRoleMessageQueue(roleId);
      broadcastCrewStatusEvent('queue-clear', roleId);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: true, removed }));
    }

    throw new Error('Role queue action must be enqueue, remove, or clear');
  } catch (error) {
    res.writeHead(error.statusCode || 400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

async function handleCrewStatus(res) {
  try {
    const status = await buildCrewStatus({
      listRoles,
      listRoleRuntimes,
      getConversationSettings,
      getCrewInbox,
      getCrewMessageActivity,
      getProvider,
      listRoleQueuedMessages
    });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: true, ...status }));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: false, roles: [], error: error.message || 'Crew status unavailable' }));
  }
}

async function handleRoleRuntime(req, res) {
  try {
    const body = await parseJsonBody(req);
    const action = String(body.action || '').trim();
    const roleId = String(body.role_id || body.roleId || '').trim();
    const role = roleId ? await getRole(roleId) : null;
    if (!role) throw new Error('Role does not exist');

    if (action === 'prepare_new') {
      const providerId = normalizeProviderId(body.provider);
      const project = role.projectId ? await getProject(role.projectId) : null;
      const workspace = await resolveWorkspace(project?.workspace || body.workspace || RUNTIME_HOME);
      const runtime = await prepareNewRoleConversation({
        roleId: role.id,
        providerId,
        model: body.model || getDefaultModel(providerId),
        effort: body.effort || 'low',
        workspace
      });
      broadcastCrewStatusEvent('runtime-prepare-new', role.id);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: true, runtime }));
    }

    throw new Error('Role runtime action must be prepare_new');
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

function memoryScopesFromQuery(query = {}) {
  const raw = query.scopes || query.scope;
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : String(raw).split(',');
  const scopes = values.map(value => String(value || '').trim()).filter(Boolean);
  return scopes.length ? scopes : undefined;
}

function memoryStatusesFromQuery(query = {}) {
  const raw = query.statuses || query.status;
  if (!raw) return undefined;
  const values = Array.isArray(raw) ? raw : String(raw).split(',');
  const statuses = values.map(value => String(value || '').trim()).filter(Boolean);
  return statuses.length ? statuses : undefined;
}

async function handleMemories(req, res, parsedUrl) {
  try {
    if (req.method === 'GET') {
      const query = parsedUrl.query || {};
      const memories = await defaultMemoryProvider.recall({
        text: query.q || query.query || '',
        scopes: memoryScopesFromQuery(query),
        statuses: memoryStatusesFromQuery(query),
        roleId: query.roleId || query.role_id || null,
        projectId: query.projectId || query.project_id || null,
        conversationId: query.conversationId || query.conversation_id || null,
        limit: query.limit,
        maxChars: query.maxChars || query.max_chars
      });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: true, memories }));
    }

    if (req.method === 'POST') {
      const body = await parseJsonBody(req);
      const memory = await defaultMemoryProvider.retain(body);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, memory }));
    }

    const id = String(parsedUrl.query?.id || '').trim();
    if (!id) throw new Error('Memory id is required');
    const forgotten = await defaultMemoryProvider.forget(id);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, forgotten, id }));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
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




async function handleCrewTool(req, res) {
  try {
    const body = await parseJsonBody(req);
    const action = String(body.action || '').trim();

    if (action === 'list_roles') {
      const roles = await listCrewRoles();
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: true, roles }));
    }

    if (action === 'send_message') {
      const message = await sendCrewMessage({
        fromRoleId: body.from_role_id || body.fromRoleId,
        toRoleId: body.to_role_id || body.toRoleId,
        content: body.message || body.content,
        replyToId: body.reply_to_id || body.replyToId || null
      });
      const autoResponse = await crewAutoResponder.dispatch(message, { waitForReply: true });
      broadcastCrewStatusEvent('crew-message', message.toRoleId || null);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ success: true, message, auto_response: autoResponse }));
    }

    throw new Error('Crew tool action must be list_roles or send_message');
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

function buildCrewToolGuide(role) {
  if (!role?.id) return '';
  const scriptPath = path.join(__dirname, 'scripts', 'crew-tool.js');
  return [
    '[Crew Tool]',
    'Current Role: ' + role.name + ' (' + role.id + ')',
    'List Roles: node ' + JSON.stringify(scriptPath) + ' roles',
    'Send plain-text message: node ' + JSON.stringify(scriptPath) + ' send ' + role.id + ' <target-role-id> "<message>"',
    'Fallback API: POST http://127.0.0.1:' + PORT + '/api/crew-tool with action=list_roles or action=send_message.',
    'Only the explicit message text is copied from the sender. The recipient handles it inside their own current conversation; do not attach or infer the sender\'s Context, Memory, Conversation, Project or workspace data.'
  ].join('\n');
}

function formatCrewInbox(messages = []) {
  if (!messages.length) return '';
  return [
    '[Crew Messages]',
    'These are replies returned by other Roles. They were produced inside each sender Role\'s own current conversation; no sender Context, Memory, Conversation or Project data was copied here.',
    ...messages.map(message => '- [' + message.id + '] From ' + message.fromRoleName + ' (' + message.fromRoleId + '): ' + message.content)
  ].join('\n');
}

const crewAutoResponder = createCrewAutoResponder({
  listProviders,
  getProvider,
  getProviderConversationSettings,
  getDefaultModel,
  getRole,
  getRoleRuntime,
  activateRoleConversation,
  clearRoleConversation,
  buildAgentContext,
  formatAgentContext,
  sendCrewMessage,
  getCrewInbox,
  markCrewMessagesDelivered,
  saveConversationSettings,
  runtimeHome: RUNTIME_HOME
});

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
async function handleCodexWarmup(req, res) {
  try {
    const codex = getProvider('codex');
    if (req.method === 'POST') {
      const body = await parseJsonBody(req);
      if (body.enabled === true) await codex.warmup();
      else codex.stopWarmup();
    }
    const status = typeof codex.getWarmupStatus === 'function'
      ? codex.getWarmupStatus()
      : { enabled: false, running: false, busy: false };
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ success: true, ...status }));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: error.message }));
  }
}

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
    intent_ms: null,
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
  // Role owns long-lived identity. Project owns workspace; Conversation owns short-lived execution context.
  const workspaceStartedAt = Date.now();
  let workspace;
  let savedSettings = null;
  let role = null;
  let project = null;
  let projectId = null;
  try {
    if (conversation_id) savedSettings = await getConversationSettings(providerId, conversation_id);

    const identity = await resolveConversationRole({ body, previous: savedSettings });
    role = identity.role;
    project = identity.project;
    projectId = identity.projectId;
    workspace = await resolveWorkspace(identity.workspace || savedSettings?.workspace || body.workspace || RUNTIME_HOME);

    if (conversation_id && (!savedSettings?.workspace || !savedSettings?.roleId || savedSettings.workspace !== workspace)) {
      saveConversationSettings(providerId, conversation_id, {
        model: model || savedSettings?.model || getDefaultModel(providerId),
        effort: effort || savedSettings?.effort || 'low',
        workspace,
        roleId: role.id,
        role: body.role || savedSettings?.role || 'general'
      }).catch(() => {});
    }
  } catch (err) {
    res.writeHead(err.statusCode || 400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: err.message }));
  }
  turnTiming.workspace_ms = Date.now() - workspaceStartedAt;

  let pendingCrewMessages = [];
  try {
    pendingCrewMessages = role?.id
      ? (await getCrewInbox(role.id, { undeliveredOnly: true, limit: 20 }))
        .filter(message => Boolean(message.replyToId))
      : [];
  } catch (error) {
    console.warn('[Crew Messages] Inbox unavailable:', error.message);
  }
  const pendingCrewMessageIds = pendingCrewMessages.map(message => message.id);

  const effectiveModel = model || savedSettings?.model || getDefaultModel(providerId);
  const {
    routedExecutionMode,
    executionSource,
    executionPolicy,
    executionIntent,
    intentReview,
    approvedExecutionIntent,
    planningOutcome
  } = await prepareTurnExecution({
    providerId,
    effectiveModel,
    explicitExecutionMode,
    savedSettings,
    prompt,
    workspace,
    body,
    getProvider,
    turnTiming
  });

  if (executionIntent || intentReview) {
    console.log('[ExecutionIntent] ' + JSON.stringify({
      request_id: requestId,
      conversation_id: conversation_id || null,
      mode_before_review: routedExecutionMode || null,
      mode_after_review: executionPolicy?.mode || null,
      intent: executionIntent,
      review: intentReview,
      outcome: planningOutcome,
      intent_ms: turnTiming.intent_ms
    }));
  }


  let finalPrompt = prompt || 'Analyze this image';
  let contextSnapshot = conversation_id
    ? await getContextSnapshot(providerId, conversation_id).catch(() => null)
    : null;
  let assembledContextContributions = Array.isArray(contextSnapshot?.contributions)
    ? [...contextSnapshot.contributions]
    : [];
  let memoryRefreshConsumed = false;

  // New threads receive the bounded Role/Project/Memory/Task metadata once.
  // We persist only attribution metadata (never prompt text) so Context Health
  // can later explain what was actually assembled for the model.
  if (!conversation_id) {
    let roleMemoryContext = '';
    let agentContext = null;
    try {
      agentContext = await buildAgentContext({
        roleId: role?.id || DEFAULT_ROLE_ID,
        projectId,
        currentWork: approvedExecutionIntent?.summary || '',
        currentPrompt: finalPrompt
      });
      roleMemoryContext = formatAgentContext(agentContext);
      assembledContextContributions = [...agentContext.contributions];
    } catch (error) {
      console.warn('[Memory Context] Build failed:', error.message);
    }

    const capabilityGuide = buildCapabilityGuide(finalPrompt);
    if (capabilityGuide) {
      assembledContextContributions.push(contributionFromText({
        id: 'capability-guide',
        type: ContextSourceType.SYSTEM,
        text: capabilityGuide,
        label: 'Crew capability rules',
        priority: ContextPriority.REQUIRED,
        compactable: false,
        pinned: true,
        sourceRef: 'system:capability-guide'
      }));
    }

    finalPrompt = `${roleMemoryContext ? `${roleMemoryContext}\n` : ''}${capabilityGuide}\n\n<USER_REQUEST>${finalPrompt}</USER_REQUEST>`;
  } else if (contextSnapshot?.reretrieveMemoryOnNextTurn) {
    // Safe compaction may remove recalled memory from active context. Refresh it
    // once on the next real task instead of permanently pinning long-term memory.
    try {
      const refreshed = await buildAgentContext({
        roleId: role?.id || DEFAULT_ROLE_ID,
        projectId,
        conversationId: conversation_id,
        currentWork: approvedExecutionIntent?.summary || '',
        currentPrompt: finalPrompt
      });
      const refreshedMemories = refreshed.memories || [];
      const memoryContributions = (refreshed.contributions || []).filter(
        contribution => contribution.type === ContextSourceType.MEMORY
      );
      assembledContextContributions = [
        ...assembledContextContributions.filter(contribution => contribution.type !== ContextSourceType.MEMORY),
        ...memoryContributions
      ];
      if (refreshedMemories.length) {
        const memoryLines = refreshedMemories.map((hit, index) =>
          `${index + 1}. ${formatMemoryEvidence(hit.record || {})}`
        );
        finalPrompt = `<ADDITIONAL_METADATA>\n[Refreshed Long-Term Memory]\n${memoryLines.join('\n')}\n</ADDITIONAL_METADATA>\n${finalPrompt}`;
      }
      memoryRefreshConsumed = true;
    } catch (error) {
      console.warn('[Memory Context] Refresh after compaction failed:', error.message);
    }
  }

  // Every Role can discover the Crew tool. The guide is intentionally tiny:
  // discovery + plain-text messaging only, never implicit context transfer.
  const crewToolGuide = buildCrewToolGuide(role);
  const crewInboxText = formatCrewInbox(pendingCrewMessages);
  const crewMetadata = [crewToolGuide, crewInboxText].filter(Boolean).join('\n\n');
  if (crewMetadata) {
    assembledContextContributions.push(contributionFromText({
      id: 'crew-role-messages',
      type: ContextSourceType.OTHER,
      text: crewMetadata,
      label: 'Crew role messages',
      priority: ContextPriority.HIGH,
      compactable: true,
      sourceRef: role?.id ? 'crew-role:' + role.id : undefined
    }));
    finalPrompt = '<ADDITIONAL_METADATA>\n' + crewMetadata + '\n</ADDITIONAL_METADATA>\n' + finalPrompt;
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
    let activeConversationId = conversation_id || null;
    let streamedResponse = '';
    const feedbackTools = new Map();

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
      const metrics = {
        request_id: requestId,
        provider: providerId,
        conversation_id: conversation_id || null,
        execution_mode: executionPolicy?.mode || null,
        execution_policy_source: executionPolicy?.source || null,
        execution_intent: approvedExecutionIntent,
        intent_review: intentReview,
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
      };
      console.log('[ToolMetrics] ' + JSON.stringify(metrics));
      fsPromises.mkdir(TURN_METRICS_DIR, { recursive: true })
        .then(() => fsPromises.appendFile(TURN_METRICS_FILE, JSON.stringify(metrics) + '\n'))
        .catch(error => console.warn('[ToolMetrics] Persist failed:', error.message));
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
      const info = event.info || {};
      const effectiveState = info.error || (Number.isInteger(info.exitCode) && info.exitCode !== 0) ? 'failed' : state;
      feedbackTools.set(key, {
        tool_group_id: key,
        tool_name: event.name || event.tool_name,
        state: effectiveState,
        tool_info: { parameters: info.parameters, exitCode: info.exitCode, error: info.error },
        duration_seconds: event.durationSeconds,
        attempts: run.attempts,
        poll_count: run.pollCount
      });
      if (['completed', 'complete', 'success', 'succeeded'].includes(effectiveState)) collectChangedFiles(event, changedFiles);
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
      const toolMetrics = getToolMetrics();
      const turnResult = buildTurnResult({
        requestId,
        executionPolicy,
        toolMetrics,
        elapsedMs: elapsed(),
        error: payload?.error,
        status: payload?.status
      });
      const finalPayload = {
        ...(payload || {}),
        request_id: requestId,
        tool_metrics: toolMetrics,
        turn_result: turnResult || undefined,
        execution_policy: executionPolicy || undefined,
        execution_intent: approvedExecutionIntent || undefined,
        intent_review: intentReview || undefined,
        turn_timing: turnTiming
      };
      logToolMetrics(finalPayload.error ? 'error' : 'completed');
      saveExecutionFeedback(providerId, finalPayload.conversation_id || activeConversationId, {
        response: finalPayload.response || streamedResponse,
        startedAt: requestStartedAt,
        turnResult,
        tools: [...feedbackTools.values()]
      }).catch(error => console.warn('[Execution Feedback] Save failed:', error.message)).finally(() => {
        sendEvent('done', finalPayload);
        res.end();
      });
    };

    const enforceExecutionPolicy = () => {
      if (!executionPolicy || ended) return;
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

      const message = `Execution policy warning: ${violations.join(', ')}. Continuing because the runtime budget is advisory.`;
      console.warn('[ExecutionPolicy] budget warning ' + JSON.stringify({
        request_id: requestId,
        mode: executionPolicy.mode,
        violations
      }));
      sendEvent('policy', {
        mode: executionPolicy.mode,
        level: 'warning',
        message,
        executions: metrics.executions,
        polls: metrics.polls,
        changed_files: metrics.changed_files.length,
        hard_tool_limit: executionPolicy.hardToolExecutions,
        poll_limit: executionPolicy.maxPolls,
        file_limit: executionPolicy.maxFilesChanged,
        violations
      });
    };

    // The request body can close normally as soon as the browser has sent it.
    // Only the SSE response closing means the client is no longer watching.
    res.on('close', () => {
      if (!ended && !res.writableEnded) {
        ended = true;
        abortTurn();
        saveExecutionFeedback(providerId, activeConversationId, {
          response: streamedResponse,
          startedAt: requestStartedAt,
          turnResult: buildTurnResult({ requestId, executionPolicy, toolMetrics: getToolMetrics(), elapsedMs: elapsed(), status: 'interrupted' }),
          tools: [...feedbackTools.values()]
        })
          .catch(error => console.warn('[Execution Feedback] Interrupted save failed:', error.message));
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
            model: event.model || effectiveModel || model || savedSettings?.model || getDefaultModel(providerId),
            effort: event.effort || effort || savedSettings?.effort || 'low',
            workspace,
            roleId: role?.id || savedSettings?.roleId || DEFAULT_ROLE_ID,
            role: body.role || savedSettings?.role || 'general',
            ...(executionPolicy?.mode ? { executionMode: executionPolicy.mode } : {})
          }).then(settings => activateRoleConversation({
            roleId: settings.roleId || role?.id || DEFAULT_ROLE_ID,
            providerId,
            conversationId: event.conversationId,
            model: settings.model,
            effort: settings.effort,
            workspace: settings.workspace || workspace || null
          })).then(() => broadcastCrewStatusEvent('turn-start', role?.id || null))
            .catch(err => console.warn('[Conversation Settings] Save/activate failed:', err.message));
          saveContextSnapshot(providerId, event.conversationId, {
            contributions: assembledContextContributions,
            reretrieveMemoryOnNextTurn: memoryRefreshConsumed
              ? false
              : Boolean(contextSnapshot?.reretrieveMemoryOnNextTurn),
            ...(contextSnapshot?.compactedAt ? { compactedAt: contextSnapshot.compactedAt } : {})
          }).catch(err => console.warn('[Context State] Save failed:', err.message));
          sendEvent('init', {
            conversation_id: event.conversationId,
            provider: providerId,
            model: event.model || effectiveModel,
            effort: event.effort,
            execution_mode: executionPolicy?.mode || null,
            execution_source: executionPolicy?.source || null,
            role_id: role?.id || savedSettings?.roleId || DEFAULT_ROLE_ID,
            role_name: role?.name || null,
            project_id: projectId || null,
            execution_intent: approvedExecutionIntent,
            intent_review: intentReview
          });
        } else if (event.type === 'text_delta') {
          markOnce('to_first_text_ms');
          // The browser already appends deltas locally. Sending the complete
          // response on every token makes one long answer O(n²) in SSE bytes
          // and JSON serialization work on the phone.
          streamedResponse += event.delta || '';
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
            unique_tool_count: toolRuns.size,
            execution_metrics: {
              executions: [...toolRuns.values()].reduce((sum, run) => sum + run.attempts, 0),
              polls: [...toolRuns.values()].reduce((sum, run) => sum + run.pollCount, 0),
              changed_files_count: changedFiles.size,
              soft_tool_limit: executionPolicy?.softToolExecutions ?? null,
              hard_tool_limit: executionPolicy?.hardToolExecutions ?? null,
              poll_limit: executionPolicy?.maxPolls ?? null,
              file_limit: executionPolicy?.maxFilesChanged ?? null
            }
          });
          enforceExecutionPolicy();
        } else if (event.type === 'context_usage') {
          lastContextStats = event.stats || null;
          sendEvent('context', event.stats);
        } else if (event.type === 'error') {
          broadcastCrewStatusEvent('turn-error', role?.id || null);
          finish({ error: event.message, provider: providerId, conversation_id });
          if (role?.id) {
            setImmediate(() => crewAutoResponder.drain(role.id)
              .catch(error => console.warn('[Crew Messages] Queue drain failed:', error.message)));
          }
        } else if (event.type === 'turn_completed') {
          broadcastCrewStatusEvent('turn-complete', role?.id || null);
          if (pendingCrewMessageIds.length && role?.id) {
            markCrewMessagesDelivered(role.id, pendingCrewMessageIds)
              .catch(error => console.warn('[Crew Messages] Mark delivered failed:', error.message));
          }
          finish({
            response: event.response,
            conversation_id: event.conversationId,
            provider: providerId,
            status: event.status
          });
          if (role?.id) {
            setImmediate(() => crewAutoResponder.drain(role.id)
              .catch(error => console.warn('[Crew Messages] Queue drain failed:', error.message)));
          }
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
    const [codexStatus, providerStatus] = await Promise.all([
      getProvider('codex').getAuthStatus(),
      auth.getAuthStatus()
    ]);
    const status = {
      ...providerStatus,
      codex: codexStatus
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
  const connections = getRemoteConnectionSummary(req);
  return {
    configuredEnabled,
    active,
    bindHost: HOST,
    port: Number(PORT),
    lanAddresses: addresses,
    urls,
    pairingAvailable: localClient && configuredEnabled && active && urls.length > 0,
    connectionCount: connections.connectionCount,
    connections: localClient ? connections.connections : [],
    currentConnection: localClient ? null : connections.currentConnection,
    activeWindowSeconds: connections.activeWindowSeconds
  };
}

async function handleCrewHome(req, res) {
  try {
    const status = await buildCrewStatus({
      listRoles,
      listRoleRuntimes,
      getConversationSettings,
      getCrewInbox,
      getCrewMessageActivity,
      getProvider,
      listRoleQueuedMessages
    });
    const roles = Array.isArray(status.roles) ? status.roles : [];
    const counts = {
      working: roles.filter(role => role.state === 'working').length,
      waiting: roles.filter(role => role.state === 'waiting').length,
      attention: roles.reduce((sum, role) => sum + Number(role.attentionCount || 0), 0)
    };
    const recentRoles = roles
      .filter(role => role.runtime || role.recentMessage || role.queuedRequestCount || role.unreadReplyCount)
      .sort((left, right) => Number(right.lastActivityAt || 0) - Number(left.lastActivityAt || 0))
      .slice(0, 8)
      .map(role => ({
        roleId: role.roleId,
        roleName: role.roleName,
        state: role.state,
        busy: role.busy,
        providerId: role.runtime?.providerId || null,
        conversationId: role.runtime?.conversationId || null,
        conversationTitle: role.conversationTitle || null,
        currentWork: role.currentWork || null,
        queuedMessageCount: Number(role.queuedMessageCount || 0),
        queuedRequestCount: Number(role.queuedRequestCount || 0),
        unreadReplyCount: Number(role.unreadReplyCount || 0),
        attentionCount: Number(role.attentionCount || 0),
        lastActivityAt: Number(role.lastActivityAt || 0),
        recentMessage: role.recentMessage || null
      }));

    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({
      success: true,
      counts,
      recentRoles,
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
      revokeAllRemoteConnections();
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

function isLocalAdminRequest(req) {
  return isLoopbackAddress(req.socket?.remoteAddress || '');
}

async function handleRemotePairing(req, res) {
  if (!isLocalAdminRequest(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'Pairing can only be created on the phone' }));
  }

  const snapshot = remoteAccessSnapshot(req);
  if (!snapshot.pairingAvailable) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'Remote Console is not active' }));
  }

  const pairing = createRemotePairing();
  const urls = snapshot.urls.map(baseUrl => `${baseUrl}?pair=${encodeURIComponent(pairing.ticket)}`);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  return res.end(JSON.stringify({
    success: true,
    pairing: {
      url: urls[0] || null,
      urls,
      expiresAt: pairing.expiresAt,
      ttlSeconds: Math.floor((pairing.expiresAt - Date.now()) / 1000)
    }
  }));
}

async function handleRemoteConnectionRevoke(req, res) {
  if (!isLocalAdminRequest(req)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: 'Connections can only be managed on the phone' }));
  }

  try {
    const body = await parseJsonBody(req);
    let revoked = 0;
    if (body.all === true) {
      revoked = revokeAllRemoteConnections();
    } else if (body.id) {
      revoked = revokeRemoteConnection(body.id) ? 1 : 0;
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ success: true, revoked, remote: remoteAccessSnapshot(req) }));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: false, error: error.message || 'Connection revoke failed' }));
  }
}

async function handleVisualAnswer(req, res) {
  try {
    const body = await parseJsonBody(req);
    const result = await renderVisualAnswer(body?.content);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ success: true, html: result.html, cached: result.cached }));
  } catch (err) {
    const status = err.statusCode || (/(沒有可以|過長|too large)/i.test(err.message) ? 400 : 503);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ success: false, error: err.message || '視覺化渲染失敗' }));
  }
}

// 🌐 HTTP Server Request Dispatcher
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;
  maybeSetPairingCookie(req, res, parsedUrl);
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

  if (pathname === '/api/visual-answer' && req.method === 'POST') {
    return handleVisualAnswer(req, res);
  } else if (pathname === '/api/home' && req.method === 'GET') {
    return handleCrewHome(req, res);
  } else if (pathname === '/api/remote-pairing' && req.method === 'POST') {
    return handleRemotePairing(req, res);
  } else if (pathname === '/api/remote-connections/revoke' && req.method === 'POST') {
    return handleRemoteConnectionRevoke(req, res);
  } else if (pathname === '/api/remote-access' && (req.method === 'GET' || req.method === 'POST')) {
    return handleRemoteAccess(req, res);
  } else if (pathname === '/api/conversations' && req.method === 'GET') {
    return handleProviderConversations(parsedUrl, res);
  } else if (pathname === '/api/history' && req.method === 'GET') {
    return handleProviderHistory(parsedUrl, res);
  } else if (pathname === '/api/context/compaction-plan' && req.method === 'GET') {
    return handleContextCompactionPlan(parsedUrl, res);
  } else if (pathname === '/api/context/compact' && req.method === 'POST') {
    return handleSafeContextCompact(req, res);
  } else if (pathname === '/api/conversation' && req.method === 'DELETE') {
    return handleProviderDelete(parsedUrl, res);
  } else if (pathname === '/api/conversation-settings' && req.method === 'POST') {
    return handleConversationSettings(req, res);
  } else if (pathname === '/api/codex-warmup' && (req.method === 'GET' || req.method === 'POST')) {
    return handleCodexWarmup(req, res);
  } else if (pathname === '/api/crew-members' && (req.method === 'GET' || req.method === 'POST')) {
    return handleCrewMembers(req, res);
  } else if (pathname === '/api/projects' && req.method === 'GET') {
    return handleProjects(res);
  } else if (pathname === '/api/roles' && ['GET', 'POST', 'DELETE'].includes(req.method)) {
    return handleRoles(req, res, parsedUrl);
  } else if (pathname === '/api/crew-status' && req.method === 'GET') {
    return handleCrewStatus(res);
  } else if (pathname === '/api/crew-status/events' && req.method === 'GET') {
    return handleCrewStatusEvents(req, res);
  } else if (pathname === '/api/role-queue' && ['GET', 'POST'].includes(req.method)) {
    return handleRoleQueue(req, res, parsedUrl);
  } else if (pathname === '/api/role-runtime' && req.method === 'POST') {
    return handleRoleRuntime(req, res);
  } else if (pathname === '/api/crew-tool' && req.method === 'POST') {
    return handleCrewTool(req, res);
  } else if (pathname === '/api/memories' && ['GET', 'POST', 'DELETE'].includes(req.method)) {
    return handleMemories(req, res, parsedUrl);
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
    console.log(`🔐 LAN access uses one-time pairing QR; no API token is shown to remote users.`);
  }
  console.log(`=================================================`);
  if (process.env.CREW_CODEX_SESSION_WARMUP === '1') {
    getProvider('codex').warmup()
      .then(() => console.log('[Codex Provider] session warmup ready'))
      .catch(error => console.warn('[Codex Provider] session warmup failed:', error.message));
  }
});
