const crypto = require('node:crypto');
const url = require('node:url');
const { parseJsonBody } = require('./config');
const { authorizeWebSocket } = require('./http-security');

const MAX_CAPTURED_API_BODY_BYTES = 64 * 1024;
const CAPTURED_API_RESPONSE_TTL_MS = 2 * 60 * 1000;
const SENSITIVE_RESPONSE_KEY = /token|secret|password|authorization|cookie|csrf|api[_-]?key|signature|private[_-]?key|session|email|phone|mobile|user[_-]?id|account[_-]?id/i;
const wsFrameStates = new WeakMap();
const MAX_EXTENSION_WS_FRAME_BYTES = 1024 * 1024;

function redactApiResponseValue(value, depth = 0) {
  if (depth > 20) return '[DEPTH_LIMIT]';
  if (typeof value === 'string') {
    return value
      .replace(/\bBearer\s+[^\s,"}]+/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:access_token|refresh_token|token|api[_-]?key|client_secret|app_secret|signature)=)[^&#\s"<>]+/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.slice(0, 200).map(item => redactApiResponseValue(item, depth + 1));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value).slice(0, 300)) {
      output[key] = SENSITIVE_RESPONSE_KEY.test(key) ? '[REDACTED]' : redactApiResponseValue(item, depth + 1);
    }
    return output;
  }
  return value;
}

function sanitizeCapturedApiResponse(payload = {}) {
  const captureId = String(payload.captureId || '');
  if (!/^[a-f0-9-]{20,64}$/i.test(captureId)) return null;

  let safeUrl = '';
  try {
    const parsed = new URL(String(payload.url || ''));
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    parsed.username = '';
    parsed.password = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_RESPONSE_KEY.test(key)) parsed.searchParams.delete(key);
    }
    safeUrl = (parsed.origin + parsed.pathname + parsed.search).slice(0, 2000);
  } catch (_) {
    return null;
  }

  let pageUrl = '';
  try {
    const parsedPageUrl = new URL(String(payload.pageUrl || ''));
    if (['http:', 'https:'].includes(parsedPageUrl.protocol)) {
      parsedPageUrl.username = '';
      parsedPageUrl.password = '';
      parsedPageUrl.search = '';
      parsedPageUrl.hash = '';
      pageUrl = (parsedPageUrl.origin + parsedPageUrl.pathname).slice(0, 1200);
    }
  } catch (_) {}

  const allowedErrors = new Set(['RESPONSE_TOO_LARGE', 'UNSUPPORTED_RESPONSE_TYPE', 'INVALID_JSON_RESPONSE', 'NON_JSON_RESPONSE']);
  const error = allowedErrors.has(String(payload.error || '')) ? String(payload.error) : null;
  let body = null;
  let bodyBytes = 0;
  if (typeof payload.body === 'string') {
    if (Buffer.byteLength(payload.body, 'utf8') > MAX_CAPTURED_API_BODY_BYTES) return null;
    try {
      body = JSON.stringify(redactApiResponseValue(JSON.parse(payload.body)));
    } catch (_) {
      return null;
    }
    bodyBytes = Buffer.byteLength(body, 'utf8');
    if (bodyBytes > MAX_CAPTURED_API_BODY_BYTES) return null;
  }
  if (body === null && !error) return null;

  let requestBody = null;
  let requestBodyBytes = 0;
  if (typeof payload.requestBody === 'string' && Buffer.byteLength(payload.requestBody, 'utf8') <= MAX_CAPTURED_API_BODY_BYTES) {
    try {
      requestBody = JSON.stringify(redactApiResponseValue(JSON.parse(payload.requestBody)));
      requestBodyBytes = Buffer.byteLength(requestBody, 'utf8');
      if (requestBodyBytes > MAX_CAPTURED_API_BODY_BYTES) {
        requestBody = null;
        requestBodyBytes = 0;
      }
    } catch (_) {}
  }

  const status = Number(payload.status);
  return {
    captureId,
    url: safeUrl,
    pageUrl,
    tabId: Number.isInteger(payload.tabId) && payload.tabId >= 0 ? payload.tabId : null,
    method: String(payload.method || 'GET').toUpperCase().slice(0, 12),
    status: Number.isFinite(status) && status >= 0 && status <= 599 ? Math.trunc(status) : 0,
    contentType: String(payload.contentType || '').slice(0, 120),
    evidenceLevel: 'runtime-response',
    requestBody,
    requestBodyBytes,
    body,
    bodyBytes,
    error,
    redacted: true,
    capturedAt: Number(payload.capturedAt) || Date.now()
  };
}

function isLoopbackAddress(address = '') {
  const value = String(address || '').toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === '[::1]' || value === '::ffff:127.0.0.1';
}

function createExtensionBridge({ onInboundMessage }) {
  let extensionSocket = null;
  const collectedLogs = [];
  const apiRecords = [];
  const capturedApiResponses = [];
  const userMessages = [];
  const pendingCommands = new Map();
  let commandCounter = 1;
  let latestSnapshot = null;

  const remember = (list, item, max = 300) => {
    list.push(item);
    if (list.length > max) list.shift();
  };

  function pruneCapturedApiResponses() {
    const cutoff = Date.now() - CAPTURED_API_RESPONSE_TTL_MS;
    for (let index = capturedApiResponses.length - 1; index >= 0; index--) {
      if (capturedApiResponses[index].capturedAt < cutoff) capturedApiResponses.splice(index, 1);
    }
  }

  function normalizedDebugPageUrl(value) {
    try {
      const parsed = new URL(String(value || ''));
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return parsed.origin + parsed.pathname;
    } catch (_) {
      return null;
    }
  }

  function sanitizeDebugUrl(value) {
    try {
      const parsed = new URL(String(value || ''));
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      parsed.username = '';
      parsed.password = '';
      parsed.search = '';
      parsed.hash = '';
      return (parsed.origin + parsed.pathname).slice(0, 1200);
    } catch (_) {
      return '';
    }
  }

  function boundDebugValue(value, key = '', depth = 0) {
    if (/token|secret|password|authorization|cookie|csrf|api[_-]?key|signature|private[_-]?key|session|email|phone|mobile|user[_-]?id|account[_-]?id/i.test(key)) return '[REDACTED]';
    if (depth > 8) return '[DEPTH_LIMIT]';
    if (typeof value === 'string') {
      const safe = redactApiResponseValue(value);
      return key === 'url' || key === 'pageUrl' ? sanitizeDebugUrl(safe) : String(safe).slice(0, 1600);
    }
    if (Array.isArray(value)) return value.slice(0, 30).map(item => boundDebugValue(item, '', depth + 1));
    if (value && typeof value === 'object') {
      const output = {};
      for (const [childKey, childValue] of Object.entries(value).slice(0, 80)) {
        output[childKey] = boundDebugValue(childValue, childKey, depth + 1);
      }
      return output;
    }
    return value;
  }

  function getDebugContext(pageUrl, requestedTabId = null) {
    const pageKey = normalizedDebugPageUrl(pageUrl);
    if (!pageKey) throw new Error('A valid HTTP or HTTPS page URL is required');
    const pageOrigin = new URL(pageKey).origin;
    const matchesPage = item => normalizedDebugPageUrl(item?.url || item?.payload?.pageUrl || item?.payload?.url) === pageKey;
    const activeTabId = Number.isInteger(requestedTabId) ? requestedTabId
      : matchesPage({ url: latestSnapshot?.url }) && Number.isInteger(latestSnapshot?.tabId) ? latestSnapshot.tabId : null;
    const snapshotMatchesTab = activeTabId === null || latestSnapshot?.tabId === activeTabId;
    const snapshot = snapshotMatchesTab && matchesPage({ url: latestSnapshot?.url }) ? boundDebugValue(latestSnapshot) : null;
    const logs = collectedLogs.filter(item => {
      const itemTabId = Number.isInteger(item?.tabId) ? item.tabId : item?.payload?.tabId;
      if (activeTabId !== null && Number.isInteger(itemTabId) && itemTabId !== activeTabId) return false;
      if (matchesPage(item)) return true;
      if (item?.type === 'API_RESPONSE_CAPTURED') {
        return normalizedDebugPageUrl(item.payload?.pageUrl) === pageKey
          && (activeTabId === null || item.payload?.tabId === activeTabId);
      }
      return false;
    }).slice(-20).map(item => boundDebugValue(item));
    const apis = apiRecords.filter(item => {
      if (activeTabId !== null) return item.tabId === activeTabId;
      try { return new URL(item.url).origin === pageOrigin; } catch (_) { return false; }
    }).slice(-20).map(item => ({
      url: sanitizeDebugUrl(item.url),
      method: String(item.method || 'GET').toUpperCase().slice(0, 12),
      statusCode: Number(item.statusCode) || 0,
      statusLine: String(item.statusLine || '').slice(0, 120),
      type: String(item.type || '').slice(0, 40),
      evidenceLevel: 'runtime-metadata',
      timestamp: Number(item.timestamp) || 0
    }));
    return {
      pageUrl: pageKey,
      evidenceLevel: 'extension-runtime-context',
      snapshot,
      runtimeApis: apis,
      logs,
      capturedApiResponsesAvailable: capturedApiResponses.filter(item => normalizedDebugPageUrl(item.pageUrl) === pageKey
        && (activeTabId === null || item.tabId === activeTabId)).length
    };
  }

  function readLatestCapturedApiResponse(pageUrl, requestedTabId = null) {
    const pageKey = normalizedDebugPageUrl(pageUrl);
    if (!pageKey) throw new Error('A valid HTTP or HTTPS page URL is required');
    pruneCapturedApiResponses();
    for (let index = capturedApiResponses.length - 1; index >= 0; index--) {
      const candidate = capturedApiResponses[index];
      const matches = normalizedDebugPageUrl(candidate.pageUrl) === pageKey
        && (!Number.isInteger(requestedTabId) || candidate.tabId === requestedTabId);
      if (!matches) continue;
      const [captured] = capturedApiResponses.splice(index, 1);
      return boundDebugValue(captured);
    }
    return null;
  }

  function executeCommand(command, timeoutMs = 8000) {
    if (!extensionSocket) {
      const error = new Error('Extension not connected');
      error.code = 'EXTENSION_DISCONNECTED';
      return Promise.reject(error);
    }
    const id = `cmd_${commandCounter++}`;
    const payload = { ...command, id };
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!pendingCommands.has(id)) return;
        pendingCommands.delete(id);
        const error = new Error('Command timeout');
        error.code = 'EXTENSION_COMMAND_TIMEOUT';
        reject(error);
      }, Math.max(1000, Math.min(30000, Number(timeoutMs) || 8000)));
      pendingCommands.set(id, (response) => {
        clearTimeout(timeout);
        resolve(response);
      });
      try {
        sendWsMessage(extensionSocket, JSON.stringify(payload));
      } catch (error) {
        clearTimeout(timeout);
        pendingCommands.delete(id);
        reject(error);
      }
    });
  }

  function handle(req, res, pathname) {
    if (pathname === '/api/extension/status' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'RUNNING', connected: extensionSocket !== null, totalLogs: collectedLogs.length, totalApis: apiRecords.length, totalUserMessages: userMessages.length, timestamp: Date.now() }));
    }
    if (pathname === '/api/extension/messages' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ total: userMessages.length, messages: userMessages.slice(-20) }));
    }
    if (pathname === '/api/extension/apis' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ total: apiRecords.length, recent: apiRecords.slice(-50) }));
    }
    if (pathname === '/api/extension/api-response' && req.method === 'GET') {
      if (!isLoopbackAddress(req.socket?.remoteAddress || '')) {
        res.writeHead(403, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ success: false, error: 'Captured API responses are available only to local clients' }));
      }
      const captureId = String(url.parse(req.url, true).query.captureId || '');
      if (!/^[a-f0-9-]{20,64}$/i.test(captureId)) {
        res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ success: false, error: 'A valid captureId is required' }));
      }
      pruneCapturedApiResponses();
      const index = capturedApiResponses.findIndex(item => item.captureId === captureId);
      if (index < 0) {
        res.writeHead(404, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify({ success: false, ready: false, error: 'Response is not ready or has expired' }));
      }
      const [captured] = capturedApiResponses.splice(index, 1);
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return res.end(JSON.stringify({ success: true, ...captured }));
    }
    if (pathname === '/api/extension/snapshot' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(latestSnapshot || { status: 'NO_SNAPSHOT_YET' }));
    }
    if (pathname === '/api/extension/logs' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(collectedLogs.slice(-50)));
    }
    if (pathname === '/api/extension/command' && req.method === 'POST') {
      return parseJsonBody(req).then((command) => {
        return executeCommand(command).then((response) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        });
      }).catch((err) => {
        const statusCode = err.code === 'EXTENSION_DISCONNECTED' ? 503
          : err.code === 'EXTENSION_COMMAND_TIMEOUT' ? 504 : 400;
        res.writeHead(statusCode, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      });
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unknown extension endpoint' }));
  }

  function attach(server) {
    server.on('upgrade', (req, socket) => {
      const parsedUrl = url.parse(req.url, true);
      if (parsedUrl.pathname !== '/api/extension/ws') return socket.destroy();
      const authorization = authorizeWebSocket(req, parsedUrl);
      if (!authorization.ok) {
        const statusCode = authorization.statusCode || 403;
        const statusText = statusCode === 401 ? 'Unauthorized' : 'Forbidden';
        const message = authorization.error || statusText;
        socket.write(`HTTP/1.1 ${statusCode} ${statusText}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
        socket.destroy();
        return;
      }
      const key = req.headers['sec-websocket-key'];
      if (!key) return socket.destroy();
      const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      socket.write(['HTTP/1.1 101 Switching Protocols', 'Upgrade: websocket', 'Connection: Upgrade', `Sec-WebSocket-Accept: ${accept}`].join('\r\n') + '\r\n\r\n');
      extensionSocket = socket;
      console.log('⚡ [Extension Bridge] Browser extension connected');
      socket.on('data', (buffer) => handleWsFrame(socket, buffer, (text) => { try { handleMessage(JSON.parse(text), socket); } catch (_) {} }));
      socket.on('close', () => { if (extensionSocket === socket) extensionSocket = null; });
      socket.on('error', () => { if (extensionSocket === socket) extensionSocket = null; });
    });
  }

  function handleMessage(message, socket) {
    if (message.responseTo && pendingCommands.has(message.responseTo)) {
      const resolve = pendingCommands.get(message.responseTo);
      pendingCommands.delete(message.responseTo);
      return resolve(message);
    }
    if (message.type === 'CLIENT_HEARTBEAT') return;
    if (message.type === 'USER_DIRECT_MESSAGE' && message.payload && message.payload.text) {
      const payload = { ...message.payload, source: 'BrowserExtension' };
      const clientMessageId = String(message.clientMessageId || payload.clientMessageId || '').slice(0, 80);
      if (clientMessageId) payload.clientMessageId = clientMessageId;
      const inboundMessage = onInboundMessage(payload);
      if (!inboundMessage) {
        if (clientMessageId) sendWsMessage(socket, JSON.stringify({ type: 'USER_DIRECT_MESSAGE_REJECTED', clientMessageId, error: '訊息不可為空' }));
        return;
      }
      remember(userMessages, { ...payload, receivedAt: Date.now() }, 50);
      if (clientMessageId) {
        sendWsMessage(socket, JSON.stringify({
          type: 'USER_DIRECT_MESSAGE_ACK',
          clientMessageId,
          inboundId: inboundMessage.id,
          receivedAt: inboundMessage.received_at || Date.now()
        }));
      }
      return;
    }
    if (message.type === 'PAGE_SNAPSHOT') latestSnapshot = {
      ...(message.payload && typeof message.payload === 'object' ? message.payload : {}),
      ...(Number.isInteger(message.tabId) ? { tabId: message.tabId } : {})
    };
    if (message.type === 'API_RESPONSE' || message.type === 'API_ERROR') {
      remember(apiRecords, {
        ...message.payload,
        eventType: message.type,
        evidenceLevel: 'runtime-metadata',
        timestamp: Number(message.timestamp) || Date.now()
      });
    }
    if (message.type === 'API_RESPONSE_CAPTURED') {
      pruneCapturedApiResponses();
      const captured = sanitizeCapturedApiResponse(message.payload);
      if (captured) {
        remember(capturedApiResponses, captured, 5);
        remember(collectedLogs, {
          source: 'CREW_POCKET_NETWORK',
          type: 'API_RESPONSE_CAPTURED',
          timestamp: captured.capturedAt,
          payload: {
            captureId: captured.captureId,
            url: captured.url,
            method: captured.method,
            status: captured.status,
            contentType: captured.contentType,
            pageUrl: captured.pageUrl,
            tabId: captured.tabId,
            requestBodyBytes: captured.requestBodyBytes,
            bodyBytes: captured.bodyBytes,
            evidenceLevel: captured.evidenceLevel,
            redacted: true,
            error: captured.error
          }
        });
      }
      return;
    }
    remember(collectedLogs, message);
  }

  return { attach, handle, executeCommand, getDebugContext, readLatestCapturedApiResponse };
}

function sendWsMessage(socket, text) {
  const payload = Buffer.from(text, 'utf8');
  let header;
  if (payload.length <= 125) header = Buffer.from([0x81, payload.length]);
  else if (payload.length <= 65535) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2); }
  socket.write(Buffer.concat([header, payload]));
}

function handleWsFrame(socket, chunk, onMessage) {
  const state = wsFrameStates.get(socket) || { buffer: Buffer.alloc(0), fragments: [], fragmentBytes: 0 };
  state.buffer = state.buffer.length ? Buffer.concat([state.buffer, chunk]) : chunk;
  let offset = 0;

  while (offset + 2 <= state.buffer.length) {
    const first = state.buffer[offset];
    const second = state.buffer[offset + 1];
    const finalFrame = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (offset + 4 > state.buffer.length) break;
      length = state.buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > state.buffer.length) break;
      const wideLength = state.buffer.readBigUInt64BE(offset + 2);
      if (wideLength > BigInt(MAX_EXTENSION_WS_FRAME_BYTES)) {
        wsFrameStates.delete(socket);
        socket.destroy();
        return;
      }
      length = Number(wideLength);
      headerLength = 10;
    }

    if (length > MAX_EXTENSION_WS_FRAME_BYTES) {
      wsFrameStates.delete(socket);
      socket.destroy();
      return;
    }
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + length;
    if (offset + frameLength > state.buffer.length) break;

    let payloadStart = offset + headerLength;
    let payload;
    if (masked) {
      const mask = state.buffer.subarray(payloadStart, payloadStart + 4);
      payloadStart += 4;
      payload = Buffer.from(state.buffer.subarray(payloadStart, payloadStart + length));
      for (let index = 0; index < payload.length; index++) payload[index] ^= mask[index % 4];
    } else {
      payload = state.buffer.subarray(payloadStart, payloadStart + length);
    }

    if (opcode === 1) {
      state.fragments = finalFrame ? [] : [payload];
      state.fragmentBytes = finalFrame ? 0 : payload.length;
      if (finalFrame) onMessage(payload.toString('utf8'));
    } else if (opcode === 0 && state.fragments.length) {
      state.fragmentBytes += payload.length;
      if (state.fragmentBytes > MAX_EXTENSION_WS_FRAME_BYTES) {
        wsFrameStates.delete(socket);
        socket.destroy();
        return;
      }
      state.fragments.push(payload);
      if (finalFrame) {
        onMessage(Buffer.concat(state.fragments, state.fragmentBytes).toString('utf8'));
        state.fragments = [];
        state.fragmentBytes = 0;
      }
    } else if (opcode === 8) {
      wsFrameStates.delete(socket);
      socket.end();
      return;
    }

    offset += frameLength;
  }

  state.buffer = state.buffer.subarray(offset);
  if (state.buffer.length > MAX_EXTENSION_WS_FRAME_BYTES) {
    wsFrameStates.delete(socket);
    socket.destroy();
    return;
  }
  wsFrameStates.set(socket, state);
}

module.exports = { createExtensionBridge };
