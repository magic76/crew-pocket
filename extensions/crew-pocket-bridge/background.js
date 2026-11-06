// Crew Pocket Background Service Worker with Full Network API Interceptor
const BRIDGE_WS_URL = 'ws://127.0.0.1:8000/api/extension/ws';
const USER_MESSAGE_OUTBOX_KEY = 'crewPocketBridgeUserMessageOutbox';
const MAX_USER_MESSAGE_OUTBOX = 100;
const USER_MESSAGE_RETRY_MS = 15 * 1000;
const BRIDGE_RETRY_ALARM = 'crew-pocket-bridge-retry';
const BRIDGE_HEARTBEAT_MS = 20 * 1000;
const PAGE_HTTP_STATUS_KEY_PREFIX = 'crewPocketBridgePageHttpStatus:';
const PAGE_HTTP_STATUS_TTL_MS = 5 * 60 * 1000;
const PAGE_JS_DEBUG_KEY_PREFIX = 'crewPocketBridgePageJsDebug:';
const PAGE_JS_DEBUG_TTL_MS = 5 * 60 * 1000;
const PAGE_JS_DEBUG_MAX_RUNS = 20;
const PAGE_JS_DEBUG_MAX_CODE_LENGTH = 8 * 1024;
const SENSITIVE_URL_KEY = /token|secret|password|auth|cookie|csrf|api[_-]?key|signature|session|email|phone|mobile|user[_-]?id|account[_-]?id/i;
let ws = null;
let reconnectTimer = null;
let bridgeHeartbeatTimer = null;
let userMessageRetryTimer = null;
let userMessageOutbox = [];
let userMessageOutboxLoad = null;
let userMessageOutboxMutation = Promise.resolve();
let flushingUserMessages = false;
const apiBuffer = [];
const pendingApiCaptures = new Map();
const activeDebugExecutions = new Set();
const MAX_API_CAPTURE_BYTES = 64 * 1024;
const MAX_API_CAPTURE_MS = 60 * 1000;

function storageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(result?.[key]);
    });
  });
}

function storageSet(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function storageRemove(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(key, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}

function sanitizeObservedUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.username = '';
    parsed.password = '';
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_URL_KEY.test(key)) parsed.searchParams.delete(key);
    }
    return (parsed.origin + parsed.pathname + parsed.search).slice(0, 2000);
  } catch (_) {
    return '';
  }
}

function pageHttpStatusStorageKey(tabId) {
  return `${PAGE_HTTP_STATUS_KEY_PREFIX}${Number(tabId)}`;
}

function pageJsDebugStorageKey(tabId) {
  return `${PAGE_JS_DEBUG_KEY_PREFIX}${Number(tabId)}`;
}

function ensureUserMessageOutboxLoaded() {
  if (!userMessageOutboxLoad) {
    userMessageOutboxLoad = storageGet(USER_MESSAGE_OUTBOX_KEY).then((items) => {
      userMessageOutbox = Array.isArray(items)
        ? items.filter((item) => item && typeof item.clientMessageId === 'string' && item.payload && typeof item.payload.text === 'string')
          .slice(-MAX_USER_MESSAGE_OUTBOX)
          .map((item) => ({
            clientMessageId: item.clientMessageId.slice(0, 80),
            payload: item.payload,
            tabId: Number.isInteger(item.tabId) ? item.tabId : null,
            frameId: Number.isInteger(item.frameId) ? item.frameId : 0,
            queuedAt: Number(item.queuedAt) || Date.now(),
            lastSentAt: Number(item.lastSentAt) || 0,
            attempts: Math.max(0, Number(item.attempts) || 0)
          }))
        : [];
      return userMessageOutbox;
    }).catch((error) => {
      userMessageOutboxLoad = null;
      throw error;
    });
  }
  return userMessageOutboxLoad;
}

function mutateUserMessageOutbox(operation) {
  const pending = userMessageOutboxMutation.then(operation, operation);
  userMessageOutboxMutation = pending.catch(() => {});
  return pending;
}

function sendUserMessageStatus(entry, status, details = {}) {
  if (!Number.isInteger(entry?.tabId)) return;
  try {
    chrome.tabs.sendMessage(entry.tabId, {
      type: 'USER_DIRECT_MESSAGE_STATUS',
      clientMessageId: entry.clientMessageId,
      status,
      ...details
    }, { frameId: entry.frameId }, () => { void chrome.runtime.lastError; });
  } catch (_) {}
}

async function enqueueUserMessage(message, sender) {
  const source = message?.payload && typeof message.payload === 'object' ? message.payload : {};
  const text = String(source.text || '').trim();
  if (!text) throw new Error('訊息不可為空');

  const clientMessageId = String(source.clientMessageId || '').slice(0, 80);
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(clientMessageId)) throw new Error('訊息識別碼無效');

  const payload = {
    clientMessageId,
    text,
    url: String(source.url || message.url || '').slice(0, 4000),
    title: String(source.title || '').slice(0, 500),
    lastError: String(source.lastError || '').slice(0, 2000),
    timestamp: Number(source.timestamp || message.timestamp) || Date.now()
  };
  await ensureUserMessageOutboxLoaded();

  return mutateUserMessageOutbox(async () => {
    const existing = userMessageOutbox.find((item) => item.clientMessageId === clientMessageId);
    if (existing) return { status: 'QUEUED', clientMessageId };
    if (userMessageOutbox.length >= MAX_USER_MESSAGE_OUTBOX) throw new Error('本機待送佇列已滿，請先連上 Crew Pocket 後再試');

    const entry = {
      clientMessageId,
      payload,
      tabId: Number.isInteger(sender?.tab?.id) ? sender.tab.id : null,
      frameId: Number.isInteger(sender?.frameId) ? sender.frameId : 0,
      queuedAt: Date.now(),
      lastSentAt: 0,
      attempts: 0
    };
    const next = [...userMessageOutbox, entry];
    await storageSet({ [USER_MESSAGE_OUTBOX_KEY]: next });
    userMessageOutbox = next;
    return { status: 'QUEUED', clientMessageId };
  });
}

async function recordUserMessageAttempt(clientMessageId, at) {
  return mutateUserMessageOutbox(async () => {
    const index = userMessageOutbox.findIndex((item) => item.clientMessageId === clientMessageId);
    if (index < 0) return null;
    const next = [...userMessageOutbox];
    next[index] = { ...next[index], lastSentAt: at, attempts: next[index].attempts + 1 };
    await storageSet({ [USER_MESSAGE_OUTBOX_KEY]: next });
    userMessageOutbox = next;
    return next[index];
  });
}

async function settleUserMessage(message, status) {
  const clientMessageId = String(message?.clientMessageId || '').slice(0, 80);
  if (!clientMessageId) return;
  await ensureUserMessageOutboxLoaded();

  const entry = await mutateUserMessageOutbox(async () => {
    const existing = userMessageOutbox.find((item) => item.clientMessageId === clientMessageId);
    if (!existing) return null;
    const next = userMessageOutbox.filter((item) => item.clientMessageId !== clientMessageId);
    await storageSet({ [USER_MESSAGE_OUTBOX_KEY]: next });
    userMessageOutbox = next;
    return existing;
  });

  if (!entry) return;
  if (status === 'DELIVERED') {
    sendUserMessageStatus(entry, status, { inboundId: String(message.inboundId || '') });
  } else {
    sendUserMessageStatus(entry, 'FAILED', { error: String(message.error || 'Crew Pocket 拒收了訊息').slice(0, 240) });
  }
  if (userMessageOutbox.length === 0 && userMessageRetryTimer) {
    clearTimeout(userMessageRetryTimer);
    userMessageRetryTimer = null;
  } else if (userMessageOutbox.length > 0) {
    void flushUserMessageOutbox();
  }
}

function scheduleUserMessageRetry(delay = USER_MESSAGE_RETRY_MS) {
  if (userMessageRetryTimer) clearTimeout(userMessageRetryTimer);
  userMessageRetryTimer = setTimeout(() => {
    userMessageRetryTimer = null;
    void flushUserMessageOutbox();
  }, Math.max(1000, delay));
}

async function flushUserMessageOutbox() {
  if (flushingUserMessages) return;
  try {
    await ensureUserMessageOutboxLoaded();
  } catch (error) {
    console.warn('[Background] Could not load the direct-message outbox:', error.message);
    return;
  }

  if (flushingUserMessages) return;
  const socket = ws;
  if (!socket || socket.readyState !== WebSocket.OPEN || userMessageOutbox.length === 0) return;
  flushingUserMessages = true;
  try {
    while (ws === socket && socket.readyState === WebSocket.OPEN) {
      const now = Date.now();
      const entry = userMessageOutbox.find((item) => !item.lastSentAt || now - item.lastSentAt >= USER_MESSAGE_RETRY_MS);
      if (!entry) {
        const nextRetryAt = Math.min(...userMessageOutbox.map((item) => item.lastSentAt + USER_MESSAGE_RETRY_MS));
        scheduleUserMessageRetry(nextRetryAt - now);
        break;
      }

      const attempt = await recordUserMessageAttempt(entry.clientMessageId, now);
      if (!attempt) continue;
      if (ws !== socket || socket.readyState !== WebSocket.OPEN) break;
      try {
        socket.send(JSON.stringify({ type: 'USER_DIRECT_MESSAGE', clientMessageId: attempt.clientMessageId, payload: attempt.payload }));
      } catch (error) {
        console.warn('[Background] Direct message send failed:', error.message);
        scheduleUserMessageRetry();
        break;
      }
      scheduleUserMessageRetry();
    }
  } catch (error) {
    console.warn('[Background] Direct-message outbox flush failed:', error.message);
    scheduleUserMessageRetry();
  } finally {
    flushingUserMessages = false;
  }
}

function ensureBridgeRetryAlarm() {
  if (!chrome.alarms) return;
  try { chrome.alarms.create(BRIDGE_RETRY_ALARM, { periodInMinutes: 1 }); } catch (_) {}
}

function sendBridgeHeartbeat(socket) {
  if (ws !== socket || socket.readyState !== WebSocket.OPEN) return;
  try { socket.send(JSON.stringify({ type: 'CLIENT_HEARTBEAT', timestamp: Date.now() })); } catch (_) {}
}

function armApiResponseCapture(options) {
  const marker = '__CREW_POCKET_API_CAPTURE_V1__';
  let state = window[marker];
  if (!state) {
    state = { active: null, installed: false };
    Object.defineProperty(window, marker, { value: state, configurable: false });
  }

  if (!state.installed) {
    const sensitiveKey = /token|secret|password|authorization|cookie|csrf|api[_-]?key|signature|private[_-]?key|session|email|phone|mobile|user[_-]?id|account[_-]?id/i;
    const sensitiveUrlKey = /token|secret|password|auth|cookie|csrf|api[_-]?key|signature|session|email|phone|mobile|user[_-]?id|account[_-]?id/i;

    const safeString = value => String(value || '')
      .replace(/\bBearer\s+[^\s,"}]+/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:access_token|refresh_token|token|api[_-]?key|client_secret|app_secret|signature)=)[^&#\s"<>]+/gi, '$1[REDACTED]');

    const safeUrl = value => {
      try {
        const parsed = new URL(value, location.href);
        for (const key of [...parsed.searchParams.keys()]) {
          if (sensitiveUrlKey.test(key)) parsed.searchParams.delete(key);
        }
        parsed.username = '';
        parsed.password = '';
        return (parsed.origin + parsed.pathname + parsed.search).slice(0, 2000);
      } catch (_) {
        return '';
      }
    };

    const redactJson = (value, depth = 0) => {
      if (depth > 20) return '[DEPTH_LIMIT]';
      if (typeof value === 'string') return safeString(value);
      if (Array.isArray(value)) return value.slice(0, 200).map(item => redactJson(item, depth + 1));
      if (value && typeof value === 'object') {
        const output = {};
        for (const [key, item] of Object.entries(value).slice(0, 300)) {
          output[key] = sensitiveKey.test(key) ? '[REDACTED]' : redactJson(item, depth + 1);
        }
        return output;
      }
      return value;
    };

    const byteLength = value => new TextEncoder().encode(String(value)).byteLength;

    const serializeRequestBody = async (value, request, capture) => {
      let raw = value;
      if (typeof URLSearchParams !== 'undefined' && raw instanceof URLSearchParams) raw = raw.toString();
      if ((raw === undefined || raw === null) && typeof Request !== 'undefined' && request instanceof Request) {
        try { raw = await request.clone().text(); } catch (_) { return null; }
      }
      if (typeof raw !== 'string' || !raw || byteLength(raw) > capture.maxBytes) return null;

      try {
        const safeBody = JSON.stringify(redactJson(JSON.parse(raw)));
        return byteLength(safeBody) <= capture.maxBytes ? safeBody : null;
      } catch (_) {}

      if (!raw.includes('=')) return null;
      try {
        const entries = [];
        for (const [key, item] of new URLSearchParams(raw)) {
          entries.push([
            String(key).slice(0, 100),
            sensitiveKey.test(key) ? '[REDACTED]' : safeString(item).slice(0, 1000)
          ]);
          if (entries.length >= 200) break;
        }
        if (!entries.length) return null;
        const safeBody = JSON.stringify({ format: 'urlencoded', entries });
        return byteLength(safeBody) <= capture.maxBytes ? safeBody : null;
      } catch (_) {
        return null;
      }
    };

    const postResult = (capture, result) => {
      window.postMessage({
        source: 'CREW_POCKET_API_RESPONSE_CAPTURE',
        type: 'RESULT',
        payload: {
          captureId: capture.captureId,
          url: safeUrl(result.url),
          method: String(result.method || 'GET').toUpperCase().slice(0, 12),
          status: Number(result.status) || 0,
          contentType: String(result.contentType || '').slice(0, 120),
          requestBody: typeof result.requestBody === 'string' ? result.requestBody : null,
          requestBodyBytes: typeof result.requestBody === 'string' ? byteLength(result.requestBody) : 0,
          body: typeof result.body === 'string' ? result.body : null,
          bodyBytes: Number(result.bodyBytes) || 0,
          error: result.error || null,
          capturedAt: Date.now()
        }
      }, location.origin);
    };

    const isJsonContentType = value => /(?:application|text)\/(?:[^;]+\+)?json\b/i.test(String(value || ''));
    const matchesCaptureTarget = (requestUrl, capture) => {
      try {
        return new URL(requestUrl, location.href).origin === location.origin
          && String(requestUrl || '').includes(capture.urlIncludes);
      } catch (_) {
        return false;
      }
    };

    const readFetchResponse = async (response, requestUrl, method, startedAt, capture, requestBody) => {
      if (state.active !== capture || startedAt < capture.armedAt || Date.now() > capture.expiresAt) return;
      const contentType = response.headers?.get('content-type') || '';
      if (!isJsonContentType(contentType)) {
        state.active = null;
        postResult(capture, { url: requestUrl, method, status: response.status, contentType, requestBody, error: 'NON_JSON_RESPONSE' });
        return;
      }
      state.active = null;

      const declaredLength = Number(response.headers?.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > capture.maxBytes) {
        postResult(capture, { url: requestUrl, method, status: response.status, contentType, requestBody, error: 'RESPONSE_TOO_LARGE' });
        return;
      }

      try {
        const reader = response.clone().body?.getReader();
        let raw = '';
        if (reader) {
          const chunks = [];
          let size = 0;
          const decoder = new TextDecoder();
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > capture.maxBytes) {
              await reader.cancel();
              postResult(capture, { url: requestUrl, method, status: response.status, contentType, requestBody, error: 'RESPONSE_TOO_LARGE' });
              return;
            }
            chunks.push(part.value);
          }
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          raw = decoder.decode(bytes);
        } else {
          raw = await response.clone().text();
          if (byteLength(raw) > capture.maxBytes) {
            postResult(capture, { url: requestUrl, method, status: response.status, contentType, requestBody, error: 'RESPONSE_TOO_LARGE' });
            return;
          }
        }
        const parsed = JSON.parse(raw);
        const body = JSON.stringify(redactJson(parsed));
        const bodyBytes = byteLength(body);
        if (bodyBytes > capture.maxBytes) {
          postResult(capture, { url: requestUrl, method, status: response.status, contentType, requestBody, error: 'RESPONSE_TOO_LARGE' });
          return;
        }
        postResult(capture, { url: requestUrl, method, status: response.status, contentType, requestBody, body, bodyBytes });
      } catch (_) {
        postResult(capture, { url: requestUrl, method, status: response.status, contentType, requestBody, error: 'INVALID_JSON_RESPONSE' });
      }
    };

    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function(...args) {
        const request = args[0];
        const requestUrl = typeof request === 'string' ? request : request?.url || String(request || '');
        const method = args[1]?.method || request?.method || 'GET';
        const startedAt = Date.now();
        const capture = state.active;
        const shouldCapture = Boolean(capture && startedAt >= capture.armedAt && startedAt <= capture.expiresAt && matchesCaptureTarget(requestUrl, capture));
        const requestBodyPromise = shouldCapture
          ? serializeRequestBody(args[1]?.body, request, capture).catch(() => null)
          : Promise.resolve(null);
        const pending = originalFetch.apply(this, args);
        return Promise.resolve(pending).then(response => {
          if (shouldCapture && state.active === capture) {
            requestBodyPromise.then(requestBody => readFetchResponse(response, requestUrl, method, startedAt, capture, requestBody)).catch(() => {});
          }
          return response;
        });
      };
    }

    const xhrPrototype = window.XMLHttpRequest?.prototype;
    if (xhrPrototype) {
      const originalOpen = xhrPrototype.open;
      const originalSend = xhrPrototype.send;
      xhrPrototype.open = function(method, requestUrl, ...args) {
        this.__crewPocketApiRequest = { method: String(method || 'GET'), url: String(requestUrl || ''), startedAt: Date.now() };
        return originalOpen.call(this, method, requestUrl, ...args);
      };
      xhrPrototype.send = function(...args) {
        const xhr = this;
        const request = xhr.__crewPocketApiRequest;
        if (request) request.startedAt = Date.now();
        const capture = state.active;
        const shouldCapture = Boolean(capture && request && request.startedAt >= capture.armedAt && request.startedAt <= capture.expiresAt && matchesCaptureTarget(request.url, capture));
        const requestBodyPromise = shouldCapture
          ? serializeRequestBody(args[0], null, capture).catch(() => null)
          : Promise.resolve(null);
        xhr.addEventListener('loadend', async () => {
          if (!shouldCapture || state.active !== capture || !request || Date.now() > capture.expiresAt) return;
          const requestBody = await requestBodyPromise;
          let contentType = '';
          let raw = '';
          try {
            contentType = xhr.getResponseHeader('content-type') || '';
            if (!isJsonContentType(contentType)) {
              state.active = null;
              postResult(capture, { url: request.url, method: request.method, status: xhr.status, contentType, requestBody, error: 'NON_JSON_RESPONSE' });
              return;
            }
            state.active = null;
            if (xhr.responseType === 'json') raw = JSON.stringify(xhr.response);
            else if (!xhr.responseType || xhr.responseType === 'text') raw = xhr.responseText;
            else {
              postResult(capture, { url: request.url, method: request.method, status: xhr.status, contentType, requestBody, error: 'UNSUPPORTED_RESPONSE_TYPE' });
              return;
            }
            if (byteLength(raw) > capture.maxBytes) {
              postResult(capture, { url: request.url, method: request.method, status: xhr.status, contentType, requestBody, error: 'RESPONSE_TOO_LARGE' });
              return;
            }
            const body = JSON.stringify(redactJson(JSON.parse(raw)));
            const bodyBytes = byteLength(body);
            if (bodyBytes > capture.maxBytes) {
              postResult(capture, { url: request.url, method: request.method, status: xhr.status, contentType, requestBody, error: 'RESPONSE_TOO_LARGE' });
              return;
            }
            postResult(capture, { url: request.url, method: request.method, status: xhr.status, contentType, requestBody, body, bodyBytes });
          } catch (_) {
            if (state.active === capture) state.active = null;
            postResult(capture, { url: request.url, method: request.method, status: xhr.status, contentType, requestBody, error: 'INVALID_JSON_RESPONSE' });
          }
        }, { once: true });
        return originalSend.apply(this, args);
      };
    }
    state.installed = true;
  }

  state.active = {
    captureId: String(options.captureId),
    urlIncludes: String(options.urlIncludes),
    maxBytes: Math.max(1024, Math.min(64 * 1024, Number(options.maxBytes) || 16 * 1024)),
    armedAt: Number(options.armedAt) || Date.now(),
    expiresAt: Number(options.expiresAt) || Date.now() + 15 * 1000
  };
  return { success: true, captureId: state.active.captureId };
}

function connectBridge() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    console.log('[Background] Connecting to Crew Pocket Termux Bridge:', BRIDGE_WS_URL);
    const socket = new WebSocket(BRIDGE_WS_URL);
    ws = socket;

    socket.onopen = () => {
      console.log('⚡ [Background] Connected to Termux Bridge!');
      socket.send(JSON.stringify({ type: 'CLIENT_IDENTIFY', role: 'LEMUR_BROWSER_EXTENSION', timestamp: Date.now() }));
      // Flush buffered APIs
      while (apiBuffer.length > 0) {
        const item = apiBuffer.shift();
        socket.send(JSON.stringify(item));
      }
      if (bridgeHeartbeatTimer) clearInterval(bridgeHeartbeatTimer);
      bridgeHeartbeatTimer = setInterval(() => sendBridgeHeartbeat(socket), BRIDGE_HEARTBEAT_MS);
      void flushUserMessageOutbox();
    };

    socket.onmessage = async (event) => {
      try {
        const cmd = JSON.parse(event.data);
        if (cmd.type === 'USER_DIRECT_MESSAGE_ACK') {
          await settleUserMessage(cmd, 'DELIVERED');
          return;
        }
        if (cmd.type === 'USER_DIRECT_MESSAGE_REJECTED') {
          await settleUserMessage(cmd, 'FAILED');
          return;
        }
        let tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (!tabs || tabs.length === 0) {
          tabs = await chrome.tabs.query({});
        }
        // Find valid active web tab
        const tab = tabs ? (tabs.find(t => t.url && /^https?:\/\//.test(t.url) && !t.url.includes('chrome://')) || tabs[0]) : null;
        if (!tab || !tab.id) {
          socket.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: 'No accessible web tab found' }));
          return;
        }

        if (cmd.action === 'EVAL') {
          const code = typeof cmd.code === 'string' ? cmd.code : '';
          if (!code.trim() || code.length > PAGE_JS_DEBUG_MAX_CODE_LENGTH) {
            socket.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: `除錯程式碼需為 1–${PAGE_JS_DEBUG_MAX_CODE_LENGTH} 字元` }));
            return;
          }
          if (activeDebugExecutions.has(tab.id)) {
            socket.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: '目前分頁已有一段 JS 除錯程式執行中' }));
            return;
          }

          activeDebugExecutions.add(tab.id);
          try {
            const key = pageJsDebugStorageKey(tab.id);
            const permission = await storageGet(key);
            let pageMatchesPermission = false;
            try {
              const currentPage = new URL(tab.url);
              pageMatchesPermission = permission?.origin === currentPage.origin && permission?.path === currentPage.pathname;
            } catch (_) {}
            if (!permission || permission.tabId !== tab.id || !pageMatchesPermission || permission.expiresAt <= Date.now() || permission.remainingRuns < 1) {
              if (permission) await storageRemove(key).catch(() => {});
              socket.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: '目前分頁的 JS 除錯尚未啟用、頁面已變更或權限已到期；請重新啟用 5 分鐘' }));
              return;
            }
            await storageSet({ [key]: { ...permission, remainingRuns: permission.remainingRuns - 1 } });
            let results;
            let injectionError = null;
            try {
              results = await new Promise((resolve, reject) => {
                try {
                  chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    world: 'MAIN',
                    func: async (source) => {
                      const redactText = (text) => String(text || '')
                        .replace(/\bBearer\s+[^\s,"}]+/gi, 'Bearer [REDACTED]')
                        .replace(/((?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|client[_-]?secret|app[_-]?secret|password|authorization|cookie|session)\s*[:=]\s*["']?)[^\s,"'&;}]+/gi, '$1[REDACTED]')
                        .replace(/([?&](?:access_token|refresh_token|token|api[_-]?key|client_secret|app_secret|signature)=)[^&#\s"<>]+/gi, '$1[REDACTED]');
                      try {
                        const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
                        let evaluator;
                        try {
                          evaluator = new AsyncFunction(`return (${source}\n);`);
                        } catch (_) {
                          evaluator = new AsyncFunction(source);
                        }
                        let timeoutId;
                        const value = await Promise.race([
                          Promise.resolve().then(() => evaluator.call(window)),
                          new Promise((_, reject) => {
                            timeoutId = setTimeout(() => reject(new Error('頁面 JS 執行超過 5 秒')), 5000);
                          })
                        ]).finally(() => clearTimeout(timeoutId));
                        const seen = new WeakSet();
                        const serialized = JSON.stringify(value, (key, item) => {
                          if (/token|secret|password|authorization|cookie|csrf|api[_-]?key|signature|private[_-]?key|session|email|phone|mobile|user[_-]?id|account[_-]?id/i.test(key)) return '[REDACTED]';
                          if (typeof item === 'bigint') return `${item}n`;
                          if (typeof item === 'function') return `[Function${item.name ? `: ${item.name}` : ''}]`;
                          if (typeof item === 'string' && item.length > 8000) return `${item.slice(0, 8000)}…[truncated]`;
                          if (item && typeof item === 'object') {
                            if (typeof Element !== 'undefined' && item instanceof Element) {
                              return { type: 'Element', tagName: item.tagName, id: item.id || '', className: String(item.className || '').slice(0, 160), text: String(item.innerText || '').slice(0, 500) };
                            }
                            if (typeof Response !== 'undefined' && item instanceof Response) {
                              return { type: 'Response', status: item.status, ok: item.ok, url: item.url };
                            }
                            if (item instanceof Error) return { name: item.name, message: item.message, stack: String(item.stack || '').slice(0, 4000) };
                            if (seen.has(item)) return '[Circular]';
                            seen.add(item);
                            if (Array.isArray(item) && item.length > 100) return [...item.slice(0, 100), `[${item.length - 100} more items]`];
                            if (!Array.isArray(item) && Object.keys(item).length > 100) {
                              const limited = Object.fromEntries(Object.entries(item).slice(0, 100));
                              limited.__truncatedKeys = Object.keys(item).length - 100;
                              return limited;
                            }
                          }
                          return item;
                        });
                        const output = redactText(serialized === undefined ? 'undefined' : serialized);
                        return {
                          status: 'SUCCESS',
                          result: output.length > 32 * 1024 ? `${output.slice(0, 32 * 1024)}…[truncated]` : output,
                          truncated: output.length > 32 * 1024
                        };
                      } catch (error) {
                        return { status: 'ERROR', message: redactText(error?.message || error).slice(0, 2000), stack: redactText(error?.stack || '').slice(0, 4000) };
                      }
                    },
                    args: [code]
                  }, (injectedResults) => {
                    const error = chrome.runtime.lastError;
                    if (error) reject(new Error(error.message));
                    else resolve(injectedResults);
                  });
                } catch (error) {
                  reject(error);
                }
              });
            } catch (error) {
              injectionError = error;
            }

            const result = results?.[0]?.result;
            const shouldFallbackToIsolatedWorld = Boolean(injectionError || !result
              || (result.status === 'ERROR' && /unsafe-eval|content security policy|csp/i.test(result.message || '')));
            if (shouldFallbackToIsolatedWorld) {
              const fallbackResult = await new Promise((resolve) => {
                try {
                  chrome.tabs.sendMessage(tab.id, { action: 'EVAL', code }, (fallback) => {
                    const error = chrome.runtime.lastError;
                    resolve({ fallback, error: error?.message || null });
                  });
                } catch (error) {
                  resolve({ fallback: null, error: String(error?.message || error) });
                }
              });
              const fallback = fallbackResult.fallback;
              if (fallbackResult.error || fallback?.status !== 'SUCCESS') {
                socket.send(JSON.stringify({
                  responseTo: cmd.id,
                  status: 'ERROR',
                  data: fallback || null,
                  message: fallbackResult.error || fallback?.message || result?.message || injectionError?.message || 'JS 除錯執行失敗'
                }));
              } else {
                socket.send(JSON.stringify({
                  responseTo: cmd.id,
                  status: 'OK',
                    data: { ...fallback, mainWorldUnavailable: true, mainWorldError: result?.message || injectionError?.message || '', tabId: tab.id }
                }));
              }
            } else {
              socket.send(JSON.stringify({
                responseTo: cmd.id,
                status: result.status === 'SUCCESS' ? 'OK' : 'ERROR',
                data: result.status === 'SUCCESS' ? { ...result, executionWorld: 'MAIN', tabId: tab.id } : result,
                message: result.status === 'ERROR' ? result.message : undefined
              }));
            }
          } catch (error) {
            socket.send(JSON.stringify({
              responseTo: cmd.id,
              status: 'ERROR',
              message: `頁面 JS 除錯失敗：${String(error?.message || error).slice(0, 500)}`
            }));
          } finally {
            activeDebugExecutions.delete(tab.id);
          }
          return;
        }

        if (cmd.action === 'ARM_API_RESPONSE_CAPTURE') {
          if (cmd.requireDebugPermission === true) {
            try {
              const permission = await storageGet(pageJsDebugStorageKey(tab.id));
              const currentPage = new URL(tab.url);
              const allowed = permission?.tabId === tab.id
                && permission.origin === currentPage.origin
                && permission.path === currentPage.pathname
                && permission.expiresAt > Date.now()
                && permission.remainingRuns > 0;
              if (!allowed) {
                socket.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: '請先在 extension popup 為目前頁面啟用 Codex 除錯，再開始 API 擷取' }));
                return;
              }
            } catch (error) {
              socket.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: `無法確認 API 擷取權限：${String(error?.message || error).slice(0, 300)}` }));
              return;
            }
          }
          const urlIncludes = typeof cmd.urlIncludes === 'string' ? cmd.urlIncludes.trim() : '';
          if (!urlIncludes || urlIncludes.length > 400 || urlIncludes.includes('*') || /[\r\n]/.test(urlIncludes)) {
            socket.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: '請提供明確的 API URL 片段（1–400 字元，不接受萬用字元）' }));
            return;
          }
          if (pendingApiCaptures.size > 0) {
            socket.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: '已有一筆 API 回應擷取等待中，請先完成或等待逾時' }));
            return;
          }

          const durationMs = Math.max(1000, Math.min(MAX_API_CAPTURE_MS, Number(cmd.durationMs) || 15 * 1000));
          const maxBytes = Math.max(1024, Math.min(MAX_API_CAPTURE_BYTES, Number(cmd.maxBytes) || 16 * 1024));
          const captureId = crypto.randomUUID();
          const armedAt = Date.now();
          const expiresAt = armedAt + durationMs;
          const captureState = {
            timeout: null,
            tabId: tab.id,
            pageUrl: sanitizeObservedUrl(tab.url)
          };
          captureState.timeout = setTimeout(() => pendingApiCaptures.delete(captureId), durationMs + 1000);
          pendingApiCaptures.set(captureId, captureState);

          try {
            chrome.scripting.executeScript({
              target: { tabId: tab.id },
              world: 'MAIN',
              func: armApiResponseCapture,
              args: [{ captureId, urlIncludes, maxBytes, armedAt, expiresAt }]
            }, (results) => {
              const lastError = chrome.runtime.lastError;
              const result = results && results[0] ? results[0].result : null;
              if (lastError || !result?.success) {
                clearTimeout(captureState.timeout);
                pendingApiCaptures.delete(captureId);
                socket.send(JSON.stringify({
                  responseTo: cmd.id,
                  status: 'ERROR',
                  message: lastError?.message || '瀏覽器無法在頁面主環境安裝 API 回應擷取器'
                }));
                return;
              }
              socket.send(JSON.stringify({
                responseTo: cmd.id,
                status: 'OK',
                data: { armed: true, captureId, expiresAt, maxBytes }
              }));
            });
          } catch (error) {
            clearTimeout(captureState.timeout);
            pendingApiCaptures.delete(captureId);
            socket.send(JSON.stringify({
              responseTo: cmd.id,
              status: 'ERROR',
              message: String(error?.message || error).slice(0, 500)
            }));
          }
          return;
        }

        // Execute DOM action directly via chrome.scripting API
        if (cmd.action === 'CLICK') {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (targetText, targetSelector) => {
              let target = null;
              if (targetSelector) target = document.querySelector(targetSelector);
              
              if (!target && targetText) {
                const query = targetText.toLowerCase().trim();
                const tokens = query.split(/\s+/).filter(t => t.length > 1);
                
                // Prioritize actual clickable elements first, then sort by text length (shortest first)
                const clickables = Array.from(document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'));
                const others = Array.from(document.querySelectorAll('span, div, p, svg'));
                
                const rankEl = (el) => {
                  const t = (el.innerText || el.getAttribute('aria-label') || el.title || el.value || '').trim();
                  return t.length || 9999;
                };

                clickables.sort((a, b) => rankEl(a) - rankEl(b));
                others.sort((a, b) => rankEl(a) - rankEl(b));
                const candidates = [...clickables, ...others];

                // 1. Exact match
                target = candidates.find(el => {
                  const t = (el.innerText || el.getAttribute('aria-label') || el.title || el.value || '').trim().toLowerCase();
                  return t === query;
                });

                // 2. Substring match on clickable buttons
                if (!target) {
                  target = clickables.find(el => {
                    const t = (el.innerText || el.getAttribute('aria-label') || el.title || el.value || '').toLowerCase();
                    return t.includes(query);
                  });
                }

                // 3. Token match (all keywords appear in the same small element)
                if (!target && tokens.length > 1) {
                  target = clickables.find(el => {
                    const t = (el.innerText || el.getAttribute('aria-label') || el.title || '').toLowerCase();
                    return tokens.every(tok => t.includes(tok));
                  });
                }

                // 4. Fallback: search all candidates with substring
                if (!target) {
                  target = candidates.find(el => {
                    const t = (el.innerText || el.getAttribute('aria-label') || '').toLowerCase();
                    return t.includes(query) && t.length < 100;
                  });
                }
              }

              if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                const origOutline = target.style.outline;
                const origShadow = target.style.boxShadow;
                target.style.outline = '4px solid #f59e0b';
                target.style.boxShadow = '0 0 25px rgba(245, 158, 11, 1)';
                setTimeout(() => { target.style.outline = origOutline; target.style.boxShadow = origShadow; }, 3000);
                target.click();
                return { success: true, clicked: (target.innerText || target.getAttribute('aria-label') || target.tagName).trim().slice(0, 80) };
              }
              return { success: false, error: `未在頁面找到相符元素: "${targetText}"` };
            },
            args: [cmd.text || '', cmd.selector || '']
          }, (results) => {
            const res = results && results[0] ? results[0].result : null;
            socket.send(JSON.stringify({ responseTo: cmd.id, status: res && res.success ? 'OK' : 'ERROR', data: res }));
          });
          return;
        }

        if (cmd.action === 'REMOVE') {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (selector) => {
              const els = document.querySelectorAll(selector);
              els.forEach(e => e.remove());
              return { success: true, removedCount: els.length };
            },
            args: [cmd.selector || '']
          }, (results) => {
            const res = results && results[0] ? results[0].result : null;
            socket.send(JSON.stringify({ responseTo: cmd.id, status: 'OK', data: res }));
          });
          return;
        }

        // 🔍 QUERY_DOM: Search and return matching elements and text across the page without eval
        if (cmd.action === 'QUERY_DOM') {
          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            func: (queryText, selector) => {
              const sel = selector || 'a, button, [role="button"], input, div, p, span, h1, h2, h3, h4';
              const elements = Array.from(document.querySelectorAll(sel));
              const q = (queryText || '').toLowerCase().trim();
              const tokens = q.split(/\s+/).filter(t => t.length > 1);

              const matches = [];
              for (const el of elements) {
                const text = (el.innerText || el.getAttribute('aria-label') || el.title || el.value || '').trim();
                const href = (el.getAttribute('href') || '').trim();
                if (!text && !href) continue;

                let isMatch = false;
                if (!q) {
                  isMatch = true;
                } else if (text.toLowerCase().includes(q) || href.toLowerCase().includes(q)) {
                  isMatch = true;
                } else if (tokens.length > 0 && tokens.every(tok => text.toLowerCase().includes(tok) || href.toLowerCase().includes(tok))) {
                  isMatch = true;
                }

                if (isMatch && text.length < 200) {
                  matches.push({
                    text: text.slice(0, 100),
                    tag: el.tagName,
                    href: href || null,
                    id: el.id || null,
                    className: (el.className || '').slice(0, 60)
                  });
                  if (matches.length >= 25) break;
                }
              }

              return { success: true, count: matches.length, results: matches };
            },
            args: [cmd.query || cmd.text || '', cmd.selector || '']
          }, (results) => {
            const res = results && results[0] ? results[0].result : null;
            socket.send(JSON.stringify({ responseTo: cmd.id, status: 'OK', data: res }));
          });
          return;
        }

        chrome.tabs.sendMessage(tab.id, cmd, (response) => {
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            socket.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: lastErr.message }));
          } else {
            socket.send(JSON.stringify({ responseTo: cmd.id, status: 'OK', data: response }));
          }
        });
      } catch (err) {}
    };

    socket.onclose = () => {
      if (bridgeHeartbeatTimer) {
        clearInterval(bridgeHeartbeatTimer);
        bridgeHeartbeatTimer = null;
      }
      if (ws === socket) ws = null;
      scheduleReconnect();
    };

    socket.onerror = () => {};
  } catch (e) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBridge();
  }, 3000);
}

function sendToBridge(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
    return true;
  } else {
    if (data?.type === 'API_RESPONSE_CAPTURED') return false;
    apiBuffer.push(data);
    if (apiBuffer.length > 100) apiBuffer.shift();
    return false;
  }
}

// 1. Intercept Network API Requests via webRequest API
if (chrome.webRequest) {
  chrome.webRequest.onCompleted.addListener(
    (details) => {
      if (details.type === 'main_frame' && Number.isInteger(details.tabId) && details.tabId >= 0) {
        const pageResponse = {
          tabId: details.tabId,
          url: sanitizeObservedUrl(details.url),
          statusCode: Number(details.statusCode) || 0,
          statusLine: String(details.statusLine || '').slice(0, 120),
          timestamp: Date.now()
        };
        chrome.storage.local.set({ [pageHttpStatusStorageKey(details.tabId)]: pageResponse }, () => { void chrome.runtime.lastError; });
        if ([202, 403, 429].includes(pageResponse.statusCode)) {
          sendToBridge({
            source: 'CREW_POCKET_NETWORK',
            type: 'PAGE_BLOCKED',
            timestamp: pageResponse.timestamp,
            payload: {
              ...pageResponse,
              possibleChallenge: [202, 403].includes(pageResponse.statusCode),
              evidenceLevel: 'runtime-main-frame'
            }
          });
        }
      }

      // Focus on XHR, Fetch, and API endpoints
      const isApi = details.type === 'xmlhttprequest' || details.type === 'fetch' || details.url.includes('/api/') || details.url.includes('/bapi/') || details.url.includes('/gateway-api/');
      if (isApi) {
        sendToBridge({
          source: 'CREW_POCKET_NETWORK',
          type: 'API_RESPONSE',
          timestamp: Date.now(),
          payload: {
            url: sanitizeObservedUrl(details.url),
            method: details.method,
            statusCode: details.statusCode,
            statusLine: details.statusLine,
            type: details.type,
            evidenceLevel: 'runtime-metadata',
            fromCache: details.fromCache,
            ip: details.ip || null,
            tabId: details.tabId
          }
        });
      }
    },
    { urls: ["<all_urls>"] }
  );

  chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
      const isApi = details.type === 'xmlhttprequest' || details.type === 'fetch' || details.url.includes('/api/') || details.url.includes('/bapi/');
      if (isApi) {
        sendToBridge({
          source: 'CREW_POCKET_NETWORK',
          type: 'API_ERROR',
          timestamp: Date.now(),
          payload: {
            url: sanitizeObservedUrl(details.url),
            method: details.method,
            error: details.error,
            type: details.type,
            evidenceLevel: 'runtime-metadata',
            tabId: details.tabId
          }
        });
      }
    },
    { urls: ["<all_urls>"] }
  );
}

// 2. Forward content events to Termux
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'GET_PAGE_HTTP_STATUS') {
    const tabId = Number(message.tabId);
    if (!Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ status: 'ERROR', error: '分頁識別碼無效' });
      return false;
    }
    const key = pageHttpStatusStorageKey(tabId);
    chrome.storage.local.get(key, (result) => {
      const pageResponse = result?.[key];
      const fresh = pageResponse && Date.now() - Number(pageResponse.timestamp) <= PAGE_HTTP_STATUS_TTL_MS;
      sendResponse({ status: 'OK', data: fresh ? pageResponse : null });
    });
    return true;
  }
  if (message?.type === 'GET_PAGE_JS_DEBUG_STATUS' || message?.type === 'ARM_PAGE_JS_DEBUG' || message?.type === 'REVOKE_PAGE_JS_DEBUG') {
    const trustedPopup = sender?.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup.html');
    const tabId = Number(message.tabId);
    if (!trustedPopup || !Number.isInteger(tabId) || tabId < 0) {
      sendResponse({ status: 'ERROR', error: trustedPopup ? '分頁識別碼無效' : '只有 extension popup 可管理頁面 JS 除錯權限' });
      return false;
    }
    const key = pageJsDebugStorageKey(tabId);
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab || tab.id !== tabId || !/^https?:\/\//.test(tab.url || '')) {
        sendResponse({ status: 'ERROR', error: '請在要除錯的網頁分頁開啟 extension popup 後再操作' });
        return;
      }
      const pageUrl = new URL(tab.url);
      if (message.type === 'ARM_PAGE_JS_DEBUG') {
        const permission = {
          tabId,
          origin: pageUrl.origin,
          path: pageUrl.pathname,
          expiresAt: Date.now() + PAGE_JS_DEBUG_TTL_MS,
          remainingRuns: PAGE_JS_DEBUG_MAX_RUNS,
          armedAt: Date.now()
        };
        chrome.storage.local.set({ [key]: permission }, () => {
          const error = chrome.runtime.lastError;
          sendResponse(error
            ? { status: 'ERROR', error: error.message }
            : { status: 'OK', data: { ...permission, active: true } });
        });
        return;
      }
      if (message.type === 'REVOKE_PAGE_JS_DEBUG') {
        storageRemove(key).then(() => sendResponse({ status: 'OK', data: { active: false } }))
          .catch(error => sendResponse({ status: 'ERROR', error: error.message }));
        return;
      }
      chrome.storage.local.get(key, (result) => {
        const permission = result?.[key];
        let pageMatchesPermission = false;
        try {
          pageMatchesPermission = permission?.origin === pageUrl.origin && permission?.path === pageUrl.pathname;
        } catch (_) {}
        const active = Boolean(permission && permission.tabId === tabId && pageMatchesPermission
          && permission.expiresAt > Date.now() && permission.remainingRuns > 0);
        if (permission && !active) storageRemove(key).catch(() => {});
        sendResponse({ status: 'OK', data: active ? { ...permission, active } : { active: false } });
      });
    });
    return true;
  }
  if (message?.type === 'USER_DIRECT_MESSAGE') {
    enqueueUserMessage(message, sender).then((response) => {
      sendResponse(response);
      void flushUserMessageOutbox();
    }).catch((error) => {
      sendResponse({ status: 'ERROR', error: error.message });
    });
    return true;
  }
  if (message?.type === 'API_RESPONSE_CAPTURED') {
    const captureId = String(message.payload?.captureId || '');
    const captureState = pendingApiCaptures.get(captureId);
    if (!captureId || !captureState || captureState.tabId !== sender?.tab?.id) {
      sendResponse({ status: 'IGNORED' });
      return false;
    }
    clearTimeout(captureState.timeout);
    pendingApiCaptures.delete(captureId);
    const delivered = sendToBridge({
      source: 'CREW_POCKET_NETWORK',
      type: 'API_RESPONSE_CAPTURED',
      timestamp: Date.now(),
      payload: {
        ...message.payload,
        tabId: captureState.tabId,
        pageUrl: captureState.pageUrl
      }
    });
    sendResponse({ status: delivered ? 'ACK' : 'DROPPED' });
    return false;
  }
  const forwardedMessage = Number.isInteger(sender?.tab?.id)
    ? { ...message, tabId: sender.tab.id }
    : message;
  sendToBridge(forwardedMessage);
  sendResponse({ status: 'ACK' });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.local.remove([pageHttpStatusStorageKey(tabId), pageJsDebugStorageKey(tabId)], () => { void chrome.runtime.lastError; });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  chrome.storage.local.remove([pageHttpStatusStorageKey(tabId), pageJsDebugStorageKey(tabId)], () => { void chrome.runtime.lastError; });
});

if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== BRIDGE_RETRY_ALARM) return;
    connectBridge();
    void flushUserMessageOutbox();
  });
}

chrome.runtime.onStartup.addListener(() => {
  ensureBridgeRetryAlarm();
  connectBridge();
  void flushUserMessageOutbox();
});

chrome.runtime.onInstalled.addListener(() => {
  ensureBridgeRetryAlarm();
  connectBridge();
});

ensureBridgeRetryAlarm();
void ensureUserMessageOutboxLoaded().catch((error) => {
  console.warn('[Background] Could not restore the direct-message outbox:', error.message);
});
connectBridge();
setInterval(connectBridge, 10000);
