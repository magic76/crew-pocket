const http = require('node:http');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const url = require('node:url');

const {
  PORT,
  HOST,
  PUBLIC_DIR,
  UPLOADS_DIR,
  BRAIN_DIR,
  MIME_TYPES,
  AVAILABLE_MODELS,
  parseJsonBody
} = require('./lib/config');

const { sessionManager } = require('./lib/session');
const { handleListConversations, handleGetHistory, handleDeleteConversation } = require('./lib/history');
const { handleRunCode } = require('./lib/sandbox');
const { handleUsage } = require('./lib/usage');
const { handleListFiles, handleReadFile } = require('./lib/files');
const { handleGenerateTitle, getCachedTitle } = require('./lib/title');

// 🤖 List Available Models
function handleGetModels(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ models: AVAILABLE_MODELS }));
}

// 🖼️ Safe Image Proxy Handler (Directory Whitelisted)
async function handleImageProxy(parsedUrl, res) {
  const imgPath = parsedUrl.query.path;
  if (!imgPath) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Image not found');
  }

  const HOME_DIR = '/data/data/com.termux/files/home';
  const isAllowed = resolvedPath.startsWith(UPLOADS_DIR) ||
                    resolvedPath.startsWith(BRAIN_DIR) ||
                    resolvedPath.startsWith(HOME_DIR) ||
                    resolvedPath.startsWith('/sdcard') ||
                    resolvedPath.startsWith('/storage');

  if (!isAllowed) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    return res.end('Forbidden');
  }

  if (!fs.existsSync(resolvedPath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Image not found');
  }

  const ext = path.extname(resolvedPath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
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

// 🎨 Set Active App Icon (Copies chosen icon to icon.jpg, icon-192.jpg, icon-512.jpg)
async function handleSetIcon(req, res) {
  try {
    const body = await parseJsonBody(req);
    const { icon } = body;
    const validIcons = {
      quantum: 'icon_quantum.jpg',
      geometric: 'icon_geometric_ag.jpg',
      holographic: 'icon_holographic.jpg'
    };

    const targetFile = validIcons[icon];
    if (!targetFile) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid icon identifier' }));
    }

    const srcPath = path.join(PUBLIC_DIR, 'icons', targetFile);
    if (!fs.existsSync(srcPath)) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Source icon file not found' }));
    }

    const destMain = path.join(PUBLIC_DIR, 'icon.jpg');
    const dest192 = path.join(PUBLIC_DIR, 'icon-192.jpg');
    const dest512 = path.join(PUBLIC_DIR, 'icon-512.jpg');

    await fsPromises.copyFile(srcPath, destMain);
    await fsPromises.copyFile(srcPath, dest192);
    await fsPromises.copyFile(srcPath, dest512);

    console.log(`[Icon] Successfully applied ${icon} as active App Icon.`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, icon }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
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

  const { prompt, conversation_id, image_path, model } = body;
  if (!prompt && !image_path) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Prompt or image is required' }));
  }

  let finalPrompt = prompt || 'Analyze this image';

  // 🏷️ System environment anchor for Crew Pocket (injected on first turn of new conversations)
  if (!conversation_id) {
    const systemContext = `[Context: You are interacting with the user inside "Crew Pocket (口袋特勤隊)", a flagship mobile AI assistant running locally on Android Termux. When the user mentions "Crew Pocket" or "這個 App", they mean this exact assistant. Proactively leverage Crew Pocket's built-in superpowers: HTML/SVG live sandbox, Chart.js visualization, GPS Google Maps navigation cards, camera vision/voice, Termux code execution, /btw note cards, and local files explorer. Do NOT search the web for external third-party tools.]\n`;
    finalPrompt = `${systemContext}\n${finalPrompt}`;
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

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const session = await sessionManager.getOrCreateSession(conversation_id, model);
    session.isBusy = true;

    sendEvent('init', { conversation_id: session.conversationId, model: session.model });

    let fullResponse = '';

    const onEvent = (item) => {
      if (item.event === 'step_update' && item.step_update) {
        const su = item.step_update;
        if (su.step_type === 'agent_response' && su.text_delta) {
          fullResponse += su.text_delta;
          sendEvent('chunk', { delta: su.text_delta, accumulated: fullResponse });
        } else if (su.step_type === 'thought' || su.thinking_delta || su.thinking) {
          const tDelta = su.thinking_delta || su.thinking || su.text || '';
          if (tDelta) sendEvent('thought', { delta: tDelta });
        } else if (su.step_type === 'tool') {
          sendEvent('tool', {
            state: su.state,
            tool_name: su.tool_name,
            tool_info: su.tool_info,
            duration_seconds: su.duration_seconds
          });
        }
      } else if (item.event === 'result' && item.result) {
        if (item.result.conversation_id) session.conversationId = item.result.conversation_id;
        if (item.result.thinking) sendEvent('thought', { fullThinking: item.result.thinking });
        if (item.result.response && !fullResponse) fullResponse = item.result.response;

        sendEvent('done', {
          response: fullResponse,
          conversation_id: session.conversationId,
          status: item.result.status
        });

        cleanup();
        res.end();
      }
    };

    const onRaw = (line) => {
      fullResponse += line + '\n';
      sendEvent('chunk', { delta: line + '\n', accumulated: fullResponse });
    };

    const onClose = (code) => {
      sendEvent('done', { error: `agy process crashed or closed with code ${code}` });
      cleanup();
      res.end();
    };

    session.emitter.on('event', onEvent);
    session.emitter.on('raw', onRaw);
    if (session.process) session.process.on('close', onClose);

    function cleanup() {
      if (session) {
        session.isBusy = false;
        session.emitter.removeListener('event', onEvent);
        session.emitter.removeListener('raw', onRaw);
        if (session.process) session.process.removeListener('close', onClose);
        sessionManager.resetIdleTimer(session);
      }
    }

    req.on('close', () => {
      if (session && session.isBusy) {
        console.log(`[Chat Aborted] Client closed connection while session was busy. Stopping session: ${session.conversationId}`);
        sessionManager.closeSession(session.conversationId);
      }
      cleanup();
    });

    const payload = {
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: finalPrompt }]
      }
    };

    console.log(`[Resident Pipe] Pushing turn to active session (${session.conversationId})...`);
    session.process.stdin.write(JSON.stringify(payload) + '\n');

  } catch (err) {
    console.error('[Chat Error]', err);
    sendEvent('done', { error: err.message });
    res.end();
  }
}

// 🛑 Abort Active Generation
async function handleStop(req, res) {
  try {
    console.log('[Stop Request] Aborting all active generation sessions...');
    sessionManager.closeActiveSession();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, message: 'All generations interrupted' }));
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
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
// ==========================================
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
    return handleListConversations(res);
  } else if (pathname === '/api/history' && req.method === 'GET') {
    return handleGetHistory(parsedUrl, res);
  } else if (pathname === '/api/conversation' && req.method === 'DELETE') {
    return handleDeleteConversation(parsedUrl, res);
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
  } else if (pathname === '/api/set-icon' && req.method === 'POST') {
    return handleSetIcon(req, res);
  } else if (pathname === '/api/models' && req.method === 'GET') {
    return handleGetModels(res);
  } else if (pathname === '/api/usage' && req.method === 'GET') {
    return handleUsage(res);
  } else if (pathname === '/api/files' && req.method === 'GET') {
    return handleListFiles(parsedUrl, res);
  } else if (pathname === '/api/file/read' && req.method === 'GET') {
    return handleReadFile(parsedUrl, res);
  } else if (pathname === '/api/image' && req.method === 'GET') {
    return handleImageProxy(parsedUrl, res);
  } else {
    return handleStatic(pathname, res);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`=================================================`);
  console.log(`🚀 Crew Pocket Web UI (Resident Pipe) at: http://${HOST}:${PORT}`);
  console.log(`=================================================`);
});
