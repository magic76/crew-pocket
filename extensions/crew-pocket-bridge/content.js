// Crew Pocket Content Script - Mobile Keyboard-Optimized In-Page Messenger
(function() {
  if (window.__CREW_POCKET_INJECTED) return;
  window.__CREW_POCKET_INJECTED = true;

  console.log('[Crew Pocket Bridge] Injected on:', location.href);

  function notifyBackground(type, payload) {
    try {
      chrome.runtime.sendMessage({
        source: 'CREW_POCKET_CONTENT',
        type: type,
        url: location.href,
        timestamp: Date.now(),
        payload: payload
      });
    } catch (err) {}
  }

  // 1. Hook Console Logs
  const origError = console.error;
  const origWarn = console.warn;
  const origLog = console.log;
  let lastErrorMsg = null;

  console.error = function(...args) {
    lastErrorMsg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
    notifyBackground('CONSOLE_LOG', { level: 'error', message: lastErrorMsg });
    origError.apply(console, args);
  };
  console.warn = function(...args) {
    notifyBackground('CONSOLE_LOG', { level: 'warn', message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') });
    origWarn.apply(console, args);
  };
  console.log = function(...args) {
    notifyBackground('CONSOLE_LOG', { level: 'info', message: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') });
    origLog.apply(console, args);
  };

  // 2. SEO & DOM Extractor
  function extractFullPageData() {
    try {
      const getMeta = (nameOrProp) => {
        const el = document.querySelector(`meta[name="${nameOrProp}" i], meta[property="${nameOrProp}" i]`);
        return el ? el.getAttribute('content') : null;
      };

      const slideNodes = document.querySelectorAll('.swiper-slide, [class*="slide" i], [class*="banner" i], [class*="carousel" i], a[href*="activity"]');
      const slides = Array.from(slideNodes)
        .map(s => (s.innerText || '').trim().replace(/\s+/g, ' '))
        .filter(text => text.length > 5 && text.length < 200)
        .slice(0, 8);

      const optionNodes = document.querySelectorAll('button, a[role="button"], input[type="button"], nav a, header a');
      const options = Array.from(optionNodes).map(b => ({
        text: (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40)
      })).filter(b => b.text.length > 0);

      const seen = new Set();
      const uniqueOptions = options.filter(o => !seen.has(o.text) && seen.add(o.text));

      return {
        url: location.href,
        seo: {
          title: document.title || '無標題',
          description: getMeta('description') || getMeta('twitter:description') || '（未設定 Meta Description）',
          ogTitle: getMeta('og:title') || document.title,
          ogDesc: getMeta('og:description') || ''
        },
        slides: Array.from(new Set(slides)),
        options: uniqueOptions
      };
    } catch (err) {
      return { error: err.message, url: location.href };
    }
  }

  // 3. Inject In-Page Floating AI Messenger (Top-Aligned Modal to Avoid Keyboard Obstruction)
  function injectFloatingChat() {
    if (document.getElementById('crew-pocket-widget-root')) return;

    const host = document.createElement('div');
    host.id = 'crew-pocket-widget-root';
    host.style.cssText = 'position:fixed;bottom:24px;right:20px;z-index:2147483647;font-family:sans-serif;';
    document.documentElement.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });

    shadow.innerHTML = `
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .bubble-btn {
          width: 52px;
          height: 52px;
          border-radius: 26px;
          background: linear-gradient(135deg, #0284c7, #0f172a);
          border: 2px solid #38bdf8;
          box-shadow: 0 4px 15px rgba(2, 132, 199, 0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          font-size: 24px;
          user-select: none;
          transition: transform 0.2s;
        }
        .bubble-btn:active { transform: scale(0.9); }
        
        /* Modal Overlay - Top-Aligned to never be blocked by mobile keyboard */
        .modal-overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(3px);
          z-index: 2147483647;
          align-items: flex-start;
          justify-content: center;
          padding: 16px;
          overflow-y: auto;
        }
        .modal-overlay.open { display: flex; }
        
        .chat-box {
          width: 100%;
          max-width: 350px;
          background: #090d16;
          border: 1.5px solid #0284c7;
          border-radius: 18px;
          padding: 14px;
          box-shadow: 0 15px 35px rgba(0, 0, 0, 0.9);
          color: #e2e8f0;
          font-size: 12px;
          margin-top: 12px;
        }
        .box-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #1e293b;
          padding-bottom: 8px;
          margin-bottom: 10px;
          font-weight: bold;
          color: #38bdf8;
          font-size: 13px;
        }
        .close-btn {
          cursor: pointer;
          color: #94a3b8;
          font-size: 16px;
          padding: 2px 6px;
          border-radius: 6px;
          background: #1e293b;
        }
        .input-area {
          width: 100%;
          min-height: 70px;
          background: #020617;
          border: 1.5px solid #1e293b;
          border-radius: 10px;
          color: #f8fafc;
          padding: 10px;
          font-size: 13px;
          resize: none;
          margin-bottom: 10px;
          outline: none;
          line-height: 1.4;
        }
        .input-area:focus { border-color: #0284c7; }
        .send-btn {
          width: 100%;
          min-height: 42px;
          background: #0284c7;
          border: none;
          border-radius: 10px;
          color: white;
          font-weight: bold;
          cursor: pointer;
          font-size: 13px;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .send-btn:active { transform: scale(0.97); background: #0369a1; }
        .status-tag {
          font-size: 11px;
          color: #34d399;
          margin-top: 8px;
          text-align: center;
          font-weight: 500;
        }
      </style>

      <div id="modalOverlay" class="modal-overlay">
        <div class="chat-box">
          <div class="box-header">
            <span>⚡ Crew Pocket 網頁傳訊</span>
            <span id="closeBtn" class="close-btn">✕</span>
          </div>
          <textarea id="msgInput" class="input-area" placeholder="輸入你想傳給 Crew Pocket AI 的問題或指令..."></textarea>
          <button id="sendMsgBtn" class="send-btn">
            <span>🚀 傳送給 Crew Pocket AI</span>
          </button>
          <div id="sendStatus" class="status-tag"></div>
        </div>
      </div>

      <div id="bubbleBtn" class="bubble-btn">🤖</div>
    `;

    const bubbleBtn = shadow.getElementById('bubbleBtn');
    const modalOverlay = shadow.getElementById('modalOverlay');
    const closeBtn = shadow.getElementById('closeBtn');
    const sendBtn = shadow.getElementById('sendMsgBtn');
    const input = shadow.getElementById('msgInput');
    const status = shadow.getElementById('sendStatus');

    bubbleBtn.addEventListener('click', () => {
      modalOverlay.classList.add('open');
      setTimeout(() => input.focus(), 100);
    });

    closeBtn.addEventListener('click', () => {
      modalOverlay.classList.remove('open');
    });

    modalOverlay.addEventListener('click', (e) => {
      if (e.target === modalOverlay) modalOverlay.classList.remove('open');
    });

    sendBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;

      status.textContent = '正在發送至 Crew Pocket 對話...';
      
      notifyBackground('USER_DIRECT_MESSAGE', {
        text: text,
        url: location.href,
        title: document.title,
        lastError: lastErrorMsg,
        timestamp: Date.now()
      });

      status.textContent = '✅ 已成功送達 Crew Pocket 聊天室！';
      input.value = '';
      setTimeout(() => {
        status.textContent = '';
        modalOverlay.classList.remove('open');
      }, 1200);
    });
  }

  // 4. Command Dispatcher
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'PING') {
      sendResponse({ status: 'OK', url: location.href, title: document.title });
      return true;
    }
    if (request.action === 'GET_PAGE_DATA' || request.action === 'GET_SEO_DATA' || request.action === 'GET_DOM_SUMMARY') {
      sendResponse({ status: 'SUCCESS', data: extractFullPageData() });
      return true;
    }
    if (request.action === 'HIGHLIGHT_ALL') {
      const elements = document.querySelectorAll('button, a, input, [role="button"]');
      elements.forEach(el => {
        el.style.outline = '2px solid #06b6d4';
        el.style.boxShadow = '0 0 10px rgba(6, 182, 212, 0.8)';
      });
      setTimeout(() => { elements.forEach(el => { el.style.outline = ''; el.style.boxShadow = ''; }); }, 4000);
      sendResponse({ status: 'SUCCESS', count: elements.length });
      return true;
    }

    // 🎯 1. Click Element (by CSS Selector or Text)
    if (request.action === 'CLICK') {
      let target = null;
      if (request.selector) {
        target = document.querySelector(request.selector);
      } else if (request.text) {
        const candidates = Array.from(document.querySelectorAll('button, a, input, [role="button"], span, div'));
        target = candidates.find(el => el.innerText && el.innerText.trim() === request.text.trim());
      }

      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.style.outline = '3px solid #38bdf8';
        target.style.boxShadow = '0 0 15px rgba(56, 189, 248, 0.9)';
        setTimeout(() => { target.style.outline = ''; target.style.boxShadow = ''; }, 1500);
        target.click();
        sendResponse({ status: 'SUCCESS', message: `已成功點擊: ${request.selector || request.text}` });
      } else {
        sendResponse({ status: 'ERROR', message: `未找到指定元素: ${request.selector || request.text}` });
      }
      return true;
    }

    // 🗑️ 2. Remove Element / Block from Page
    if (request.action === 'REMOVE') {
      const elements = document.querySelectorAll(request.selector);
      if (elements.length > 0) {
        elements.forEach(el => el.remove());
        sendResponse({ status: 'SUCCESS', count: elements.length, message: `已成功從頁面移除 ${elements.length} 個元素: ${request.selector}` });
      } else {
        sendResponse({ status: 'ERROR', message: `未找到欲移除的元素: ${request.selector}` });
      }
      return true;
    }

    // 👁️ 3. Hide Element
    if (request.action === 'HIDE') {
      const elements = document.querySelectorAll(request.selector);
      if (elements.length > 0) {
        elements.forEach(el => el.style.display = 'none');
        sendResponse({ status: 'SUCCESS', count: elements.length, message: `已成功隱藏 ${elements.length} 個元素: ${request.selector}` });
      } else {
        sendResponse({ status: 'ERROR', message: `未找到指定元素: ${request.selector}` });
      }
      return true;
    }

    // ⌨️ 4. Type Text into Input
    if (request.action === 'TYPE') {
      const input = document.querySelector(request.selector || 'input, textarea');
      if (input) {
        input.focus();
        input.value = request.text || '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        sendResponse({ status: 'SUCCESS', message: `已成功輸入文字: ${request.text}` });
      } else {
        sendResponse({ status: 'ERROR', message: `未找到輸入框: ${request.selector}` });
      }
      return true;
    }

    // 📜 5. Scroll Page
    if (request.action === 'SCROLL') {
      const y = request.y !== undefined ? request.y : (request.direction === 'bottom' ? document.body.scrollHeight : 0);
      window.scrollTo({ top: y, behavior: 'smooth' });
      sendResponse({ status: 'SUCCESS', message: `已滾動頁面至: ${y}` });
      return true;
    }

    // ⚡ 6. Execute Custom JavaScript on Page
    if (request.action === 'EVAL') {
      try {
        const result = eval(request.code);
        sendResponse({ status: 'SUCCESS', result: typeof result === 'object' ? JSON.stringify(result) : String(result) });
      } catch (err) {
        sendResponse({ status: 'ERROR', message: err.message });
      }
      return true;
    }

    return false;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectFloatingChat);
  } else {
    injectFloatingChat();
  }

  setTimeout(() => { notifyBackground('PAGE_SNAPSHOT', extractFullPageData()); }, 1200);
})();
