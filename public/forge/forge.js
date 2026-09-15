const STORAGE_KEY = 'crew-forge.apps.v0';
const ACTIVE_KEY = 'crew-forge.active.v0';
const RUNTIME_PREFIX = 'crew-forge.runtime.';
const MAX_VERSIONS = 20;

const el = (id) => document.getElementById(id);
const homeView = el('homeView');
const appView = el('appView');
const libraryEl = el('library');
const promptInput = el('promptInput');
const forgeBtn = el('forgeBtn');
const statusOverlay = el('statusOverlay');
const statusTitle = el('statusTitle');
const statusDetail = el('statusDetail');
const preview = el('preview');
const appTitle = el('appTitle');
const modifySheet = el('modifySheet');
const modifyInput = el('modifyInput');
const modifyBtn = el('modifyBtn');
const undoBtn = el('undoBtn');
const versionBtn = el('versionBtn');
const toast = el('toast');

let apps = loadApps();
let activeAppId = localStorage.getItem(ACTIVE_KEY) || null;
let provider = 'codex';
let busy = false;

init();

async function init() {
  bindUi();
  await detectProvider();
  renderLibrary();
  if (activeAppId && apps.some((app) => app.id === activeAppId)) openApp(activeAppId);
}

function bindUi() {
  forgeBtn.addEventListener('click', () => createApp(promptInput.value));
  promptInput.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') createApp(promptInput.value);
  });
  document.querySelectorAll('[data-starter]').forEach((button) => {
    button.addEventListener('click', () => {
      promptInput.value = button.dataset.starter || '';
      promptInput.focus();
    });
  });
  el('backBtn').addEventListener('click', showHome);
  el('modifyOpenBtn').addEventListener('click', () => openModify());
  el('modifyCloseBtn').addEventListener('click', closeModify);
  modifyBtn.addEventListener('click', () => modifyApp(modifyInput.value));
  undoBtn.addEventListener('click', undoActiveApp);
  versionBtn.addEventListener('click', showVersionInfo);
  modifySheet.addEventListener('click', (event) => {
    if (event.target === modifySheet) closeModify();
  });
  window.addEventListener('message', handleRuntimeMessage);
}

async function detectProvider() {
  try {
    const response = await fetch('/api/providers');
    if (!response.ok) return;
    const data = await response.json();
    const ids = (data.providers || []).map((item) => item.id);
    if (ids.includes('codex')) provider = 'codex';
    else if (ids.includes('antigravity')) provider = 'antigravity';
    else if (ids[0]) provider = ids[0];
  } catch (_) {}
}

function loadApps() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (_) { return []; }
}

function saveApps() { localStorage.setItem(STORAGE_KEY, JSON.stringify(apps)); }
function getActiveApp() { return apps.find((app) => app.id === activeAppId) || null; }
function createId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `forge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function renderLibrary() {
  const sorted = [...apps].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  if (!sorted.length) {
    libraryEl.innerHTML = `<div class="empty-card"><div class="empty-icon">◇</div><strong>No forged apps yet</strong><span>Your first mini app will appear here.</span></div>`;
    return;
  }
  libraryEl.innerHTML = sorted.map((app) => `
    <button class="app-card" data-app-id="${escapeAttr(app.id)}">
      <div class="app-card-icon">${escapeHtml(app.icon || '✦')}</div>
      <div class="app-card-copy"><strong>${escapeHtml(app.name || 'Untitled App')}</strong><span>${escapeHtml(app.summary || app.originalPrompt || 'Generated mini app')}</span></div>
      <div class="app-card-meta">v${Math.max(1, app.versions?.length || 1)}</div>
    </button>`).join('');
  libraryEl.querySelectorAll('[data-app-id]').forEach((button) => {
    button.addEventListener('click', () => openApp(button.dataset.appId));
  });
}

function showHome() {
  activeAppId = null;
  localStorage.removeItem(ACTIVE_KEY);
  appView.hidden = true;
  homeView.hidden = false;
  preview.srcdoc = '';
  renderLibrary();
}

function openApp(id) {
  const app = apps.find((item) => item.id === id);
  if (!app) return;
  activeAppId = id;
  localStorage.setItem(ACTIVE_KEY, id);
  homeView.hidden = true;
  appView.hidden = false;
  appTitle.textContent = app.name || 'Crew Forge';
  undoBtn.disabled = !app.versions || app.versions.length < 2;
  renderPreview(app);
}

function openModify(prefill = '') {
  const app = getActiveApp();
  if (!app || busy) return;
  modifyInput.value = prefill;
  modifySheet.hidden = false;
  setTimeout(() => modifyInput.focus(), 30);
}
function closeModify() { modifySheet.hidden = true; }

async function createApp(rawPrompt) {
  const request = String(rawPrompt || '').trim();
  if (!request || busy) return;
  setBusy(true, 'Forging your app', 'Planning the first version…');
  const app = {
    id: createId(), name: deriveName(request), icon: '✦', summary: request, originalPrompt: request,
    provider, conversationId: null, html: '', versions: [], createdAt: Date.now(), updatedAt: Date.now()
  };
  apps.unshift(app);
  activeAppId = app.id;
  saveApps();
  try {
    const result = await runForgeTurn(app, buildCreatePrompt(request));
    applyForgeResult(app, result, request);
    promptInput.value = '';
    openApp(app.id);
    showToast('App forged');
  } catch (error) {
    apps = apps.filter((item) => item.id !== app.id);
    saveApps();
    activeAppId = null;
    showToast(error.message || 'Forge failed', true);
  } finally { setBusy(false); }
}

async function modifyApp(rawRequest) {
  const request = String(rawRequest || '').trim();
  const app = getActiveApp();
  if (!request || !app || busy) return;
  closeModify();
  setBusy(true, 'Updating your app', 'Keeping the current behavior intact…');
  try {
    const result = await runForgeTurn(app, buildModifyPrompt(request, app));
    applyForgeResult(app, result, request);
    openApp(app.id);
    showToast('Changes applied');
  } catch (error) { showToast(error.message || 'Update failed', true); }
  finally { setBusy(false); }
}

function applyForgeResult(app, result, request) {
  const html = extractHtml(result.response);
  if (!html) throw new Error('AI did not return a runnable HTML app.');
  app.conversationId = result.conversationId || app.conversationId;
  app.provider = result.provider || app.provider || provider;
  app.html = html;
  app.updatedAt = Date.now();
  app.name = extractAppName(html) || app.name;
  app.versions = Array.isArray(app.versions) ? app.versions : [];
  app.versions.push({ html, request, createdAt: Date.now() });
  if (app.versions.length > MAX_VERSIONS) app.versions.splice(0, app.versions.length - MAX_VERSIONS);
  saveApps();
}

function undoActiveApp() {
  const app = getActiveApp();
  if (!app || !app.versions || app.versions.length < 2 || busy) return;
  app.versions.pop();
  const previous = app.versions[app.versions.length - 1];
  app.html = previous.html;
  app.updatedAt = Date.now();
  saveApps();
  openApp(app.id);
  showToast('Restored previous version');
}

function showVersionInfo() {
  const app = getActiveApp();
  if (!app) return;
  const count = Math.max(1, app.versions?.length || 1);
  showToast(`Version ${count} · ${app.provider || provider}`);
}

function renderPreview(app) {
  if (!app?.html) {
    preview.srcdoc = '<!doctype html><html><body style="font-family:system-ui;background:#0b1020;color:#fff;display:grid;place-items:center;height:100vh;margin:0">No preview yet</body></html>';
    return;
  }
  preview.srcdoc = injectRuntimeBridge(app.html, app.id);
}

function injectRuntimeBridge(html, appId) {
  const bridge = `<script>
(() => {
  const pending = new Map(); let seq = 0;
  const call = (method, payload = {}) => new Promise((resolve, reject) => {
    const id = 'crew_' + Date.now() + '_' + (++seq);
    pending.set(id, { resolve, reject });
    parent.postMessage({ __crewForge: true, type: 'request', id, appId: ${JSON.stringify(appId)}, method, payload }, '*');
    setTimeout(() => { if (!pending.has(id)) return; pending.delete(id); reject(new Error('Crew runtime request timed out')); }, 8000);
  });
  addEventListener('message', (event) => {
    const msg = event.data || {}; if (!msg.__crewForge || msg.type !== 'response') return;
    const item = pending.get(msg.id); if (!item) return; pending.delete(msg.id);
    if (msg.error) item.reject(new Error(msg.error)); else item.resolve(msg.value);
  });
  window.crew = {
    storage: {
      get: (key, fallback = null) => call('storage.get', { key, fallback }),
      set: (key, value) => call('storage.set', { key, value }),
      remove: (key) => call('storage.remove', { key }),
      all: () => call('storage.all')
    },
    vibrate: (pattern = 60) => call('vibrate', { pattern }),
    share: (data = {}) => call('share', data)
  };
})();
<\/script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${bridge}`);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html([^>]*)>/i, `<html$1><head>${bridge}</head>`);
  return `<!doctype html><html><head>${bridge}</head><body>${html}</body></html>`;
}

async function handleRuntimeMessage(event) {
  const msg = event.data || {};
  if (!msg.__crewForge || msg.type !== 'request' || !msg.id || !msg.appId) return;
  const respond = (value, error = null) => event.source?.postMessage({ __crewForge: true, type: 'response', id: msg.id, value, error }, '*');
  try {
    const key = `${RUNTIME_PREFIX}${msg.appId}`;
    const state = readJson(key, {});
    const payload = msg.payload || {};
    if (msg.method === 'storage.get') {
      respond(Object.prototype.hasOwnProperty.call(state, payload.key) ? state[payload.key] : payload.fallback);
    } else if (msg.method === 'storage.set') {
      state[payload.key] = payload.value; localStorage.setItem(key, JSON.stringify(state)); respond(true);
    } else if (msg.method === 'storage.remove') {
      delete state[payload.key]; localStorage.setItem(key, JSON.stringify(state)); respond(true);
    } else if (msg.method === 'storage.all') {
      respond(state);
    } else if (msg.method === 'vibrate') {
      if (navigator.vibrate) navigator.vibrate(payload.pattern ?? 60); respond(true);
    } else if (msg.method === 'share') {
      if (navigator.share) { await navigator.share({ title: payload.title || '', text: payload.text || '', url: payload.url || undefined }); respond(true); }
      else respond(false);
    } else respond(null, `Unsupported Crew runtime method: ${msg.method}`);
  } catch (error) { respond(null, error.message || String(error)); }
}

function readJson(key, fallback) {
  try { const value = JSON.parse(localStorage.getItem(key)); return value && typeof value === 'object' ? value : fallback; }
  catch (_) { return fallback; }
}

function buildCreatePrompt(request) {
  return `You are Crew Forge, an AI app builder. Build one polished, immediately usable mobile mini app for this request:\n\n"${request}"\n\nOUTPUT CONTRACT:\n- Return one COMPLETE self-contained HTML document inside exactly one \`\`\`html fenced block.\n- You may add at most two short sentences outside the block.\n- Use inline CSS and JavaScript only. No build step.\n- Mobile-first. Touch targets >= 44px. Make it feel like a real product, not a demo.\n- The app runs inside a sandboxed iframe.\n- Do NOT use localStorage/sessionStorage directly.\n- Persistent state is available through await crew.storage.get(key, fallback), await crew.storage.set(key, value), await crew.storage.remove(key), await crew.storage.all().\n- Optional device helpers: await crew.vibrate(pattern), await crew.share({ title, text, url }).\n- Do not navigate the top page or attempt to access parent DOM.\n- Include a meaningful <title>.\n- Handle empty/error states.\n- Prefer zero external dependencies.`;
}

function buildModifyPrompt(request, app) {
  return `Modify the CURRENT Crew Forge mini app from this conversation.\n\nUser change:\n"${request}"\n\nRULES:\n- Preserve existing behavior, visual identity, and user data unless the request requires changing them.\n- Make the smallest coherent change that fully satisfies the request.\n- Return the UPDATED COMPLETE self-contained HTML document inside exactly one \`\`\`html fenced block.\n- Do not return a diff or partial snippet.\n- Keep using crew.storage instead of localStorage/sessionStorage.\n- The current app is version ${Math.max(1, app.versions?.length || 1)}.`;
}

async function runForgeTurn(app, prompt) {
  const response = await fetch('/api/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, conversation_id: app.conversationId || undefined, provider: app.provider || provider, role: 'lead', effort: 'medium' })
  });
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => ''); throw new Error(text || `Backend returned ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '', accumulated = '', conversationId = app.conversationId || null;
  let responseProvider = app.provider || provider, donePayload = null;
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) >= 0) {
      const rawEvent = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); if (!rawEvent.trim()) continue;
      let eventName = 'message', data = '';
      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      let payload; try { payload = JSON.parse(data); } catch (_) { continue; }
      if (eventName === 'init') {
        conversationId = payload.conversation_id || conversationId; responseProvider = payload.provider || responseProvider;
        setBusy(true, 'Forging your app', 'The AI workspace is ready…');
      } else if (eventName === 'chunk') {
        accumulated = payload.accumulated || `${accumulated}${payload.delta || ''}`;
        setBusy(true, app.html ? 'Updating your app' : 'Forging your app', 'Writing the runnable interface…');
      } else if (eventName === 'tool') {
        setBusy(true, app.html ? 'Updating your app' : 'Forging your app', 'Using the builder tools…');
      } else if (eventName === 'done') donePayload = payload;
    }
  }
  if (donePayload?.error) throw new Error(donePayload.error);
  const finalResponse = String(donePayload?.response || accumulated || '').trim();
  if (!finalResponse) throw new Error('AI returned an empty response.');
  return { response: finalResponse, conversationId: donePayload?.conversation_id || conversationId, provider: donePayload?.provider || responseProvider };
}

function extractHtml(text) {
  const match = String(text || '').match(/```html\s*([\s\S]*?)```/i); if (match?.[1]) return match[1].trim();
  const doctype = String(text || '').match(/(<!doctype html[\s\S]*<\/html>)/i); if (doctype?.[1]) return doctype[1].trim();
  const html = String(text || '').match(/(<html[\s\S]*<\/html>)/i); return html?.[1]?.trim() || '';
}
function extractAppName(html) {
  const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i); if (!match?.[1]) return '';
  return match[1].replace(/<[^>]+>/g, '').trim().slice(0, 42);
}
function deriveName(prompt) {
  const cleaned = String(prompt).replace(/[。！？!?].*$/s, '').replace(/^(幫我|請|做一個|建立一個|create|build|make)\s*/i, '').trim();
  return (cleaned || 'New Forge App').slice(0, 32);
}
function setBusy(nextBusy, title = '', detail = '') {
  busy = nextBusy; statusOverlay.hidden = !nextBusy; forgeBtn.disabled = nextBusy; modifyBtn.disabled = nextBusy;
  if (title) statusTitle.textContent = title; if (detail) statusDetail.textContent = detail;
}
function showToast(message, danger = false) {
  toast.textContent = message; toast.classList.toggle('danger', danger); toast.hidden = false;
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => { toast.hidden = true; }, 2400);
}
function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function escapeAttr(value) { return escapeHtml(value); }
