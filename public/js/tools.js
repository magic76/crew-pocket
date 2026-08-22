// Antigravity Web UI - Tools (GPS, Sandbox Runners, Code Highlighter, Image Compressor, TTS)

// ⚡ Fast Client-Side Image Compression (Max 1280px, ~120KB JPEG, HEIC/HEIF supported for AI Vision)
async function compressImageFile(file, maxWidth = 1280, quality = 0.8) {
  let sourceBlob = file;

  // 🍏 HEIC/HEIF Automatic Decoding (iPhone / Samsung Gallery)
  const isHeic = (file.name && (/\.heic$/i.test(file.name) || /\.heif$/i.test(file.name))) ||
                 file.type === 'image/heic' || file.type === 'image/heif';

  if (isHeic) {
    if (typeof heic2any !== 'undefined') {
      try {
        console.log('[ImageCompressor] 🍏 Converting HEIC/HEIF to JPEG...');
        const conversionResult = await heic2any({
          blob: file,
          toType: 'image/jpeg',
          quality: 0.85
        });
        sourceBlob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
      } catch (err) {
        console.warn('[ImageCompressor] HEIC conversion warning:', err);
      }
    } else {
      console.warn('[ImageCompressor] heic2any library not loaded, attempting standard decode');
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        try {
          let width = img.naturalWidth || img.width;
          let height = img.naturalHeight || img.height;

          // Scale down for AI vision analysis (lightweight, ~100-150KB)
          if (width > maxWidth || height > maxWidth) {
            if (width > height) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            } else {
              width = Math.round((width * maxWidth) / height);
              height = maxWidth;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
          const approxKb = Math.round((compressedBase64.length * 3) / 4 / 1024);
          resolve({ base64: compressedBase64, kb: approxKb });
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = (err) => reject(new Error('圖片載入失敗，格式可能不受支援或檔案損毀'));
      img.src = event.target.result;
      if (img.complete && img.naturalWidth > 0) {
        img.onload();
      }
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(sourceBlob);
  });
}

// 🌐 Browser Sandbox Runner (DOM / Canvas / Chart.js / Web Audio)
function runInBrowserSandbox(rawCode, pre) {
  let outputBox = pre.nextElementSibling;
  if (!outputBox || !outputBox.classList.contains('code-output-box')) {
    outputBox = document.createElement('div');
    outputBox.className = 'code-output-box mt-2 p-3 rounded-2xl bg-slate-950 border border-indigo-500/40 font-mono text-[11px] select-text shadow-xl';
    pre.parentNode.insertBefore(outputBox, pre.nextSibling);
  }

  const startTs = performance.now();

  outputBox.innerHTML = `
    <div class="flex items-center justify-between text-[10px] text-slate-400 border-b border-slate-800 pb-1.5 mb-2 select-none">
      <span class="flex items-center gap-1.5 text-indigo-300 font-semibold font-mono">
        <span class="w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
        🌐 瀏覽器動態渲染視窗
      </span>
      <button type="button" class="close-output-btn text-slate-500 hover:text-slate-200 text-[10px] px-1.5 py-0.5 rounded hover:bg-slate-800 transition">✕ 關閉</button>
    </div>
    <div class="render-target w-full min-h-0 mb-2 overflow-x-auto flex flex-col items-center justify-center gap-2"></div>
    <pre class="console-box whitespace-pre-wrap leading-relaxed text-emerald-300 font-mono text-[11px] max-h-40 overflow-y-auto bg-black/60 p-2 rounded-lg border border-slate-800 hidden"></pre>
  `;

  outputBox.querySelector('.close-output-btn').onclick = () => outputBox.remove();

  const renderTarget = outputBox.querySelector('.render-target');
  const consoleBox = outputBox.querySelector('.console-box');

  const iframe = document.createElement('iframe');
  iframe.sandbox = "allow-scripts";
  iframe.className = "w-full border-0";
  iframe.style.minHeight = "300px";
  
  const escapedCode = JSON.stringify(rawCode);
  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <script src="https://cdn.jsdelivr.net/npm/chart.js"><\/script>
  <style>
    body { margin: 0; padding: 4px; display: flex; flex-direction: column; align-items: center; background: transparent; color: white; font-family: monospace; }
    canvas { max-width: 100%; border-radius: 0.5rem; border: 1px solid #1e293b; background: rgba(15, 23, 42, 0.6); }
  </style>
</head>
<body>
  <div id="container" style="width: 100%; display: flex; flex-direction: column; align-items: center;">
    <canvas id="canvas"></canvas>
  </div>
  <script>
    ['log', 'error', 'warn'].forEach(method => {
      const original = console[method];
      console[method] = function(...args) {
        window.parent.postMessage({ type: 'console', method, args: args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)) }, '*');
        original.apply(console, args);
      };
    });
    try {
      const container = document.getElementById('container');
      const canvas = document.getElementById('canvas');
      canvas.width = Math.min(window.innerWidth - 32, 480);
      canvas.height = Math.round(canvas.width * 0.62);
      const ctx = canvas.getContext('2d');
      
      const runner = new Function('container', 'canvas', 'ctx', 'console', 'Chart', ${escapedCode});
      runner(container, canvas, ctx, console, window.Chart);
      
      window.parent.postMessage({ type: 'done' }, '*');
    } catch (err) {
      console.error(err.message);
      window.parent.postMessage({ type: 'error' }, '*');
    }
  <\/script>
</body>
</html>`;
  
  iframe.srcdoc = htmlContent;
  renderTarget.appendChild(iframe);

  const logs = [];
  const messageHandler = (e) => {
    if (e.source !== iframe.contentWindow) return;
    
    if (e.data.type === 'console') {
      const prefix = e.data.method === 'error' ? '[ERR] ' : e.data.method === 'warn' ? '[WARN] ' : '';
      logs.push(prefix + e.data.args.join(' '));
      consoleBox.classList.remove('hidden');
      consoleBox.textContent = logs.join('\n');
    } else if (e.data.type === 'done') {
      const elapsed = (performance.now() - startTs).toFixed(1);
      outputBox.querySelector('span.font-mono').innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400"></span> 🌐 瀏覽器渲染完成 (${elapsed}ms)`;
      if (navigator.vibrate) navigator.vibrate(30);
    } else if (e.data.type === 'error') {
      outputBox.querySelector('span.font-mono').innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-400"></span> 🌐 執行報錯`;
    }
  };
  window.addEventListener('message', messageHandler);

  const closeBtn = outputBox.querySelector('.close-output-btn');
  const originalOnclick = closeBtn.onclick;
  closeBtn.onclick = () => {
    window.removeEventListener('message', messageHandler);
    originalOnclick();
  };
}

// 💻 Helper: Execute in Termux Backend (Python, Node.js, Bash)
async function runInBackendSandbox(rawCode, lang, pre, btn) {
  const originalBtnHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="inline-block w-2.5 h-2.5 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin"></span><span>執行中...</span>`;

  let outputBox = pre.nextElementSibling;
  if (!outputBox || !outputBox.classList.contains('code-output-box')) {
    outputBox = document.createElement('div');
    outputBox.className = 'code-output-box mt-2 p-2.5 rounded-xl bg-black/95 border border-slate-700 font-mono text-[11px] select-text shadow-lg';
    pre.parentNode.insertBefore(outputBox, pre.nextSibling);
  }

  outputBox.innerHTML = `
    <div class="flex items-center justify-between text-[10px] text-slate-400 border-b border-slate-800 pb-1 mb-1.5 select-none">
      <span class="flex items-center gap-1.5 text-indigo-400 font-semibold font-mono">
        <span class="inline-block w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
        直譯執行中 (${lang})...
      </span>
    </div>
    <div class="text-slate-500 text-[11px] font-mono animate-pulse">正在 Termux 環境中調度直譯器...</div>
  `;

  try {
    const res = await fetch('/api/run-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: rawCode, language: lang })
    });
    const data = await res.json();

    const isSuccess = data.success;
    const statusColor = isSuccess ? 'text-emerald-400' : 'text-rose-400';
    const statusDot = isSuccess ? 'bg-emerald-400' : 'bg-rose-400';
    const displayText = (data.output || '') + (data.error ? (data.output ? '\n' : '') + data.error : '');

    outputBox.innerHTML = `
      <div class="flex items-center justify-between text-[10px] text-slate-400 border-b border-slate-800 pb-1 mb-1.5 select-none">
        <span class="flex items-center gap-1.5 ${statusColor} font-semibold font-mono">
          <span class="w-1.5 h-1.5 rounded-full ${statusDot}"></span>
          ${isSuccess ? '執行完成' : '執行異常'} (${data.duration_ms || 0}ms)
        </span>
        <button type="button" class="close-output-btn text-slate-500 hover:text-slate-200 text-[10px] px-1.5 py-0.5 rounded hover:bg-slate-800 transition">✕ 關閉</button>
      </div>
      <pre class="whitespace-pre-wrap leading-relaxed ${isSuccess ? 'text-slate-200' : 'text-rose-300'} font-mono overflow-x-auto text-[11px] max-h-60 overflow-y-auto bg-transparent border-0 p-0 m-0">${escapeHtml(displayText || '(無輸出內容)')}</pre>
    `;

    outputBox.querySelector('.close-output-btn').onclick = () => outputBox.remove();
    if (navigator.vibrate) navigator.vibrate(30);

  } catch (err) {
    outputBox.innerHTML = `
      <div class="flex items-center justify-between text-[10px] text-rose-400 border-b border-slate-800 pb-1 mb-1.5">
        <span>執行請求失敗</span>
        <button type="button" class="close-output-btn text-slate-500 hover:text-slate-200 text-[10px]">✕</button>
      </div>
      <div class="text-rose-400 text-[11px]">${escapeHtml(err.message)}</div>
    `;
    outputBox.querySelector('.close-output-btn').onclick = () => outputBox.remove();
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalBtnHtml;
  }
}

// Enhance code blocks: Convert HTML/SVG into Ultra-Clean Action Cards
function enhanceCodeBlocks(container) {
  const pres = container.querySelectorAll('pre');
  pres.forEach(pre => {
    if (pre.dataset.enhanced) return;
    pre.dataset.enhanced = 'true';

    const codeEl = pre.querySelector('code');
    if (!codeEl) return;

    // Capture pure original raw code BEFORE highlight modifies DOM
    const rawCode = codeEl.textContent || codeEl.innerText;
    let lang = 'CODE';
    codeEl.classList.forEach(cls => {
      if (cls.startsWith('language-')) lang = cls.replace('language-', '').toUpperCase();
    });

    if (typeof hljs !== 'undefined') hljs.highlightElement(codeEl);

    const isHtml = lang === 'HTML' || lang === 'XML' || lang === 'SVG' || /<(!DOCTYPE\s+html|html\b|svg\b)/i.test(rawCode);

    if (isHtml) {
      let processedCode = rawCode;

      // Extract pure HTML/SVG if preceded by ASCII frames or commentary
      const htmlStartMatch = processedCode.match(/<(!DOCTYPE\s+html|html\b|svg\b)/i);
      if (htmlStartMatch && htmlStartMatch.index > 0) {
        processedCode = processedCode.slice(htmlStartMatch.index);
      }

      // 1. Inject <base href="..."> so relative paths (e.g. icons/..., uploads/..., css/...) resolve directly to our server origin
      const baseOrigin = window.location.origin;
      const baseTag = `<base href="${baseOrigin}/">`;

      if (/<head\b[^>]*>/i.test(processedCode)) {
        processedCode = processedCode.replace(/(<head\b[^>]*>)/i, `$1\n  ${baseTag}`);
      } else if (/<html\b[^>]*>/i.test(processedCode)) {
        processedCode = processedCode.replace(/(<html\b[^>]*>)/i, `$1\n<head>\n  ${baseTag}\n</head>`);
      } else {
        processedCode = `${baseTag}\n${processedCode}`;
      }

      // 2. Smart Path Rewriter: Auto-convert local absolute paths (/data/data/..., /sdcard/..., /storage/...) to /api/image?path=...
      processedCode = processedCode.replace(/(src|href|url)\s*=\s*(["'])((\/data\/data\/|\/storage\/|\/sdcard\/)[^\s"'>]+\.(png|jpg|jpeg|webp|svg|gif|ico))\2/gi, (match, attr, quote, localPath) => {
        return `${attr}=${quote}/api/image?path=${encodeURIComponent(localPath)}${quote}`;
      });

      const blob = new Blob([processedCode], { type: 'text/html;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      activeBlobUrls.add(blobUrl);
      const typeLabel = lang === 'SVG' ? 'SVG 視覺圖形' : 'HTML 網頁產物';

      const card = document.createElement('div');
      card.className = 'my-2.5 not-prose';

      card.innerHTML = `
        <div class="p-3 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800/90 border border-slate-700/80 shadow-md flex flex-col gap-2.5">
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-2.5 min-w-0">
              <div class="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                </svg>
              </div>
              <div class="min-w-0">
                <div class="text-xs font-semibold text-white truncate">🌐 ${typeLabel}</div>
                <div class="text-[10px] text-slate-400">點擊開啟全螢幕或展開預覽</div>
              </div>
            </div>
            <div class="flex items-center gap-1.5 shrink-0 ml-auto">
              <!-- Native unblockable anchor link -->
              <a href="${blobUrl}" target="_blank" class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-emerald-900/40 active:scale-95 transition no-underline">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                </svg>
                <span>開啟預覽</span>
              </a>
              <button type="button" class="card-copy-btn p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition border border-slate-700 active:scale-95" title="複製 HTML 原始碼">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                </svg>
              </button>
            </div>
          </div>
          <!-- Optional on-demand inline sandbox expander -->
          <details class="border-t border-slate-800/80 pt-2 text-xs">
            <summary class="cursor-pointer text-indigo-400 hover:text-indigo-300 font-mono text-[11px] select-none flex items-center justify-between">
              <span>📱 在對話框中直接展開小視窗</span>
              <span class="text-[10px] text-slate-500">點擊展開 ▼</span>
            </summary>
            <div class="sandbox-container mt-2 h-72 rounded-xl overflow-hidden bg-slate-950 border border-slate-700 relative">
              <!-- Lazy created iframe -->
            </div>
          </details>
        </div>
      `;

      const cardCopyBtn = card.querySelector('.card-copy-btn');
      const detailsExpander = card.querySelector('details');
      const sandboxContainer = card.querySelector('.sandbox-container');

      cardCopyBtn.onclick = (e) => {
        e.stopPropagation();
        copyToClipboard(rawCode, cardCopyBtn);
      };

      detailsExpander.ontoggle = () => {
        if (detailsExpander.open && !sandboxContainer.querySelector('iframe')) {
          const inlineFrame = document.createElement('iframe');
          inlineFrame.className = 'w-full h-full border-0 absolute inset-0';
          inlineFrame.sandbox = 'allow-scripts allow-forms allow-popups';
          inlineFrame.src = blobUrl;
          sandboxContainer.appendChild(inlineFrame);
        }
      };

      if (pre.parentNode) {
        pre.parentNode.replaceChild(card, pre);
      } else {
        container.appendChild(card);
      }
    } else {
      // Standard code blocks (Python, Shell, JS, JSON, etc.)
      const header = document.createElement('div');
      header.className = 'flex items-center justify-between px-2.5 py-1 bg-slate-800/90 border-b border-slate-700/60 text-[11px] font-mono text-slate-400 select-none rounded-t-lg -mx-2.5 -mt-2.5 mb-2';

      const langLabel = document.createElement('span');
      langLabel.className = 'font-semibold text-slate-300 text-[10px] tracking-wider';
      langLabel.textContent = lang;
      header.appendChild(langLabel);

      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'flex items-center gap-1.5';

      const lowerLang = lang.toLowerCase();
      const isJs = ['javascript', 'js', 'node'].includes(lowerLang);
      const isOtherExecutable = ['python', 'py', 'bash', 'sh', 'shell', 'zsh'].includes(lowerLang);

      if (isJs) {
        // 🌐 Browser Sandbox Runner
        const browserRunBtn = document.createElement('button');
        browserRunBtn.type = 'button';
        browserRunBtn.className = 'px-2 py-0.5 rounded bg-indigo-950/80 border border-indigo-700/60 hover:bg-indigo-900 text-indigo-300 text-[10px] font-mono flex items-center gap-1 transition active:scale-95';
        browserRunBtn.innerHTML = `<svg class="w-3 h-3 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg><span>瀏覽器渲染</span>`;
        browserRunBtn.onclick = (e) => {
          e.stopPropagation();
          runInBrowserSandbox(rawCode, pre);
        };
        actionsContainer.appendChild(browserRunBtn);

        // 💻 Backend Node.js Runner
        const nodeRunBtn = document.createElement('button');
        nodeRunBtn.type = 'button';
        nodeRunBtn.className = 'px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/60 hover:bg-emerald-900 text-emerald-300 text-[10px] font-mono flex items-center gap-1 transition active:scale-95';
        nodeRunBtn.innerHTML = `<svg class="w-3 h-3 text-emerald-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg><span>Node.js</span>`;
        nodeRunBtn.onclick = (e) => {
          e.stopPropagation();
          runInBackendSandbox(rawCode, 'javascript', pre, nodeRunBtn);
        };
        actionsContainer.appendChild(nodeRunBtn);
      } else if (isOtherExecutable) {
        // Python / Bash Backend Runner
        const runBtn = document.createElement('button');
        runBtn.type = 'button';
        runBtn.className = 'px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-700/60 hover:bg-emerald-900 text-emerald-300 text-[10px] font-mono flex items-center gap-1 transition active:scale-95';
        runBtn.innerHTML = `<svg class="w-3 h-3 text-emerald-400" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"/></svg><span>執行</span>`;
        runBtn.onclick = (e) => {
          e.stopPropagation();
          runInBackendSandbox(rawCode, lowerLang, pre, runBtn);
        };
        actionsContainer.appendChild(runBtn);
      }

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'px-2 py-0.5 rounded bg-slate-700/80 hover:bg-slate-600 text-slate-300 text-[10px] font-sans flex items-center gap-1 transition active:scale-95';
      copyBtn.innerHTML = `<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>複製`;
      copyBtn.onclick = (e) => {
        e.stopPropagation();
        copyToClipboard(rawCode, copyBtn);
      };
      actionsContainer.appendChild(copyBtn);

      header.appendChild(actionsContainer);
      pre.insertBefore(header, pre.firstChild);
    }
  });
}

// 🎤 TTS Web Speech Synthesis
let currentSpeakingBtn = null;
function stripMarkdownForTTS(text) {
  if (!text) return '';
  return text
    .replace(/```[\s\S]*?```/g, ' [程式碼區塊省略] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*#_~>]/g, '')
    .replace(/\[Uploaded Image:[^\]]+\]/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resetTTSBtn(btn) {
  if (!btn) return;
  btn.classList.remove('text-indigo-400', 'bg-indigo-600/20');
  btn.classList.add('text-slate-400', 'hover:text-slate-300');
  btn.innerHTML = `
    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
    </svg>
    <span class="text-[10px]">朗讀</span>
  `;
}

function toggleSpeech(rawText, btn) {
  if (!('speechSynthesis' in window)) {
    alert('您的瀏覽器不支援語音合成朗讀');
    return;
  }

  if (window.speechSynthesis.speaking && currentSpeakingBtn === btn) {
    window.speechSynthesis.cancel();
    resetTTSBtn(btn);
    currentSpeakingBtn = null;
    return;
  }

  if (window.speechSynthesis.speaking) {
    window.speechSynthesis.cancel();
    if (currentSpeakingBtn) resetTTSBtn(currentSpeakingBtn);
  }

  const cleanText = stripMarkdownForTTS(rawText);
  if (!cleanText) return;

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = /[\u4e00-\u9fa5]/.test(cleanText) ? 'zh-TW' : 'en-US';
  utterance.rate = 1.25; // Snappy conversational reading rate
  utterance.pitch = 1.0;

  utterance.onstart = () => {
    currentSpeakingBtn = btn;
    btn.classList.add('text-indigo-400', 'bg-indigo-600/20');
    btn.classList.remove('text-slate-400', 'hover:text-slate-300');
    btn.innerHTML = `
      <svg class="w-3.5 h-3.5 animate-pulse text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"/>
      </svg>
      <span class="text-[10px] text-indigo-300 font-medium">停止</span>
    `;
  };

  utterance.onend = () => {
    resetTTSBtn(btn);
    if (currentSpeakingBtn === btn) currentSpeakingBtn = null;
  };

  utterance.onerror = () => {
    resetTTSBtn(btn);
    if (currentSpeakingBtn === btn) currentSpeakingBtn = null;
  };

  window.speechSynthesis.speak(utterance);
}

// 🎙️ Streaming Sentence-by-Sentence Instant TTS Player (Walkie-Talkie Mode)
class StreamingTTSPlayer {
  constructor() {
    this.queue = [];
    this.isPlaying = false;
    this.buffer = '';
    this.enabled = false;
    this.activeUtterance = null;
  }

  start() {
    this.stop();
    this.enabled = true;
    this.queue = [];
    this.buffer = '';
    this.isPlaying = false;
  }

  feedChunk(deltaText) {
    if (!this.enabled || !('speechSynthesis' in window) || !deltaText) return;
    this.buffer += deltaText;

    // Avoid splitting if currently inside an unclosed code block
    const backticks = (this.buffer.match(/```/g) || []).length;
    if (backticks % 2 !== 0) return;

    // Detect complete sentences ending with 。, ！, ？, \n, !, ?
    const sentenceRegex = /([^。！？!\?\n]+[。！？!\?\n]+)/g;
    let match;
    let lastIndex = 0;

    while ((match = sentenceRegex.exec(this.buffer)) !== null) {
      const sentence = match[1].trim();
      if (sentence.length > 0) {
        this.enqueue(sentence);
      }
      lastIndex = sentenceRegex.lastIndex;
    }

    if (lastIndex > 0) {
      this.buffer = this.buffer.slice(lastIndex);
    }
  }

  finish() {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    if (this.buffer.trim().length > 0) {
      this.enqueue(this.buffer.trim());
      this.buffer = '';
    }
  }

  enqueue(rawSentence) {
    const clean = stripMarkdownForTTS(rawSentence);
    if (!clean || clean.length < 1) return;
    this.queue.push(clean);
    if (!this.isPlaying) {
      this.playNext();
    }
  }

  playNext() {
    if (!this.enabled || this.queue.length === 0) {
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const text = this.queue.shift();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = /[\u4e00-\u9fa5]/.test(text) ? 'zh-TW' : 'en-US';
    utterance.rate = 1.28; // Snappy, lively conversational walkie-talkie cadence
    utterance.pitch = 1.0;

    this.activeUtterance = utterance;

    utterance.onend = () => {
      this.activeUtterance = null;
      this.playNext();
    };

    utterance.onerror = () => {
      this.activeUtterance = null;
      this.playNext();
    };

    window.speechSynthesis.speak(utterance);
  }

  stop() {
    this.enabled = false;
    this.queue = [];
    this.buffer = '';
    this.isPlaying = false;
    this.activeUtterance = null;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }
}

const streamingTTS = new StreamingTTSPlayer();

// 📍 Browser GPS Geolocation Initializer
function initGpsHandler() {
  if (!gpsChip) return;
  gpsChip.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('您的瀏覽器不支援 GPS 衛星定位功能');
      return;
    }

    const originalHtml = gpsChip.innerHTML;
    gpsChip.innerHTML = `<span class="inline-block w-2.5 h-2.5 rounded-full border-2 border-rose-400 border-t-transparent animate-spin"></span><span>定位中...</span>`;
    if (navigator.vibrate) navigator.vibrate(20);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude.toFixed(6);
        const lon = position.coords.longitude.toFixed(6);
        const accuracy = Math.round(position.coords.accuracy);

        let placeInfo = '';
        try {
          const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=zh-TW`);
          if (res.ok) {
            const data = await res.json();
            const addr = data.address || {};
            const city = addr.city || addr.town || addr.county || '';
            const suburb = addr.suburb || addr.district || '';
            const road = addr.road || '';
            placeInfo = [city, suburb, road].filter(Boolean).join('');
          }
        } catch (e) {}

        const locationLabel = placeInfo ? `（約位於 ${placeInfo}，精確度約 ${accuracy} 公尺）` : `（精確度約 ${accuracy} 公尺）`;
        const queryText = `📍 我目前的手機即時 GPS 座標為：緯度 ${lat}, 經度 ${lon}${locationLabel}。請根據我當前的位置，推薦我身邊 1 公里內的在地必吃美食或人氣景點，並為每個地點附上 Google 地圖一鍵導航卡片：`;

        if (promptInput) {
          promptInput.value = queryText;
          promptInput.focus();
          promptInput.dispatchEvent(new Event('input'));
        }
        gpsChip.innerHTML = originalHtml;
        if (navigator.vibrate) navigator.vibrate([30, 30]);
      },
      (err) => {
        gpsChip.innerHTML = originalHtml;
        let errMsg = '無法獲取位置資訊';
        if (err.code === 1) errMsg = '請在手機瀏覽器權限中允許「位置資訊 (GPS)」';
        else if (err.code === 2) errMsg = '定位訊號不良或 GPS 開關尚未開啟';
        else if (err.code === 3) errMsg = '定位請求逾時';
        alert(`定位失敗：${errMsg}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  });
}

// 📋 Clipboard Smart Sensing Engine (100% Local Instant Regex Intent Classifier)
let lastSeenClipboardText = '';
let clipboardAutoDismissTimer = null;

function detectClipboardIntent(rawText) {
  if (!rawText || typeof rawText !== 'string') return null;
  const text = rawText.trim();
  if (!text || text.length < 2) return null;

  // 1. 🔗 URL Detection
  if (/^https?:\/\/[^\s]+$/i.test(text)) {
    let domain = '';
    try { domain = new URL(text).hostname; } catch(e) {}
    return {
      type: 'url',
      icon: '🔗',
      label: `網頁連結 (${domain || 'URL'})`,
      preview: text,
      actions: [
        { label: '📰 總結網頁', prompt: `請閱讀並詳細分析這個網頁的重點內容與核心摘要：\n${text}` },
        { label: '📥 填入', fillOnly: true }
      ]
    };
  }

  // 2. ⚠️ Error / Stack Trace Detection
  if (/(Error|Exception|Traceback|errno|FAIL|TypeError|SyntaxError|ReferenceError|NullPointerException|panic:|fatal error)/i.test(text) || (text.includes('at ') && text.includes('.js:'))) {
    return {
      type: 'error',
      icon: '🛠️',
      label: '錯誤報錯 (Error/Trace)',
      preview: text,
      actions: [
        { label: '🛠️ 除錯分析', prompt: `請幫我分析以下程式報錯的原因，並提供具體的修復步驟與改進代碼：\n\`\`\`\n${text}\n\`\`\`` },
        { label: '📥 填入', fillOnly: true }
      ]
    };
  }

  // 3. 📊 JSON / Structured Data
  if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
    try {
      JSON.parse(text);
      return {
        type: 'json',
        icon: '📊',
        label: 'JSON 結構化資料',
        preview: text,
        actions: [
          { label: '✨ 格式美化', prompt: `請幫我排版美化這段 JSON 資料並簡要說明其結構用途：\n\`\`\`json\n${text}\n\`\`\`` },
          { label: '📈 轉為圖表', prompt: `請分析以下資料並使用 Chart.js 繪製適當的視覺化圖表：\n\`\`\`json\n${text}\n\`\`\`` },
          { label: '📥 填入', fillOnly: true }
        ]
      };
    } catch(e) {}
  }

  // 4. 💻 Code Snippet Detection
  if (/^(<[\s\S]+>|import\s+|export\s+|function\s+|const\s+|let\s+|var\s+|class\s+|def\s+|public\s+class|package\s+|SELECT\s+|FROM\s+|curl\s+|docker\s+|npm\s+|git\s+)/i.test(text) ||
      (text.includes('{') && text.includes('}') && (text.includes(';') || text.includes('\n')))) {
    return {
      type: 'code',
      icon: '💻',
      label: '程式碼片段',
      preview: text,
      actions: [
        { label: '📖 解釋代碼', prompt: `請詳細解釋這段程式碼的邏輯、運作機制與用途：\n\`\`\`\n${text}\n\`\`\`` },
        { label: '⚡ 優化審查', prompt: `請幫我審查並優化這段程式碼，指出潛在效能問題與改進建議：\n\`\`\`\n${text}\n\`\`\`` },
        { label: '📥 填入', fillOnly: true }
      ]
    };
  }

  // 5. 🌐 Foreign Language (English / Japanese)
  const hasChinese = /[\u4e00-\u9fa5]/.test(text);
  const isJapanese = /[\u3040-\u30ff]/.test(text) && !hasChinese;
  const isEnglish = /[a-zA-Z]{6,}/.test(text) && !hasChinese && ((text.match(/[a-zA-Z]/g) || []).length / text.length > 0.5);

  if (isJapanese) {
    return {
      type: 'japanese',
      icon: '🎌',
      label: '日語內容',
      preview: text,
      actions: [
        { label: '🀄 翻譯繁中', prompt: `請將以下日文內容翻譯為流暢自然的繁體中文：\n\n${text}` },
        { label: '📥 填入', fillOnly: true }
      ]
    };
  }

  if (isEnglish) {
    return {
      type: 'english',
      icon: '🌐',
      label: '英文內容',
      preview: text,
      actions: [
        { label: '🀄 翻譯繁中', prompt: `請將以下英文內容精準翻譯為自然通順的繁體中文：\n\n${text}` },
        { label: '✍️ 潤飾文法', prompt: `請幫我潤飾並改善這段英文，修正文法錯誤並提供更母語化的表達：\n\n${text}` },
        { label: '📥 填入', fillOnly: true }
      ]
    };
  }

  // 6. 📝 Long Text / Paragraphs
  if (text.length > 40) {
    return {
      type: 'longtext',
      icon: '📝',
      label: `長文字 (${text.length} 字)`,
      preview: text,
      actions: [
        { label: '📝 萃取重點', prompt: `請幫我萃取以下文字的核心重點與結論，以精簡條列式呈現：\n\n${text}` },
        { label: '📥 填入', fillOnly: true }
      ]
    };
  }

  // 7. Short text fallback
  return {
    type: 'text',
    icon: '📋',
    label: `剪貼簿 (${text.length} 字)`,
    preview: text,
    actions: [
      { label: '📥 填入輸入框', fillOnly: true },
      { label: '🚀 發送給 AI', prompt: text }
    ]
  };
}

function showClipboardCapsule(intent, rawText) {
  const capsule = document.getElementById('clipboard-smart-capsule');
  const typeIcon = document.getElementById('clipboard-type-icon');
  const typeLabel = document.getElementById('clipboard-type-label');
  const lengthBadge = document.getElementById('clipboard-length-badge');
  const previewText = document.getElementById('clipboard-preview-text');
  const actionsContainer = document.getElementById('clipboard-actions-container');
  const closeBtn = document.getElementById('clipboard-close-btn');

  if (!capsule || !intent) return;

  if (clipboardAutoDismissTimer) clearTimeout(clipboardAutoDismissTimer);

  if (typeIcon) typeIcon.textContent = intent.icon;
  if (typeLabel) typeLabel.textContent = intent.label;
  if (lengthBadge) lengthBadge.textContent = `${rawText.length} 字`;
  if (previewText) previewText.textContent = rawText.replace(/\s+/g, ' ').slice(0, 45);

  if (actionsContainer) {
    actionsContainer.innerHTML = '';
    intent.actions.forEach((action, idx) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const isPrimary = idx === 0;
      btn.className = `px-2.5 py-1 rounded-xl text-[11px] font-medium transition active:scale-95 shrink-0 flex items-center gap-1 shadow-sm ${
        isPrimary
          ? 'bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-indigo-600/30'
          : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
      }`;
      btn.textContent = action.label;

      btn.onclick = () => {
        hideClipboardCapsule();
        if (navigator.vibrate) navigator.vibrate(20);

        if (action.fillOnly) {
          if (promptInput) {
            promptInput.value = rawText;
            promptInput.focus();
            promptInput.dispatchEvent(new Event('input'));
          }
        } else if (action.prompt) {
          const finalPrompt = typeof action.prompt === 'function' ? action.prompt(rawText) : action.prompt;
          if (promptInput) {
            promptInput.value = finalPrompt;
            promptInput.dispatchEvent(new Event('input'));
          }
          if (typeof sendMessage === 'function') {
            sendMessage();
          }
        }
      };

      actionsContainer.appendChild(btn);
    });
  }

  capsule.classList.remove('hidden');

  if (closeBtn) {
    closeBtn.onclick = () => hideClipboardCapsule();
  }

  // Auto-dismiss after 10s of inactivity
  clipboardAutoDismissTimer = setTimeout(() => {
    hideClipboardCapsule();
  }, 10000);
}

function hideClipboardCapsule() {
  const capsule = document.getElementById('clipboard-smart-capsule');
  if (capsule) capsule.classList.add('hidden');
  if (clipboardAutoDismissTimer) {
    clearTimeout(clipboardAutoDismissTimer);
    clipboardAutoDismissTimer = null;
  }
}

// Check and trigger sensing
async function checkClipboardSmartly(forceManual = false) {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    if (forceManual) alert('您的瀏覽器不支援直接讀取剪貼簿 API');
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) {
      if (forceManual) alert('目前剪貼簿內無任何文字內容！');
      return;
    }

    const cleanText = text.trim();
    if (!forceManual && cleanText === lastSeenClipboardText) {
      return; // Already sensed this text
    }

    lastSeenClipboardText = cleanText;
    const intent = detectClipboardIntent(cleanText);
    if (intent) {
      showClipboardCapsule(intent, cleanText);
      if (navigator.vibrate) navigator.vibrate(15);
    }
  } catch (err) {
    // Clipboard permission denied or needs user gesture
    if (forceManual) {
      alert('無法讀取剪貼簿，請在瀏覽器權限中允許存取剪貼簿：' + err.message);
    }
  }
}

// Initializer (Manual on-demand only, zero background hijacking)
function initClipboardSmartSensors() {
  const clipboardChip = document.getElementById('clipboard-chip');
  if (clipboardChip) {
    clipboardChip.addEventListener('click', () => {
      checkClipboardSmartly(true);
    });
  }

  // Hide capsule when typing
  if (promptInput) {
    promptInput.addEventListener('input', () => {
      if (promptInput.value.length > 0) {
        hideClipboardCapsule();
      }
    });
  }
}
