const http = require('node:http');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const url = require('node:url');

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
const { handleRunCode } = require('./lib/sandbox');
const { handleUsage } = require('./lib/usage');
const { handleListFiles, handleReadFile, handleSaveFile } = require('./lib/files');
const { handleGenerateTitle, getCachedTitle } = require('./lib/title');
const { phoneAgent } = require('./lib/phone_agent');
const { createExtensionBridge } = require('./lib/extension_bridge');

// 📱 Phone Agent (Wireless ADB / Screen & Touch Control) API Handlers
async function handlePhoneStatus(res) {
  const status = await phoneAgent.getStatus();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(status));
}

async function handlePhoneConnect(req, res) {
  try {
    const body = await parseJsonBody(req);
    const result = await phoneAgent.connectWireless(body.port, body.host || '127.0.0.1');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function handlePhonePair(req, res) {
  try {
    const body = await parseJsonBody(req);
    const result = await phoneAgent.pairWireless(body.port, body.pairingCode, body.host || '127.0.0.1');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function handlePhoneScreenshot(res) {
  const result = await phoneAgent.takeScreenshot();
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(result));
}

async function handlePhonePhoto(req, res) {
  try {
    let facing = 'back';
    if (req.method === 'POST') {
      const body = await parseJsonBody(req).catch(() => ({}));
      if (body && body.camera) facing = body.camera;
    }
    const result = await phoneAgent.takePhoto(facing);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

async function handlePhoneAction(req, res) {
  try {
    const body = await parseJsonBody(req);
    let result = { success: false };
    if (body.action === 'TAP') {
      result = await phoneAgent.tap(body.x, body.y);
    } else if (body.action === 'SWIPE') {
      result = await phoneAgent.swipe(body.x1, body.y1, body.x2, body.y2, body.durationMs);
    } else if (body.action === 'KEYEVENT') {
      result = await phoneAgent.pressKey(body.key);
    } else if (body.action === 'TYPE') {
      result = await phoneAgent.typeText(body.text);
    } else if (body.action === 'LAUNCH') {
      result = await phoneAgent.launchApp(body.package);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: err.message }));
  }
}

// 🌐 Inbound Web Messages from Browser Extension
const inboundWebMessages = [];

function enqueueInboundMessage(body) {
  const text = body && (body.text || body.message || body.prompt);
  if (!text) return false;
  body.text = text;
  inboundWebMessages.push(body);
  if (inboundWebMessages.length > 50) inboundWebMessages.shift();
  return true;
}

const extensionBridge = createExtensionBridge({ onInboundMessage: enqueueInboundMessage });

async function handleInboundMessage(req, res) {
  if (req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      enqueueInboundMessage(body);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, count: inboundWebMessages.length }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  } else if (req.method === 'GET') {
    const msgs = inboundWebMessages.splice(0, inboundWebMessages.length);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ messages: msgs }));
  }
}

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
  const modelGroups = await Promise.all(listProviders().map(async provider => {
    if (!provider.metadata.capabilities.models || typeof provider.listModels !== 'function') return [];
    try { return await provider.listModels(); }
    catch (err) {
      console.warn(`[${provider.id} Models] Discovery failed:`, err.message);
      return provider.fallbackModels || [];
    }
  }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ models: modelGroups.flat(), efforts: THINKING_EFFORTS }));
}

function handleGetProviders(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ providers: listProviderMetadata() }));
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
    const conversations = await provider.listConversations();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ conversations }));
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
      locale: body.locale === 'en' ? 'en' : 'zh-TW'
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      provider: providerId,
      conversation_id: result.conversationId || body.conversation_id,
      summary: result.summary,
      message: result.message
    }));
  } catch (err) {
    console.error('[Provider Compact Error]', err);
    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || '對話壓縮失敗' }));
  }
}

async function handleProviderHistory(parsedUrl, res) {
  const providerId = normalizeProviderId(parsedUrl.query.provider);
  try {
    const provider = getProvider(providerId);
    if (!provider.metadata.capabilities.history || typeof provider.getHistory !== 'function') throw new Error('Provider does not support conversation history');
    const history = await provider.getHistory(parsedUrl.query.id);
    if (Array.isArray(history.messages)) {
      history.messages = history.messages.map(message => message.role === 'user'
        ? { ...message, content: stripLegacyLanguageInstruction(message.content) }
        : message);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(history));
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

    const HOME_DIR = '/data/data/com.termux/files/home';
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




// 🏷️ Crew Pocket System Guide & Capability Manifest
const CREW_POCKET_SYSTEM_GUIDE = `[Context: You are the core intelligence of "Crew Pocket (口袋特勤隊 2.0)", a specialized mobile AI assistant running locally on Android Termux.

⚡ FRONTEND RENDERING & CAPABILITY MANIFEST:
1. 🌐 Interactive Web & UI Sandbox:
   - When the user asks to build, test, preview, or see an interactive tool (e.g. calculator, game, widget, dashboard, animation, converter):
     * ALWAYS output a COMPLETE, self-contained \`\`\`html code block (including <!DOCTYPE html>, <html>, <head>, <style> or Tailwind CDN <script src="https://cdn.tailwindcss.com"></script>, <body>, and <script>).
     * IMPORTANT: Keep the \`\`\`html block strictly pure HTML code. NEVER mix ASCII border frames (┌─┐, ═══) or explanatory text inside the \`\`\`html block.
     * Crew Pocket automatically intercepts complete \`\`\`html and \`\`\`svg blocks and transforms them into an interactive Action Card with "[🌐 開啟預覽]" (full-screen sandbox) and "[📱 內嵌小視窗]" (collapsible inline iframe).
     * The user can interact with buttons, forms, touch events, Canvas, and audio directly!
     * To load an existing Termux asset without embedding it, use its absolute local path directly in src, href, poster, srcset, or CSS url(), e.g. /data/data/com.termux/files/home/pocket-game/public/assets/tile.webp. Crew Pocket safely proxies approved local assets into the Action Card; do not use file:// URLs or assume relative paths point at another project.
   - 🔄 When modifying or iterating on an interactive tool (e.g. "change color", "add button", "fix bug"):
     * Output the UPDATED COMPLETE \`\`\`html code block so the user can immediately click the new preview card to test the updated version with 0 manual copying.
     * Accompany the code with 1-2 concise bullet points highlighting the specific changes made.

2. 📊 Charts & Data Visualization:
   - For data charts, output an HTML block containing Chart.js CDN (<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>) and a <canvas id="chart"></canvas>.
   - For standalone vector diagrams and flowcharts, output standalone \`\`\`svg or Mermaid blocks.

3. 📱 Mobile First, Touch & Link Standards:
   - Touch targets must be at least 40-48px with clear feedback.
   - For locations, routes, and maps, format Google Maps links as markdown: [地點名稱](https://www.google.com/maps/search/?api=1&query=...) (Crew Pocket automatically opens all external links in a new tab).

4. 🎯 Tone & Precision:
   - Be concise, direct, helpful, and sharp. Avoid boilerplate disclaimers.]`;

function stripLegacyLanguageInstruction(content) {
  if (typeof content !== 'string') return content;
  return content
    .replace(/\[回覆語言：除非使用者明確指定其他語言，請使用自然的繁體中文（台灣）回覆。\]\s*/g, '')
    .replace(/\[Response Language: Reply in clear, natural English unless the user explicitly asks for another language\.\]\s*/g, '');
}

// 🔔 Real-time Notify Helper for Crew Floating Bubble (Haptics, Pulse Glow, Mini Pill)
function notifyCompanionService(state, rawText = '') {
  try {
    let clean = '';
    if (rawText) {
      clean = rawText
        .replace(/<[^>]+>/g, '')
        .replace(/[#*`_\[\]()]/g, '')
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)[0] || '';
      if (clean.length > 48) clean = clean.slice(0, 45) + '...';
    }
    const data = JSON.stringify({ state, text: clean ? '✅ ' + clean : '' });
    const req = http.request({
      hostname: '127.0.0.1',
      port: 8766,
      path: '/notify',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      },
      timeout: 800
    });
    req.on('error', () => {});
    req.write(data);
    req.end();
  } catch (e) {}
}

// 💬 SSE Chat Streaming with Resident Pipe
async function handleChat(req, res) {
  let body;
  try {
    body = await parseJsonBody(req);
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Invalid JSON body' }));
  }

  const { prompt, conversation_id, image_path, model, effort } = body;
  const providerId = normalizeProviderId(body.provider);
  if (!prompt && !image_path) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Prompt or image is required' }));
  }

  let finalPrompt = prompt || 'Analyze this image';

  // 🏷️ System environment anchor for Crew Pocket (Full guide on turn 1, lightweight anchor on follow-up turns)
  if (!conversation_id) {
    finalPrompt = `${CREW_POCKET_SYSTEM_GUIDE}\n\n[User Request]:\n${finalPrompt}`;
  } else {
    finalPrompt = `[Context: Operating in Crew Pocket Mobile. Proactively provide complete \`\`\`html sandbox cards for interactive UI requests, Chart.js for data, and Google Maps links for locations.]\n\n${finalPrompt}`;
  }

  if (image_path) {
    finalPrompt = `[Uploaded Image: ${image_path}]\n${finalPrompt}`;
  }

  notifyCompanionService('THINKING');

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

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const provider = getProvider(providerId);
    let ended = false;
    let abortTurn = () => {};
    const finish = (payload) => {
      if (ended) return;
      ended = true;
      if (payload && payload.error) {
        notifyCompanionService('IDLE');
      } else {
        notifyCompanionService('DONE', payload.response || '任務已完成');
      }
      sendEvent('done', payload);
      res.end();
    };

    req.on('close', () => {
      if (!ended) {
        abortTurn();
        notifyCompanionService('IDLE');
      }
    });

    await provider.startTurn({
      conversationId: conversation_id,
      model,
      effort,
      prompt: finalPrompt,
      imagePath: image_path,
      onAbort(handler) { abortTurn = handler; },
      onEvent(event) {
        if (ended) return;
        if (event.type === 'session_started') {
          sendEvent('init', { conversation_id: event.conversationId, provider: providerId, model: event.model, effort: event.effort });
        } else if (event.type === 'text_delta') {
          sendEvent('chunk', { delta: event.delta, accumulated: event.accumulated });
        } else if (event.type === 'reasoning_delta') {
          sendEvent('thought', { delta: event.delta });
        } else if (event.type === 'reasoning_complete') {
          sendEvent('thought', { fullThinking: event.thinking });
        } else if (event.type === 'tool') {
          const toolLabel = event.name || '工具';
          notifyCompanionService('TOOL', `正在執行：${toolLabel}`);
          sendEvent('tool', { state: event.state, tool_name: event.name, tool_info: event.info, duration_seconds: event.durationSeconds });
        } else if (event.type === 'context_usage') {
          sendEvent('context', event.stats);
        } else if (event.type === 'error') {
          notifyCompanionService('ERROR', event.message || '執行失敗');
          finish({ error: event.message, provider: providerId, conversation_id });
        } else if (event.type === 'turn_completed') {
          finish({ response: event.response, conversation_id: event.conversationId, provider: providerId, status: event.status });
        }
      }
    });

  } catch (err) {
    console.error('[Chat Error]', err);
    notifyCompanionService('IDLE');
    sendEvent('done', { error: err.message });
    res.end();
  }
}

// 🛑 Abort Active Generation
async function handleStop(req, res) {
  try {
    const body = await parseJsonBody(req);
    const providerId = normalizeProviderId(body.provider);
    console.log(`[Stop Request] Aborting active ${providerId} generation sessions...`);
    await getProvider(providerId).stop();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'All generations interrupted' }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
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
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, conversation_id: body.conversation_id, title, provider: providerId }));
  } catch (err) {
    res.writeHead(err.statusCode || 500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// 🌐 Static Assets Serving
async function handleStatic(pathname, res) {
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
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
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
      path.join(process.env.HOME || '/data/data/com.termux/files/home', 'GEMINI.md'),
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
    const homeDir = process.env.HOME || '/data/data/com.termux/files/home';
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

// 🌐 HTTP Server Request Dispatcher
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin && /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (req.method === 'GET') {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/conversations' && req.method === 'GET') {
    return handleProviderConversations(parsedUrl, res);
  } else if (pathname === '/api/history' && req.method === 'GET') {
    return handleProviderHistory(parsedUrl, res);
  } else if (pathname === '/api/conversation' && req.method === 'DELETE') {
    return handleProviderDelete(parsedUrl, res);
  } else if (pathname === '/api/chat' && req.method === 'POST') {
    return handleChat(req, res);
  } else if (pathname === '/api/stop' && req.method === 'POST') {
    return handleStop(req, res);
  } else if (pathname === '/api/upload' && req.method === 'POST') {
    return handleUpload(req, res);
  } else if (pathname === '/api/run-code' && req.method === 'POST') {
    return handleRunCode(req, res);
  } else if (pathname === '/api/generate-title' && req.method === 'POST') {
    return handleGenerateTitle(req, res);
  } else if (pathname === '/api/compact' && req.method === 'POST') {
    return handleProviderCompact(req, res);
  } else if (pathname === '/api/codex/compact' && req.method === 'POST') {
    return handleProviderCompact(req, res, 'codex');
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
    await getProvider(providerId).prewarm(body.model, body.effort);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ success: true, prewarmed: true, provider: providerId }));
  } else if (pathname === '/api/rename-conversation' && req.method === 'POST') {
    return handleProviderRename(req, res);
  } else if (pathname === '/api/models' && req.method === 'GET') {
    return handleGetModels(res);
  } else if (pathname === '/api/providers' && req.method === 'GET') {
    return handleGetProviders(res);
  } else if (pathname === '/api/session-status' && req.method === 'GET') {
    return handleSessionStatus(parsedUrl, res);
  } else if (pathname === '/api/usage' && req.method === 'GET') {
    return handleUsage(res);
  } else if (pathname === '/api/files' && req.method === 'GET') {
    return handleListFiles(parsedUrl, res);
  } else if (pathname === '/api/file/read' && req.method === 'GET') {
    return handleReadFile(parsedUrl, res);
  } else if (pathname === '/api/file/save' && req.method === 'POST') {
    return handleSaveFile(req, res);
  } else if (pathname === '/api/image' && req.method === 'GET') {
    return handleImageProxy(parsedUrl, res);
  } else if (pathname === '/api/export-extension' && req.method === 'POST') {
    return handleExportExtension(req, res);
  } else if (pathname === '/api/inbound-message') {
    return handleInboundMessage(req, res);
  } else if (pathname.startsWith('/api/extension/')) {
    return extensionBridge.handle(req, res, pathname);
  } else if (pathname === '/api/phone/status' && req.method === 'GET') {
    return handlePhoneStatus(res);
  } else if (pathname === '/api/phone/connect' && req.method === 'POST') {
    return handlePhoneConnect(req, res);
  } else if (pathname === '/api/phone/pair' && req.method === 'POST') {
    return handlePhonePair(req, res);
  } else if (pathname === '/api/phone/screenshot' && req.method === 'POST') {
    return handlePhoneScreenshot(res);
  } else if (pathname === '/api/phone/photo') {
    return handlePhonePhoto(req, res);
  } else if (pathname === '/api/phone/action' && req.method === 'POST') {
    return handlePhoneAction(req, res);
  } else if (pathname === '/api/phone/nodes' && req.method === 'GET') {
    const nodesResult = await phoneAgent.getNodes();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(nodesResult));
  } else if (pathname === '/api/guidelines' && req.method === 'GET') {
    return handleGetGuidelines(res);
  } else if (pathname === '/api/guidelines/sync' && req.method === 'POST') {
    return handleSyncGuidelines(req, res);
  } else {
    return handleStatic(pathname, res);
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
  console.log(`=================================================`);
  
  // 🔥 Pre-warm standby resident process immediately on server boot
  setTimeout(() => {
    sessionManager.prewarm('gemini-3.7-flash-low');
  }, 1000);
});
