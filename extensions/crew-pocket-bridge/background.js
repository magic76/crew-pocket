// Crew Pocket Background Service Worker with Full Network API Interceptor
const BRIDGE_WS_URL = 'ws://127.0.0.1:8000/api/extension/ws';
let ws = null;
let reconnectTimer = null;
const apiBuffer = [];

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
  } else {
    apiBuffer.push(data);
    if (apiBuffer.length > 100) apiBuffer.shift();
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
  sendToBridge(message);
  sendResponse({ status: 'ACK' });
  return true;
});

connectBridge();
setInterval(connectBridge, 10000);
