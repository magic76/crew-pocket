// Optional, on-demand visual read mode. The model response remains the source of truth.
// This module only renders a derivative HTML view and never touches conversation history.
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const RENDERER = path.join(__dirname, 'vendor', 'answer-me-with-html', 'am.mjs');
const MAX_SOURCE_CHARS = 48000;
const MAX_RENDER_BYTES = 3 * 1024 * 1024;
const MAX_CONCURRENT_RENDERS = 2;
const RENDER_TIMEOUT_MS = 8000;
const CACHE_LIMIT = 16;
const CACHE_TTL_MS = 10 * 60 * 1000;
const renderCache = new Map();
let activeRenders = 0;

// Disallow inline images from requesting local files via the upstream renderer.
// Preserve the alt text in the visual copy; the original Markdown is untouched.
function prepareVisualDraft(source) {
  if (typeof source !== 'string' || !source.trim()) {
    throw new Error('沒有可以視覺化的回覆');
  }
  if (source.length > MAX_SOURCE_CHARS) {
    throw new Error('回答過長，請使用原始 Markdown 閱讀');
  }

  const safe = source
    .replace(/\u0000/g, '')
    .replace(/!\[([^\]]*)\]\([^)\n]*\)/g, (_, alt) => alt ? '[圖片：' + alt + ']' : '[圖片]')
    .replace(/!\[([^\]]*)\]\[[^\]]*\]/g, (_, alt) => alt ? '[圖片：' + alt + ']' : '[圖片]')
    .replace(/<img\b[^>]*>/gi, '[圖片]')
    // Source HTML/SVG is code, not a trusted visual component.
    .replace(/^(\s*)(\x60{3,}|~{3,})\s*(html|svg)\b/gmi, '$1$2text');

  // The doc template requires at least one panel. H2 inside code blocks does
  // not count; normal Markdown prose without H2 stays in a single reading panel.
  let inFence = false;
  let fenceChar = '';
  let hasPanel = false;
  for (const line of safe.split(/\r?\n/)) {
    const match = line.match(/^\s*(\x60{3,}|~{3,})/);
    if (match) {
      const ch = match[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
      }
      continue;
    }
    if (!inFence && /^##\s+\S/.test(line)) {
      hasPanel = true;
      break;
    }
  }

  const body = hasPanel ? safe : '## 回覆內容\n\n' + safe;
  return ['---', 'title: 視覺化閱讀', 'template: doc', 'theme: paper',
    'mode: dark', 'style: off', '---', '', body].join('\n');
}

function renderWithCli(draft, outputFile, workDir) {
  return new Promise((resolve, reject) => {
    const args = [RENDERER, 'render', '-', '-o', outputFile, '--no-open',
      '--template', 'doc', '--theme', 'paper', '--mode', 'dark', '--style', 'off'];
    const child = spawn(process.execPath, args, {
      cwd: workDir,
      env: { ...process.env, AM_HOME: workDir, AM_NO_OPEN: '1', CI: '1' },
      stdio: ['pipe', 'ignore', 'pipe']
    });
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, RENDER_TIMEOUT_MS);
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1300); });
    child.stdin.on('error', () => {});
    child.on('error', err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) resolve();
      else reject(new Error(timedOut ? '視覺化產生逾時' : (stderr.trim() || '視覺化渲染失敗').slice(0, 240)));
    });
    child.stdin.end(draft);
  });
}

async function renderVisualAnswer(source) {
  const draft = prepareVisualDraft(source);
  const key = crypto.createHash('sha256').update('am-doc-v1\n').update(draft).digest('hex');
  const cached = renderCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    // LRU order.
    renderCache.delete(key);
    renderCache.set(key, cached);
    return { html: cached.html, cached: true };
  }
  if (activeRenders >= MAX_CONCURRENT_RENDERS) {
    const error = new Error('已有其他視覺化頁面正在產生，請稍後重試');
    error.statusCode = 429;
    throw error;
  }

  activeRenders++;
  let tmp;
  try {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'crew-visual-'));
    const output = path.join(tmp, 'answer.html');
    await renderWithCli(draft, output, tmp);
    const stat = await fs.stat(output);
    if (stat.size > MAX_RENDER_BYTES) throw new Error('視覺化頁面過大');
    let html = await fs.readFile(output, 'utf8');
    // Defense in depth for the sandboxed iframe: no scripts, network or forms.
    const policy = '<meta http-equiv="Content-Security-Policy" content="default-src ' +
      "'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; " +
      "script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'" +
      '">';
    html = html.replace(/<head>/i, '<head>\n' + policy);
    // The upstream theme/copy toolbar needs scripts; our surrounding modal
    // provides working navigation and copy actions without iframe scripting.
    html = html.replace(/<div class="am-toolbar">[\s\S]*?<\/div>/i, '');
    renderCache.set(key, { html, at: Date.now() });
    while (renderCache.size > CACHE_LIMIT) renderCache.delete(renderCache.keys().next().value);
    return { html, cached: false };
  } finally {
    activeRenders--;
    if (tmp) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { prepareVisualDraft, renderVisualAnswer };
