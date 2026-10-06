(() => {
  const storageKey = 'crew-terminal-session';
  let id = null, term = null, fit = null, events = null, cursor = 0, ended = false;
  let inputQueue = Promise.resolve(), opening = null;
  const panel = document.createElement('section');
  panel.id = 'terminal-panel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Terminal');
  panel.innerHTML = `<header><strong>Terminal</strong><span id="terminal-status" role="status">尚未啟動</span><button type="button" id="terminal-start">開啟</button><button type="button" id="terminal-end">結束</button><button type="button" id="terminal-hide">返回對話</button></header>
    <p class="terminal-note">專案預設放在 ~/projects。返回對話會保留終端；結束會停止 shell 與前景命令。</p>
    <div id="terminal-screen"></div>
    <nav aria-label="終端快捷鍵"><button data-input="interrupt">Ctrl+C</button><button data-input="tab">Tab</button><button data-input="up">↑</button><button data-input="down">↓</button><button data-input="escape">Esc</button><button data-input="eof">Ctrl+D</button><button id="terminal-paste">貼上</button></nav>
    <form id="terminal-command"><input id="terminal-command-input" aria-label="輸入終端指令" placeholder="git clone https://github.com/帳號/專案.git" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="submit">送出 ↵</button></form>`;
  document.body.appendChild(panel);
  const status = panel.querySelector('#terminal-status');
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = '/css/terminal.css'; document.head.appendChild(css);
  function message(text) { status.textContent = text; }
  function savedId() { try { return localStorage.getItem(storageKey); } catch (_) { return null; } }
  function saveId(value) { try { if (value) localStorage.setItem(storageKey, value); else localStorage.removeItem(storageKey); } catch (_) {} }
  async function api(suffix, options = {}) {
    const response = await fetch('/api/terminal' + suffix, { ...options, headers: { 'Content-Type': 'application/json' } });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`); return data;
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => { const script = document.createElement('script'); script.src = src; script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('無法載入終端元件')); }; document.head.appendChild(script); });
  }
  function calibrateTextScale() {
    const screen = panel.querySelector('#terminal-screen');
    // Android WebView applies the system font scale to DOM text, while xterm's
    // canvas glyph measurements remain unscaled. Keep both on the same grid.
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;font-size:13px;-webkit-text-size-adjust:100%;text-size-adjust:100%';
    probe.textContent = 'W'; screen.appendChild(probe);
    const measured = parseFloat(getComputedStyle(probe).fontSize);
    probe.remove();
    if (!Number.isFinite(measured) || measured <= 0) return;
    const percentage = 100 * 13 / measured;
    const adjustment = `${percentage}%`;
    if (Math.abs(parseFloat(screen.style.webkitTextSizeAdjust) - percentage) > 0.001 || !screen.style.webkitTextSizeAdjust) {
      screen.style.webkitTextSizeAdjust = adjustment;
      screen.style.textSizeAdjust = adjustment;
      if (term) term.refresh(0, term.rows - 1);
    }
  }
  async function initialize() {
    if (term) return;
    const stylesheet = document.createElement('link'); stylesheet.rel = 'stylesheet'; stylesheet.href = '/vendor/xterm/xterm.css'; document.head.appendChild(stylesheet);
    if (!window.Terminal) await loadScript('/vendor/xterm/xterm.js');
    if (!window.FitAddon) await loadScript('/vendor/xterm/fit-addon-fit.js');
    term = new window.Terminal({ fontSize: 13, scrollback: 3000, theme: { background: '#020617', foreground: '#e2e8f0', cursor: '#6ee7b7' } });
    fit = new window.FitAddon.FitAddon(); term.loadAddon(fit); term.open(panel.querySelector('#terminal-screen'));
    term.onData(data => input(data));
    term.onResize(size => { if (id && !ended) enqueue('/resize', { rows: size.rows, cols: size.cols }); });
    new ResizeObserver(() => { if (!panel.hidden) { calibrateTextScale(); fit.fit(); } }).observe(panel.querySelector('#terminal-screen'));
  }
  function enqueue(suffix, body) {
    const target = id;
    inputQueue = inputQueue.then(() => { if (id === target && target && !ended) return api(`/${target}${suffix}`, { method: 'POST', body: JSON.stringify(body) }); }).catch(error => message(error.message));
  }
  function input(data) { if (id && !ended) enqueue('/input', { data }); else message('請按「開啟」建立終端'); }
  function connect() {
    if (events) events.close();
    const stream = events = new EventSource(`/api/terminal/${id}/events?after=${cursor}`);
    stream.addEventListener('open', () => message('已連線'));
    stream.addEventListener('output', event => {
      const sequence = Number(event.lastEventId); if (sequence <= cursor) return; cursor = sequence;
      const raw = atob(JSON.parse(event.data).bytes); term.write(Uint8Array.from(raw, char => char.charCodeAt(0)));
    });
    stream.addEventListener('gap', () => term.writeln('\r\n[部分較早的輸出已超出保留範圍]\r\n'));
    stream.addEventListener('exit', event => {
      cursor = Number(event.lastEventId); ended = true; stream.close();
      const result = JSON.parse(event.data); message(result.error || `終端已結束 (${result.exitCode})`);
    });
    stream.onerror = async () => {
      if (events !== stream) return;
      message('連線中斷，正在重新連線…');
      try { const state = await api(`/${id}`); if (events === stream && state.ended) { stream.close(); ended = true; message('終端已結束'); } }
      catch (_) { if (events !== stream) return; stream.close(); id = null; saveId(null); message('Runtime 無法連線或終端已不存在，請按「開啟」重試'); }
    };
  }
  async function open() {
    document.getElementById('tools-sheet-close-btn')?.click(); panel.hidden = false; viewport();
    calibrateTextScale();
    if (opening) return opening;
    opening = (async () => {
      await initialize();
      if (!id) id = savedId();
      if (id) {
        try { const state = await api(`/${id}`); if (state.ended) { await api(`/${id}`, { method: 'DELETE' }); id = null; } }
        catch (_) { id = null; }
      }
      if (!id) {
        message('啟動中…'); const session = await api('', { method: 'POST', body: '{}' });
        id = session.id; saveId(id); cursor = 0; ended = false; term.reset();
      }
      ended = false; connect(); fit.fit(); enqueue('/resize', { rows: term.rows, cols: term.cols }); if (!panel.hidden) term.focus();
    })().catch(error => { message(error.message); }).finally(() => { opening = null; });
    return opening;
  }
  function hide() { panel.hidden = true; if (events) { events.close(); events = null; } }
  async function end() {
    if (opening) await opening;
    if (!id) return;
    try {
      await api(`/${id}`, { method: 'DELETE' });
      if (events) { events.close(); events = null; } id = null; ended = true; saveId(null); message('已結束，不再保留 shell');
    } catch (error) { message(error.message); }
  }
  function viewport() {
    const view = window.visualViewport;
    panel.style.height = `${view?.height || window.innerHeight}px`; panel.style.top = `${view?.offsetTop || 0}px`;
  }
  window.visualViewport?.addEventListener('resize', viewport); window.visualViewport?.addEventListener('scroll', viewport);
  window.addEventListener('resize', viewport);
  document.getElementById('terminal-menu-btn')?.addEventListener('click', open);
  panel.querySelector('#terminal-start').addEventListener('click', open);
  panel.querySelector('#terminal-hide').addEventListener('click', hide);
  panel.querySelector('#terminal-end').addEventListener('click', end);
  const keys = { interrupt: '\x03', tab: '\t', up: '\x1b[A', down: '\x1b[B', escape: '\x1b', eof: '\x04' };
  panel.querySelectorAll('[data-input]').forEach(button => button.addEventListener('click', () => { input(keys[button.dataset.input]); term?.focus(); }));
  panel.querySelector('#terminal-command').addEventListener('submit', event => {
    event.preventDefault(); const field = panel.querySelector('#terminal-command-input');
    if (id && !ended) { input(field.value + '\r'); field.value = ''; } else message('請先開啟終端');
  });
  panel.querySelector('#terminal-paste').addEventListener('click', async () => {
    try { if (id && !ended) term.paste(await navigator.clipboard.readText()); } catch (_) { message('請長按指令欄貼上'); }
  });
  document.addEventListener('keydown', event => { if (!panel.hidden && event.key === 'Escape' && event.target !== term?.textarea) hide(); });
})();
