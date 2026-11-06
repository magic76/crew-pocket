// Crew Pocket Popup Script - with Top-Right Export Menu
document.addEventListener('DOMContentLoaded', () => {
  const btnTabSeo = document.getElementById('btnTabSeo');
  const btnTabSlides = document.getElementById('btnTabSlides');
  const btnTabOptions = document.getElementById('btnTabOptions');
  const btnTabApi = document.getElementById('btnTabApi');

  const panelSeo = document.getElementById('panelSeo');
  const panelSlides = document.getElementById('panelSlides');
  const panelOptions = document.getElementById('panelOptions');
  const panelApi = document.getElementById('panelApi');

  const seoTitle = document.getElementById('seoTitle');
  const seoDesc = document.getElementById('seoDesc');
  const seoOg = document.getElementById('seoOg');
  const slidesContainer = document.getElementById('slidesContainer');
  const optionsContainer = document.getElementById('optionsContainer');

  const refreshBtn = document.getElementById('refreshBtn');
  const highlightBtn = document.getElementById('highlightBtn');
  const toast = document.getElementById('toast');
  const scanApiBtn = document.getElementById('scanApiBtn');
  const sendApiFindingsBtn = document.getElementById('sendApiFindingsBtn');
  const apiScanStatus = document.getElementById('apiScanStatus');
  const apiPageStatus = document.getElementById('apiPageStatus');
  const apiCandidates = document.getElementById('apiCandidates');
  const runtimeApis = document.getElementById('runtimeApis');
  const debugJsStatus = document.getElementById('debugJsStatus');
  const enableDebugJsBtn = document.getElementById('enableDebugJsBtn');
  const disableDebugJsBtn = document.getElementById('disableDebugJsBtn');
  const apiScanState = { pageUrl: '', pageTitle: '', tabId: null, candidates: [], pageStatus: null, challengeSignals: [], assetsScanned: 0 };

  // Menu Elements
  const menuBtn = document.getElementById('menuBtn');
  const dropdownMenu = document.getElementById('dropdownMenu');
  const copyRootPathBtn = document.getElementById('copyRootPathBtn');
  const copyZipPathBtn = document.getElementById('copyZipPathBtn');
  const copyDownloadPathBtn = document.getElementById('copyDownloadPathBtn');
  const copyDocumentsPathBtn = document.getElementById('copyDocumentsPathBtn');
  const copyTermuxCmdBtn = document.getElementById('copyTermuxCmdBtn');

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = 'block';
    setTimeout(() => toast.style.display = 'none', 2000);
  }

  function copyText(text, label) {
    navigator.clipboard.writeText(text).then(() => {
      showToast(`✅ 已複製 ${label}！`);
      dropdownMenu.classList.remove('open');
    });
  }

  // Toggle Dropdown Menu
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('open');
  });

  document.addEventListener('click', () => {
    dropdownMenu.classList.remove('open');
  });

  dropdownMenu.addEventListener('click', (e) => {
    e.stopPropagation();
  });

  // Copy Menu Actions
  copyRootPathBtn.addEventListener('click', () => {
    copyText('/sdcard/crew-pocket-extension/', '內部儲存路徑');
  });

  copyZipPathBtn.addEventListener('click', () => {
    copyText('/sdcard/crew-pocket-extension/crew-pocket-bridge.zip', 'ZIP 壓縮包路徑');
  });

  copyDownloadPathBtn.addEventListener('click', () => {
    copyText('/sdcard/Download/crew-pocket-extension/', 'Download (下載) 目錄路徑');
  });

  copyDocumentsPathBtn.addEventListener('click', () => {
    copyText('/sdcard/Documents/crew-pocket-extension/', 'Documents (文件) 目錄路徑');
  });

  copyTermuxCmdBtn.addEventListener('click', () => {
    copyText('node ~/agy-web/server.js', 'Crew Pocket 啟動指令');
  });

  // Tab switching
  const tabs = [
    { btn: btnTabSeo, panel: panelSeo },
    { btn: btnTabSlides, panel: panelSlides },
    { btn: btnTabOptions, panel: panelOptions },
    { btn: btnTabApi, panel: panelApi }
  ];

  tabs.forEach((tab, idx) => {
    tab.btn.addEventListener('click', () => {
      tabs.forEach((t, i) => {
        if (i === idx) {
          t.btn.classList.add('active');
          t.panel.classList.add('active');
        } else {
          t.btn.classList.remove('active');
          t.panel.classList.remove('active');
        }
      });
      if (tab.panel === panelApi) {
        loadRuntimeApiRecords();
        loadDebugJsStatus();
      }
    });
  });

  async function getTargetTab() {
    let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs || tabs.length === 0) {
      tabs = await chrome.tabs.query({});
    }
    const webTab = tabs.find(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'));
    return webTab || tabs[0];
  }

  function sendRuntimeMessage(message) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(message, response => {
        const error = chrome.runtime.lastError;
        resolve(error ? { status: 'ERROR', error: error.message } : response || { status: 'ERROR', error: 'Extension 沒有回應' });
      });
    });
  }

  async function loadDebugJsStatus(tabOverride) {
    const tab = tabOverride || await getTargetTab();
    if (!tab?.id) return;
    const response = await sendRuntimeMessage({ type: 'GET_PAGE_JS_DEBUG_STATUS', tabId: tab.id });
    const data = response?.data;
    const active = response?.status === 'OK' && data?.active;
    enableDebugJsBtn.disabled = Boolean(active);
    disableDebugJsBtn.disabled = !active;
    if (active) {
      const minutes = Math.max(1, Math.ceil((Number(data.expiresAt) - Date.now()) / 60000));
      debugJsStatus.className = 'api-status warning';
      debugJsStatus.textContent = `已啟用：目前頁面最多 ${minutes} 分鐘、剩餘 ${data.remainingRuns} 次。頁面切換或重新載入會自動關閉。`;
    } else {
      debugJsStatus.className = 'api-status';
      debugJsStatus.textContent = response?.status === 'OK'
        ? '預設關閉。啟用後，支援 Crew 角色工具的 Codex 對話才能檢查目前頁面。'
        : response?.error || '無法讀取 JS 除錯權限狀態。';
    }
  }

  enableDebugJsBtn.addEventListener('click', async () => {
    const tab = await getTargetTab();
    if (!tab?.id) {
      showToast('找不到要除錯的網頁分頁');
      return;
    }
    enableDebugJsBtn.disabled = true;
    const response = await sendRuntimeMessage({ type: 'ARM_PAGE_JS_DEBUG', tabId: tab.id });
    if (response?.status !== 'OK') {
      showToast(response?.error || '無法啟用頁面 JS 除錯');
    }
    await loadDebugJsStatus(tab);
  });

  disableDebugJsBtn.addEventListener('click', async () => {
    const tab = await getTargetTab();
    if (!tab?.id) return;
    const response = await sendRuntimeMessage({ type: 'REVOKE_PAGE_JS_DEBUG', tabId: tab.id });
    if (response?.status === 'OK') showToast('已關閉目前分頁的 AI JS 除錯');
    await loadDebugJsStatus(tab);
  });

  async function loadPageData() {
    seoTitle.textContent = '讀取中...';
    seoDesc.textContent = '讀取中...';
    seoOg.textContent = '讀取中...';
    slidesContainer.innerHTML = '<div class="item-box">正在解析輪播看板...</div>';
    optionsContainer.innerHTML = '<span class="tag">讀取中...</span>';

    const tab = await getTargetTab();
    if (!tab || !tab.id) {
      seoTitle.textContent = '未找到活動分頁，請先開啟網頁';
      return;
    }

    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (e) {}

    chrome.tabs.sendMessage(tab.id, { action: 'GET_PAGE_DATA' }, (res) => {
      const err = chrome.runtime.lastError;
      if (err || !res || !res.data) {
        seoTitle.textContent = tab.title || '（未命名網頁）';
        seoDesc.textContent = '⚠️ 請按「重新整理」網頁後重試。';
        seoOg.textContent = tab.url;
        return;
      }

      const d = res.data;

      // 1. SEO
      seoTitle.textContent = d.seo.title || tab.title || '（無標題）';
      seoDesc.textContent = d.seo.description || '（該網頁未設定 Meta Description）';
      seoOg.textContent = d.seo.ogTitle || d.seo.ogDesc || d.seo.title || '（無 OG 標籤）';

      // 2. Slides
      if (d.slides && d.slides.length > 0) {
        slidesContainer.innerHTML = '';
        d.slides.forEach((slide, idx) => {
          const div = document.createElement('div');
          div.className = 'item-box';
          div.innerHTML = `<div class="item-label" style="color:#38bdf8;">Slide #${idx + 1}</div><div style="color:#e2e8f0;font-size:11px;">${slide}</div>`;
          slidesContainer.appendChild(div);
        });
      } else {
        slidesContainer.innerHTML = '<div class="item-box" style="color:#94a3b8;">未偵測到明顯的輪播橫幅</div>';
      }

      // 3. Options
      if (d.options && d.options.length > 0) {
        optionsContainer.innerHTML = '';
        d.options.slice(0, 25).forEach(opt => {
          const span = document.createElement('span');
          span.className = 'tag';
          span.textContent = `🔘 ${opt.text}`;
          optionsContainer.appendChild(span);
        });
      } else {
        optionsContainer.innerHTML = '<span class="tag">未找到按鈕選項</span>';
      }
    });
  }

  // Refresh
  refreshBtn.addEventListener('click', loadPageData);

  // Highlight
  highlightBtn.addEventListener('click', async () => {
    const tab = await getTargetTab();
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, { action: 'HIGHLIGHT_ALL' }, () => {
        highlightBtn.textContent = '✨ 已高亮！';
        setTimeout(() => highlightBtn.textContent = '✨ 高亮網頁按鈕', 2000);
      });
    }
  });

  function safeObservedUrl(value, keepQuery = false) {
    try {
      const parsed = new URL(String(value || ''));
      if (!['http:', 'https:'].includes(parsed.protocol)) return '';
      parsed.username = '';
      parsed.password = '';
      for (const key of [...parsed.searchParams.keys()]) {
        if (/token|secret|password|auth|cookie|csrf|api[_-]?key|signature|session|email|phone|mobile|user[_-]?id|account[_-]?id/i.test(key)) parsed.searchParams.delete(key);
      }
      if (!keepQuery) parsed.search = '';
      parsed.hash = '';
      return (parsed.origin + parsed.pathname + parsed.search).slice(0, 1200);
    } catch (_) {
      return '';
    }
  }

  function collectPageScanInputs() {
    const pageUrl = location.href;
    if (!/^https?:$/.test(location.protocol)) return { error: '只支援 HTTP 或 HTTPS 網頁', pageUrl };

    const sensitiveQuery = /token|secret|password|auth|cookie|csrf|api[_-]?key|signature|session|email|phone|mobile|user[_-]?id|account[_-]?id/i;
    const assetUrls = new Set();
    const addAsset = (value) => {
      try {
        const parsed = new URL(value, location.href);
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== location.origin) return;
        for (const key of parsed.searchParams.keys()) if (sensitiveQuery.test(key)) return;
        assetUrls.add(parsed.href);
      } catch (_) {}
    };

    document.querySelectorAll('script[src]').forEach((script) => addAsset(script.src));
    document.querySelectorAll('link[rel="modulepreload"][href], link[rel~="preload"][as="script"][href]').forEach((link) => addAsset(link.href));
    for (const entry of performance.getEntriesByType('resource').slice(-250)) {
      const looksLikeScript = entry.initiatorType === 'script' || /\.m?js(?:[?#]|$)/i.test(entry.name);
      if (looksLikeScript) addAsset(entry.name);
    }

    const inlineScripts = Array.from(document.scripts)
      .filter(script => !script.src && script.textContent && script.textContent.trim())
      .slice(0, 4)
      .map(script => script.textContent.slice(0, 18000));
    const visibleText = `${document.title || ''} ${(document.body?.innerText || '').slice(0, 5000)}`.toLowerCase();
    const challengeTerms = [
      ['cloudfront', 'CloudFront'],
      ['verify you are human', '人機驗證'],
      ['checking your browser', '瀏覽器檢查'],
      ['request blocked', '請求遭封鎖'],
      ['access denied', '拒絕存取'],
      ['security verification', '安全驗證'],
      ['just a moment', '等待驗證'],
      ['captcha', 'CAPTCHA']
    ];
    const challengeSignals = challengeTerms.filter(([needle]) => visibleText.includes(needle)).map(([, label]) => label);

    return {
      pageUrl,
      pageTitle: String(document.title || '').slice(0, 240),
      assets: Array.from(assetUrls).slice(0, 18),
      inlineScripts,
      challengeSignals
    };
  }

  function getPageHttpStatus(tabId) {
    return new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_PAGE_HTTP_STATUS', tabId }, response => {
        const error = chrome.runtime.lastError;
        resolve(error ? null : response?.data || null);
      });
    });
  }

  async function readBoundedAsset(response, budget, maxBytes) {
    if (!response.body?.getReader) {
      const text = await response.text();
      const bytes = new TextEncoder().encode(text).byteLength;
      if (bytes > maxBytes || budget.used + budget.reserved + bytes > budget.maxBytes) throw new Error('asset limit');
      budget.used += bytes;
      return text;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    let reserved = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > maxBytes || budget.used + budget.reserved + part.value.byteLength > budget.maxBytes) {
          await reader.cancel();
          throw new Error('asset limit');
        }
        budget.reserved += part.value.byteLength;
        reserved += part.value.byteLength;
        chunks.push(part.value);
      }
      budget.used += size;
      budget.reserved -= reserved;
      reserved = 0;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder().decode(bytes);
    } catch (error) {
      budget.reserved = Math.max(0, budget.reserved - reserved);
      throw error;
    }
  }

  async function fetchScriptAsset(assetUrl, pageOrigin, budget) {
    const parsed = new URL(assetUrl);
    if (parsed.origin !== pageOrigin) return { skipped: true };
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    try {
      const response = await fetch(assetUrl, {
        credentials: 'omit',
        cache: 'force-cache',
        redirect: 'follow',
        signal: controller.signal
      });
      if (response.url && new URL(response.url).origin !== pageOrigin) return { skipped: true };
      if (response.status !== 200) return { status: response.status };
      const contentType = response.headers.get('content-type') || '';
      if (/text\/html/i.test(contentType)) return { status: response.status, challenge: true };
      const text = await readBoundedAsset(response, budget, 320 * 1024);
      const name = safeObservedUrl(assetUrl).split('/').pop() || '(script)';
      return { source: { name, url: safeObservedUrl(assetUrl), text } };
    } catch (error) {
      return { error: error.name === 'AbortError' ? 'timeout' : error.message };
    } finally {
      clearTimeout(timeout);
    }
  }

  function redactCodeSnippet(value) {
    return String(value || '')
      .replace(/\bBearer\s+[^\s,"'}]+/gi, 'Bearer [REDACTED]')
      .replace(/([?&](?:access_token|refresh_token|token|api[_-]?key|client_secret|app_secret|signature)=)[^&#\s"'`<>]+/gi, '$1[REDACTED]')
      .replace(/(["']?(?:token|secret|password|authorization|cookie|csrf|api[_-]?key|signature|session|email|phone|mobile|user[_-]?id|account[_-]?id)[\w-]*["']?\s*:\s*)(["'`])[^"'`]{0,300}\2/gi, '$1"[REDACTED]"')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 320);
  }

  function findApiCandidates(sources) {
    const candidates = new Map();
    const routePattern = /\/(?:api|bapi|gateway-api)\/[A-Za-z0-9._~%!$&'()*+,;=:@/-]{1,220}/gi;
    for (const source of sources) {
      const text = source.text.replace(/\\\//g, '/').replace(/\\u002f/gi, '/');
      routePattern.lastIndex = 0;
      let match;
      while ((match = routePattern.exec(text)) && candidates.size < 40) {
        const route = match[0].split(/[?#]/, 1)[0].replace(/[.,;:]+$/, '').slice(0, 240);
        if (!/^\/(?:api|bapi|gateway-api)\//i.test(route)) continue;
        const key = route.toLowerCase();
        const contextStart = Math.max(0, match.index - 170);
        const contextEnd = Math.min(text.length, match.index + match[0].length + 220);
        const snippet = redactCodeSnippet(text.slice(contextStart, contextEnd));
        const existing = candidates.get(key);
        if (existing) {
          if (!existing.sources.includes(source.name) && existing.sources.length < 3) existing.sources.push(source.name);
          if (existing.context.length < 80 && snippet.length > existing.context.length) existing.context = snippet;
        } else {
          candidates.set(key, { endpoint: route, context: snippet, sources: [source.name] });
        }
      }
    }
    return Array.from(candidates.values()).slice(0, 30);
  }

  function showPageHttpStatus(status, challengeSignals = []) {
    apiPageStatus.replaceChildren();
    const blocked = status && [202, 403, 429].includes(Number(status.statusCode));
    if (!blocked && !challengeSignals.length) return;
    const box = document.createElement('div');
    box.className = `api-status ${blocked || challengeSignals.length ? 'warning' : ''}`;
    const parts = [];
    if (blocked) parts.push(`主頁 HTTP ${status.statusCode}${status.statusLine ? ` (${status.statusLine})` : ''}`);
    if (challengeSignals.length) parts.push(`頁面文字疑似挑戰頁：${challengeSignals.join('、')}`);
    box.textContent = `${parts.join('；')}。可能是 WAF／反機器人阻擋，靜態結果不完整；請在同一分頁完成驗證後再操作 API。`;
    apiPageStatus.appendChild(box);
  }

  async function armApiResponseCapture(urlIncludes) {
    if (!urlIncludes) return;
    try {
      const response = await fetch('http://127.0.0.1:8000/api/extension/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ARM_API_RESPONSE_CAPTURE', urlIncludes, durationMs: 15000, maxBytes: 16384 })
      });
      const result = await response.json();
      if (!response.ok || result.status !== 'OK') {
        showToast(result.message || result.error || '無法啟動擷取；請確認 Runtime 與 extension 已連線');
        return;
      }
      showToast('已啟動 15 秒單次擷取；切回此分頁並觸發該 API');
    } catch (_) {
      showToast('Crew Pocket Runtime 無法連線；請先啟動 Runtime 並確認 extension 已連線');
    }
  }

  function renderStaticCandidates() {
    apiCandidates.replaceChildren();
    if (!apiScanState.candidates.length) {
      const empty = document.createElement('div');
      empty.className = 'api-status';
      empty.textContent = '沒有找到 endpoint 字串。可能是 chunks 尚未載入、路徑由執行期組合，或掃描遇到限制。';
      apiCandidates.appendChild(empty);
      return;
    }
    for (const candidate of apiScanState.candidates) {
      const item = document.createElement('div');
      item.className = 'api-result';
      const route = document.createElement('div');
      route.className = 'api-route';
      route.textContent = candidate.endpoint;
      const meta = document.createElement('div');
      meta.className = 'api-meta';
      meta.textContent = `靜態候選 · ${candidate.sources.join(', ')}`;
      const context = document.createElement('div');
      context.className = 'api-context';
      context.textContent = candidate.context;
      const arm = document.createElement('button');
      arm.type = 'button';
      arm.className = 'api-button secondary';
      arm.textContent = '監聽此 endpoint 15 秒';
      arm.addEventListener('click', () => armApiResponseCapture(candidate.endpoint));
      item.append(route, meta, context, arm);
      apiCandidates.appendChild(item);
    }
  }

  async function loadRuntimeApiRecords(tabOverride) {
    runtimeApis.replaceChildren();
    const tab = tabOverride || await getTargetTab();
    if (!tab?.id) {
      runtimeApis.textContent = '沒有可讀取的網頁分頁。';
      return;
    }
    try {
      const response = await fetch('http://127.0.0.1:8000/api/extension/apis', { cache: 'no-store' });
      if (!response.ok) throw new Error('Runtime API 紀錄不可用');
      const data = await response.json();
      const records = (Array.isArray(data.recent) ? data.recent : [])
        .filter(record => Number(record.tabId) === Number(tab.id))
        .slice(-12)
        .reverse();
      if (!records.length) {
        runtimeApis.textContent = '尚無此分頁的 runtime 請求紀錄。載入頁面或操作一次後可重新整理查看。';
        return;
      }
      const blockedStatuses = [...new Set(records.map(record => Number(record.statusCode || record.status)).filter(code => [202, 403, 429].includes(code)))];
      if (blockedStatuses.length) {
        const warning = document.createElement('div');
        warning.className = 'api-status warning';
        warning.textContent = `Runtime 請求曾回應 HTTP ${blockedStatuses.join('、')}；可能遭 WAF、權限或速率限制。`;
        apiPageStatus.appendChild(warning);
      }
      for (const record of records) {
        const item = document.createElement('div');
        item.className = 'api-result';
        const route = document.createElement('div');
        route.className = 'api-route';
        route.textContent = safeObservedUrl(record.url) || '(URL 無法解析)';
        const meta = document.createElement('div');
        meta.className = 'api-meta';
        const status = record.statusCode ?? record.status ?? record.error ?? '未知';
        meta.textContent = `Runtime 已觀測 · ${String(record.method || 'GET').toUpperCase()} · ${status}`;
        const arm = document.createElement('button');
        arm.type = 'button';
        arm.className = 'api-button secondary';
        arm.textContent = '監聽此 endpoint 15 秒';
        arm.addEventListener('click', () => {
          try { armApiResponseCapture(new URL(record.url).pathname); }
          catch (_) { showToast('無效的 API URL'); }
        });
        item.append(route, meta, arm);
        runtimeApis.appendChild(item);
      }
    } catch (_) {
      runtimeApis.textContent = '無法連接 Crew Pocket Runtime；可先使用靜態掃描，runtime 紀錄會在 Runtime 連線後顯示。';
    }
  }

  async function scanCurrentPageApis() {
    scanApiBtn.disabled = true;
    sendApiFindingsBtn.disabled = true;
    apiScanStatus.className = 'api-status';
    apiScanStatus.textContent = '正在讀取目前分頁的同源 script、preload 與已載入 chunks…';
    apiCandidates.replaceChildren();
    apiPageStatus.replaceChildren();
    try {
      const tab = await getTargetTab();
      if (!tab?.id || !/^https?:\/\//.test(tab.url || '')) throw new Error('請先開啟 HTTP 或 HTTPS 網頁。');
      const injected = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageScanInputs });
      const page = injected?.[0]?.result;
      if (!page || page.error) throw new Error(page?.error || '無法讀取目前分頁。');

      apiScanState.pageUrl = safeObservedUrl(page.pageUrl);
      apiScanState.pageTitle = String(page.pageTitle || '').slice(0, 240);
      apiScanState.tabId = tab.id;
      apiScanState.challengeSignals = Array.isArray(page.challengeSignals) ? page.challengeSignals.slice(0, 8) : [];
      apiScanState.pageStatus = await getPageHttpStatus(tab.id);
      showPageHttpStatus(apiScanState.pageStatus, apiScanState.challengeSignals);

      const sources = (page.inlineScripts || []).map((text, index) => ({ name: `inline-script-${index + 1}`, url: apiScanState.pageUrl, text }));
      const assets = Array.isArray(page.assets) ? page.assets.slice(0, 18) : [];
      const budget = { used: 0, reserved: 0, maxBytes: 2 * 1024 * 1024 };
      let nextAsset = 0;
      let fetchedAssets = 0;
      let challengeAsset = false;
      const worker = async () => {
        while (nextAsset < assets.length) {
          const index = nextAsset++;
          const result = await fetchScriptAsset(assets[index], new URL(page.pageUrl).origin, budget);
          if (result.source) {
            sources.push(result.source);
            fetchedAssets += 1;
          }
          if (result.challenge || result.status === 202 || result.status === 403) challengeAsset = true;
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, assets.length) }, worker));
      apiScanState.assetsScanned = fetchedAssets;
      apiScanState.candidates = findApiCandidates(sources);
      if (challengeAsset && !apiScanState.challengeSignals.includes('腳本資源遭阻擋')) apiScanState.challengeSignals.push('腳本資源遭阻擋');
      showPageHttpStatus(apiScanState.pageStatus, apiScanState.challengeSignals);
      renderStaticCandidates();
      apiScanStatus.textContent = `掃描完成：${fetchedAssets} 個同源 JS、${budget.used} bytes、${apiScanState.candidates.length} 個靜態候選。回應是否實際觸發，需用 runtime capture 確認。`;
      if (challengeAsset) apiScanStatus.classList.add('warning');
      sendApiFindingsBtn.disabled = false;
      await loadRuntimeApiRecords(tab);
    } catch (error) {
      apiScanStatus.className = 'api-status error';
      apiScanStatus.textContent = error.message || '掃描失敗。';
      apiCandidates.textContent = '沒有可顯示的結果。';
      await loadRuntimeApiRecords();
    } finally {
      scanApiBtn.disabled = false;
    }
  }

  scanApiBtn.addEventListener('click', scanCurrentPageApis);
  sendApiFindingsBtn.addEventListener('click', () => {
    const message = {
      source: 'CREW_POCKET_EXTENSION',
      type: 'API_STATIC_SCAN',
      url: apiScanState.pageUrl,
      tabId: apiScanState.tabId,
      timestamp: Date.now(),
      payload: {
        url: apiScanState.pageUrl,
        tabId: apiScanState.tabId,
        title: apiScanState.pageTitle,
        evidenceLevel: 'static-candidate',
        assetsScanned: apiScanState.assetsScanned,
        candidates: apiScanState.candidates.slice(0, 30),
        mainFrameStatus: apiScanState.pageStatus ? {
          statusCode: apiScanState.pageStatus.statusCode,
          statusLine: apiScanState.pageStatus.statusLine
        } : null,
        challengeSignals: apiScanState.challengeSignals.slice(0, 8),
        scannedAt: Date.now()
      }
    };
    chrome.runtime.sendMessage(message, response => {
      const error = chrome.runtime.lastError;
      showToast(error ? '無法送至 Extension Bridge' : '已送出精簡掃描摘要至本機 Extension Bridge');
      void response;
    });
  });

  loadPageData();
});
