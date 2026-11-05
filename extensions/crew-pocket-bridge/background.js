// Crew Pocket Background Service Worker with Full Network API Interceptor
const BRIDGE_WS_URL = 'ws://127.0.0.1:8000/api/extension/ws';
let ws = null;
let reconnectTimer = null;
const apiBuffer = [];
const pendingApiCaptures = new Map();
const MAX_API_CAPTURE_BYTES = 64 * 1024;
const MAX_API_CAPTURE_MS = 60 * 1000;

function armApiResponseCapture(options) {
  const marker = '__CREW_POCKET_API_CAPTURE_V1__';
  let state = window[marker];
  if (!state) {
    state = { active: null, installed: false };
    Object.defineProperty(window, marker, { value: state, configurable: false });
  }

  if (!state.installed) {
    const sensitiveKey = /token|secret|password|authorization|cookie|csrf|api[_-]?key|signature|private[_-]?key|session/i;
    const sensitiveUrlKey = /token|secret|password|auth|cookie|csrf|api[_-]?key|signature|session/i;

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
          body: typeof result.body === 'string' ? result.body : null,
          bodyBytes: Number(result.bodyBytes) || 0,
          error: result.error || null,
          capturedAt: Date.now()
        }
      }, location.origin);
    };

    const isJsonContentType = value => /(?:application|text)\/(?:[^;]+\+)?json\b/i.test(String(value || ''));

    const readFetchResponse = async (response, requestUrl, method, startedAt, capture) => {
      if (state.active !== capture || startedAt < capture.armedAt || Date.now() > capture.expiresAt) return;
      const contentType = response.headers?.get('content-type') || '';
      if (!isJsonContentType(contentType)) return;
      state.active = null;

      const declaredLength = Number(response.headers?.get('content-length'));
      if (Number.isFinite(declaredLength) && declaredLength > capture.maxBytes) {
        postResult(capture, { url: requestUrl, method, status: response.status, contentType, error: 'RESPONSE_TOO_LARGE' });
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
              postResult(capture, { url: requestUrl, method, status: response.status, contentType, error: 'RESPONSE_TOO_LARGE' });
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
            postResult(capture, { url: requestUrl, method, status: response.status, contentType, error: 'RESPONSE_TOO_LARGE' });
            return;
          }
        }
        const parsed = JSON.parse(raw);
        const body = JSON.stringify(redactJson(parsed));
        const bodyBytes = byteLength(body);
        if (bodyBytes > capture.maxBytes) {
          postResult(capture, { url: requestUrl, method, status: response.status, contentType, error: 'RESPONSE_TOO_LARGE' });
          return;
        }
        postResult(capture, { url: requestUrl, method, status: response.status, contentType, body, bodyBytes });
      } catch (_) {
        postResult(capture, { url: requestUrl, method, status: response.status, contentType, error: 'INVALID_JSON_RESPONSE' });
      }
    };

    const originalFetch = window.fetch;
    if (typeof originalFetch === 'function') {
      window.fetch = function(...args) {
        const request = args[0];
        const requestUrl = typeof request === 'string' ? request : request?.url || String(request || '');
        const method = args[1]?.method || request?.method || 'GET';
        const startedAt = Date.now();
        const pending = originalFetch.apply(this, args);
        return Promise.resolve(pending).then(response => {
          const capture = state.active;
          if (capture && requestUrl.includes(capture.urlIncludes)) {
            readFetchResponse(response, requestUrl, method, startedAt, capture).catch(() => {});
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
        xhr.addEventListener('loadend', () => {
          const capture = state.active;
          if (!capture || !request || request.startedAt < capture.armedAt || Date.now() > capture.expiresAt || !request.url.includes(capture.urlIncludes)) return;
          let contentType = '';
          let raw = '';
          try {
            contentType = xhr.getResponseHeader('content-type') || '';
            if (!isJsonContentType(contentType)) return;
            state.active = null;
            if (xhr.responseType === 'json') raw = JSON.stringify(xhr.response);
            else if (!xhr.responseType || xhr.responseType === 'text') raw = xhr.responseText;
            else {
              postResult(capture, { url: request.url, method: request.method, status: xhr.status, contentType, error: 'UNSUPPORTED_RESPONSE_TYPE' });
              return;
            }
            if (byteLength(raw) > capture.maxBytes) {
              postResult(capture, { url: request.url, method: request.method, status: xhr.status, contentType, error: 'RESPONSE_TOO_LARGE' });
              return;
            }
            const body = JSON.stringify(redactJson(JSON.parse(raw)));
            const bodyBytes = byteLength(body);
            if (bodyBytes > capture.maxBytes) {
              postResult(capture, { url: request.url, method: request.method, status: xhr.status, contentType, error: 'RESPONSE_TOO_LARGE' });
              return;
            }
            postResult(capture, { url: request.url, method: request.method, status: xhr.status, contentType, body, bodyBytes });
          } catch (_) {
            if (state.active === capture) state.active = null;
            postResult(capture, { url: request.url, method: request.method, status: xhr.status, contentType, error: 'INVALID_JSON_RESPONSE' });
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
    ws = new WebSocket(BRIDGE_WS_URL);

    ws.onopen = () => {
      console.log('⚡ [Background] Connected to Termux Bridge!');
      ws.send(JSON.stringify({ type: 'CLIENT_IDENTIFY', role: 'LEMUR_BROWSER_EXTENSION', timestamp: Date.now() }));
      // Flush buffered APIs
      while (apiBuffer.length > 0) {
        const item = apiBuffer.shift();
        ws.send(JSON.stringify(item));
      }
    };

    ws.onmessage = async (event) => {
      try {
        const cmd = JSON.parse(event.data);
        let tabs = await chrome.tabs.query({ active: true });
        if (!tabs || tabs.length === 0) {
          tabs = await chrome.tabs.query({});
        }
        // Find valid active web tab
        const tab = tabs ? (tabs.find(t => t.url && /^https?:\/\//.test(t.url) && !t.url.includes('chrome://')) || tabs[0]) : null;
        if (!tab || !tab.id) {
          ws.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: 'No accessible web tab found' }));
          return;
        }

        if (cmd.action === 'ARM_API_RESPONSE_CAPTURE') {
          const urlIncludes = typeof cmd.urlIncludes === 'string' ? cmd.urlIncludes.trim() : '';
          if (!urlIncludes || urlIncludes.length > 400 || urlIncludes.includes('*') || /[\r\n]/.test(urlIncludes)) {
            ws.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: '請提供明確的 API URL 片段（1–400 字元，不接受萬用字元）' }));
            return;
          }
          if (pendingApiCaptures.size > 0) {
            ws.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: '已有一筆 API 回應擷取等待中，請先完成或等待逾時' }));
            return;
          }

          const durationMs = Math.max(1000, Math.min(MAX_API_CAPTURE_MS, Number(cmd.durationMs) || 15 * 1000));
          const maxBytes = Math.max(1024, Math.min(MAX_API_CAPTURE_BYTES, Number(cmd.maxBytes) || 16 * 1024));
          const captureId = crypto.randomUUID();
          const armedAt = Date.now();
          const expiresAt = armedAt + durationMs;
          const timeout = setTimeout(() => pendingApiCaptures.delete(captureId), durationMs + 1000);
          pendingApiCaptures.set(captureId, timeout);

          chrome.scripting.executeScript({
            target: { tabId: tab.id },
            world: 'MAIN',
            func: armApiResponseCapture,
            args: [{ captureId, urlIncludes, maxBytes, armedAt, expiresAt }]
          }, (results) => {
            const lastError = chrome.runtime.lastError;
            const result = results && results[0] ? results[0].result : null;
            if (lastError || !result?.success) {
              clearTimeout(timeout);
              pendingApiCaptures.delete(captureId);
              ws.send(JSON.stringify({
                responseTo: cmd.id,
                status: 'ERROR',
                message: lastError?.message || '瀏覽器無法在頁面主環境安裝 API 回應擷取器'
              }));
              return;
            }
            ws.send(JSON.stringify({
              responseTo: cmd.id,
              status: 'OK',
              data: { armed: true, captureId, expiresAt, maxBytes }
            }));
          });
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
            ws.send(JSON.stringify({ responseTo: cmd.id, status: res && res.success ? 'OK' : 'ERROR', data: res }));
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
            ws.send(JSON.stringify({ responseTo: cmd.id, status: 'OK', data: res }));
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
            ws.send(JSON.stringify({ responseTo: cmd.id, status: 'OK', data: res }));
          });
          return;
        }

        chrome.tabs.sendMessage(tab.id, cmd, (response) => {
          const lastErr = chrome.runtime.lastError;
          if (lastErr) {
            ws.send(JSON.stringify({ responseTo: cmd.id, status: 'ERROR', message: lastErr.message }));
          } else {
            ws.send(JSON.stringify({ responseTo: cmd.id, status: 'OK', data: response }));
          }
        });
      } catch (err) {}
    };

    ws.onclose = () => {
      scheduleReconnect();
    };

    ws.onerror = () => {};
  } catch (e) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connectBridge, 3000);
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
      // Focus on XHR, Fetch, and API endpoints
      const isApi = details.type === 'xmlhttprequest' || details.type === 'fetch' || details.url.includes('/api/') || details.url.includes('/bapi/') || details.url.includes('/gateway-api/');
      if (isApi) {
        sendToBridge({
          source: 'CREW_POCKET_NETWORK',
          type: 'API_RESPONSE',
          timestamp: Date.now(),
          payload: {
            url: details.url,
            method: details.method,
            statusCode: details.statusCode,
            statusLine: details.statusLine,
            type: details.type,
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
            url: details.url,
            method: details.method,
            error: details.error,
            type: details.type,
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
  if (message?.type === 'API_RESPONSE_CAPTURED') {
    const captureId = String(message.payload?.captureId || '');
    const timeout = pendingApiCaptures.get(captureId);
    if (!captureId || !timeout) {
      sendResponse({ status: 'IGNORED' });
      return false;
    }
    clearTimeout(timeout);
    pendingApiCaptures.delete(captureId);
    const delivered = sendToBridge({
      source: 'CREW_POCKET_NETWORK',
      type: 'API_RESPONSE_CAPTURED',
      timestamp: Date.now(),
      payload: message.payload
    });
    sendResponse({ status: delivered ? 'ACK' : 'DROPPED' });
    return false;
  }
  sendToBridge(message);
  sendResponse({ status: 'ACK' });
  return true;
});

connectBridge();
setInterval(connectBridge, 10000);
