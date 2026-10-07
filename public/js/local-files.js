// Read local file links inside Pocket; WebView does not own browser tabs.
(function () {
  const localRoot = /^\/(?:data\/(?:data|user(?:_de)?\/\d+)|storage|sdcard|mnt)(?:\/|$)/;
  let modal;
  let controller;
  let opener;
  let content = '';

  function positiveLine(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }

  function parse(href) {
    if (!href || /^\s*(?:javascript|data|blob):/i.test(href)) return null;
    let address;
    try { address = new URL(href, window.location.origin); } catch (_) { return null; }
    const file = address.protocol === 'file:' && (!address.hostname || address.hostname === 'localhost');
    if (!file && address.origin !== window.location.origin) return null;
    if (!file && address.pathname === '/api/file/read') {
      const path = address.searchParams.get('path');
      if (!path) return null;
      return { path, absolute: address.searchParams.get('absolute') === '1',
        source: address.searchParams.get('source') === 'app' ? 'app' : null,
        line: positiveLine(address.searchParams.get('line')) };
    }
    if (!localRoot.test(address.pathname)) return null;
    let path = address.pathname;
    let line = positiveLine(address.hash.match(/^#L?(\d+)(?:[-:]L?\d+)?$/i)?.[1]);
    const suffix = path.match(/:(\d+)(?::\d+)?$/);
    if (suffix) {
      line = line || positiveLine(suffix[1]);
      path = path.slice(0, -suffix[0].length);
    }
    try { path = decodeURIComponent(path); } catch (_) {}
    return { path, absolute: true, source: null, line };
  }

  function url(target) {
    const query = new URLSearchParams({ path: target.path });
    if (target.absolute) query.set('absolute', '1');
    if (target.source) query.set('source', target.source);
    if (target.line) query.set('line', String(target.line));
    return `/api/file/read?${query}`;
  }

  function close() {
    controller?.abort();
    controller = null;
    if (modal) modal.hidden = true;
    opener?.focus();
  }

  function createModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'local-file-reader';
    modal.className = 'fixed inset-0 z-[70] bg-black/80 p-3';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'local-file-title');
    modal.innerHTML = `
      <section class="mx-auto flex h-[88dvh] max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <header class="flex shrink-0 items-center gap-2 border-b border-slate-800 px-3 py-2">
          <div class="min-w-0 flex-1"><h2 id="local-file-title" class="truncate text-sm font-semibold text-white">檔案預覽</h2>
          <p data-file-path class="break-all text-[10px] text-slate-400"></p></div>
          <button data-file-copy class="min-h-10 rounded-lg bg-slate-800 px-3 text-xs text-slate-200" disabled>複製</button>
          <button data-file-close class="min-h-10 rounded-lg px-3 text-slate-300" aria-label="關閉檔案預覽">✕</button>
        </header>
        <div data-file-body class="min-h-0 flex-1 overflow-auto p-3 text-sm text-slate-200"></div>
      </section>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-file-close]').addEventListener('click', close);
    modal.addEventListener('click', event => { if (event.target === modal) close(); });
    modal.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      if (event.key === 'Tab') {
        const buttons = Array.from(modal.querySelectorAll('button:not(:disabled), a[href]'));
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    });
    modal.querySelector('[data-file-copy]').addEventListener('click', () => {
      if (typeof copyToClipboard === 'function') copyToClipboard(content, modal.querySelector('[data-file-copy]'));
    });
    return modal;
  }

  function renderText(body, data, target) {
    if (!target.line && ['.md', '.markdown'].includes(data.ext) && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
      body.classList.add('prose');
      body.innerHTML = DOMPurify.sanitize(marked.parse(data.content), {
        USE_PROFILES: { html: true },
        FORBID_TAGS: ['iframe', 'style', 'form', 'input', 'button'],
        FORBID_ATTR: ['style']
      });
      for (const link of body.querySelectorAll('a[href]')) {
        const href = link.getAttribute('href');
        let local = parse(href);
        if (!local && /^(?:\.\.?\/)?[^:?#]+\.(?:md|markdown|txt|js|ts|json|py|kt|sh)(?:[#:]\d.*)?$/i.test(href)) {
          const directory = data.fullPath.slice(0, data.fullPath.lastIndexOf('/') + 1);
          local = parse(new URL(href, `file://${directory}`).href);
        }
        if (local) { link.href = url(local); link.removeAttribute('target'); }
      }
      return;
    }
    const pre = document.createElement('pre');
    pre.className = 'whitespace-pre font-mono text-xs leading-5';
    const lines = data.content.split('\n');
    if (target.line && target.line <= lines.length) {
      const selected = document.createElement('mark');
      selected.className = 'bg-amber-400/20 text-amber-100';
      selected.textContent = lines[target.line - 1];
      pre.append(document.createTextNode(lines.slice(0, target.line - 1).join('\n') + (target.line > 1 ? '\n' : '')),
        selected, document.createTextNode(target.line < lines.length ? '\n' + lines.slice(target.line).join('\n') : ''));
      body.appendChild(pre);
      requestAnimationFrame(() => { if (selected.isConnected) body.scrollTop = selected.offsetTop - body.offsetTop - 30; });
    } else {
      pre.textContent = data.content;
      body.appendChild(pre);
    }
  }

  async function open(target, anchor) {
    const reader = createModal();
    controller?.abort();
    const request = new AbortController();
    controller = request;
    opener = anchor || document.activeElement;
    content = '';
    reader.hidden = false;
    reader.querySelector('#local-file-title').textContent = '檔案預覽';
    reader.querySelector('[data-file-path]').textContent = target.path + (target.line ? `:${target.line}` : '');
    const copy = reader.querySelector('[data-file-copy]');
    copy.disabled = true;
    const body = reader.querySelector('[data-file-body]');
    body.classList.remove('prose');
    body.textContent = '正在讀取檔案…';
    body.scrollTop = 0;
    reader.querySelector('[data-file-close]').focus();
    try {
      const response = await fetch(url(target), { signal: request.signal });
      const data = await response.json();
      if (request !== controller) return;
      if (!response.ok || !data.success) throw new Error(data.error || '無法讀取檔案');
      reader.querySelector('#local-file-title').textContent = data.name + (target.line ? ` · 第 ${target.line} 行` : '');
      body.replaceChildren();
      if (data.type === 'image') {
        const image = document.createElement('img');
        image.className = 'max-w-full';
        image.alt = data.name;
        image.src = `/api/image?path=${encodeURIComponent(data.fullPath)}`;
        body.appendChild(image);
      } else {
        content = data.content;
        copy.disabled = false;
        renderText(body, data, target);
      }
    } catch (error) {
      if (request !== controller || error.name === 'AbortError') return;
      body.textContent = `無法開啟：${error.message}`;
    }
  }

  window.CrewLocalFiles = { parse, url, open };
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('#messages-container a[href], #local-file-reader a[href]');
    if (!anchor) return;
    const target = parse(anchor.getAttribute('href'));
    if (!target) return;
    event.preventDefault();
    open(target, anchor);
  }, true);
})();
