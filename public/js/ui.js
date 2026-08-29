// Antigravity Web UI - UI State, Modals & Helpers

// Global State
const DEFAULT_PROVIDERS = [
  { id: 'antigravity', label: 'Antigravity', shortLabel: 'AGY', icon: '✨', storagePrefix: 'agy', badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', greeting: '你好！已為你開啟新對話。有什麼可以幫你的？', capabilities: { history: true, rewind: true, autoTitle: true, compact: 'checkpoint', usage: { mode: 'endpoint', endpoint: '/api/usage' } } },
  { id: 'codex', label: 'OpenAI Codex', shortLabel: 'Codex', icon: '🧩', storagePrefix: 'codex', badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', greeting: '你好！Codex provider 已就緒。有什麼開發任務？', capabilities: { history: true, rewind: false, autoTitle: false, compact: 'native', usage: { mode: 'external-link', url: 'https://chatgpt.com/codex/settings/usage' } } }
];
let availableProviders = DEFAULT_PROVIDERS;
let currentConversationId = null;
let currentProvider = localStorage.getItem('crew_current_provider') || 'antigravity';
let currentModel = localStorage.getItem('agy_current_model') || 'gemini-3.7-flash';
let currentEffort = localStorage.getItem(providerStorageKey('current_effort')) || 'low';
let availableModels = [];
let availableEfforts = [
  { id: 'low', name: 'Low (極速)', desc: '⚡ 0~1s 秒回 · 日常對話', icon: '⚡', color: 'emerald' },
  { id: 'medium', name: 'Medium (平衡)', desc: '⚖️ 基礎推理 · 平衡模式', icon: '⚖️', color: 'amber' },
  { id: 'high', name: 'High (深度)', desc: '🧠 深度邏輯 · 複雜架構', icon: '🧠', color: 'indigo' }
];
let uploadedImagePath = null;
let isStreaming = false;
let currentAbortController = null;
let recognition = null;
let isRecording = false;
let userScrolledUp = false;
let notificationsEnabled = localStorage.getItem('agy_notify_enabled') !== 'false';
let swRegistration = null;
let streamingStartedAt = 0;
const activeBlobUrls = new Set();
let prewarmTimer = null;
let lastPrewarmKey = '';
let lastPrewarmAt = 0;
let prewarmRequest = null;
let modelsCatalogRequest = null;

// Coalesce boot/model/effort/new-chat prewarm requests into one provider call.
window.requestProviderPrewarm = function(delay = 250) {
  const payload = { provider: currentProvider, model: currentModel, effort: currentEffort };
  const key = JSON.stringify(payload);
  if (prewarmTimer) clearTimeout(prewarmTimer);
  if (key === lastPrewarmKey && Date.now() - lastPrewarmAt < 10000) return prewarmRequest;

  prewarmTimer = setTimeout(() => {
    prewarmTimer = null;
    lastPrewarmKey = key;
    lastPrewarmAt = Date.now();
    prewarmRequest = fetch('/api/prewarm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => null);
  }, Math.max(0, delay));
  return prewarmRequest;
};

async function loadModelsCatalog() {
  if (availableModels.length > 0) return { models: availableModels, efforts: availableEfforts };
  if (!modelsCatalogRequest) {
    modelsCatalogRequest = fetch('/api/models')
      .then(res => {
        if (!res.ok) throw new Error('模型清單載入失敗');
        return res.json();
      })
      .then(data => {
        availableModels = Array.isArray(data.models) ? data.models : [];
        if (Array.isArray(data.efforts) && data.efforts.length > 0) availableEfforts = data.efforts;
        return data;
      })
      .finally(() => {
        modelsCatalogRequest = null;
      });
  }
  return modelsCatalogRequest;
}

function revokeAllBlobUrls() {
  activeBlobUrls.forEach(url => URL.revokeObjectURL(url));
  activeBlobUrls.clear();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

// DOM Elements Reference
const messagesContainer = document.getElementById('messages-container');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const sendIcon = document.getElementById('send-icon');
const stopIcon = document.getElementById('stop-icon');
const camBtn = document.getElementById('cam-btn');
const attachBtn = document.getElementById('attach-btn');
const cameraInput = document.getElementById('camera-input');
const attachInput = document.getElementById('attach-input');
const imagePreviewContainer = document.getElementById('image-preview-container');
const previewThumb = document.getElementById('preview-thumb');
const previewFilename = document.getElementById('preview-filename');
const previewFilesize = document.getElementById('preview-filesize');
const removeImageBtn = document.getElementById('remove-image-btn');
const menuBtn = document.getElementById('menu-btn');
const drawer = document.getElementById('drawer');
const drawerOverlay = document.getElementById('drawer-overlay');
const closeDrawerBtn = document.getElementById('close-drawer-btn');
const convList = document.getElementById('conv-list');
const newChatBtn = document.getElementById('new-chat-btn');
const notifyBtn = document.getElementById('notify-btn');
const notifyStatusSubtext = document.getElementById('notify-status-subtext');
const toolsMenuBtn = document.getElementById('tools-menu-btn');
const toolsMenuDropdown = document.getElementById('tools-menu-dropdown');
const headerTitle = document.getElementById('header-title');
const slashMenu = document.getElementById('slash-menu');
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightbox-img');
const closeLightboxBtn = document.getElementById('close-lightbox-btn');
const cheatSheetBtn = document.getElementById('cheat-sheet-btn');
const cheatSheetModal = document.getElementById('cheat-sheet-modal');
const closeCheatSheetBtn = document.getElementById('close-cheat-sheet-btn');
const openCheatChip = document.getElementById('open-cheat-chip');
const usageBtn = document.getElementById('usage-btn');
const usageModal = document.getElementById('usage-modal');
const closeUsageBtn = document.getElementById('close-usage-btn');
const openUsageChip = document.getElementById('open-usage-chip');
const refreshUsageBtn = document.getElementById('refresh-usage-btn');
const usageBarsContainer = document.getElementById('usage-bars-container');
const usageModalSubtitle = document.getElementById('usage-modal-subtitle');
const usageModalFooterText = document.getElementById('usage-modal-footer-text');
const modelSelectorBtn = document.getElementById('model-selector-btn');
const modelModal = document.getElementById('model-modal');
const closeModelBtn = document.getElementById('close-model-btn');
const modelOptionsContainer = document.getElementById('model-options-container');
const modelBadgeIcon = document.getElementById('model-badge-icon');
const modelDisplayName = document.getElementById('model-display-name');
const providerOptionsContainer = document.getElementById('provider-options-container');
const effortSelectorBtn = document.getElementById('effort-selector-btn');
const effortBadgeIcon = document.getElementById('effort-badge-icon');
const effortDisplayName = document.getElementById('effort-display-name');
const effortOptionsContainer = document.getElementById('effort-options-container');
const effortActiveHint = document.getElementById('effort-active-hint');
const networkDot = document.getElementById('network-dot');
const networkOfflineBadge = document.getElementById('network-offline-badge');
const gpsChip = document.getElementById('gps-chip');
const filesBtn = document.getElementById('files-btn');
const storageBtn = document.getElementById('storage-btn');
const openFilesChip = document.getElementById('open-files-chip');
const filesModal = document.getElementById('files-modal');
const closeFilesBtn = document.getElementById('close-files-btn');
const refreshFilesBtn = document.getElementById('refresh-files-btn');
const filesBreadcrumb = document.getElementById('files-breadcrumb');
const filesListContainer = document.getElementById('files-list-container');
const filePreviewPane = document.getElementById('file-preview-pane');
const previewFileIcon = document.getElementById('preview-file-icon');
const previewFileName = document.getElementById('preview-file-name');
const previewFileSize = document.getElementById('preview-file-size');
const previewFileContent = document.getElementById('preview-file-content');
const previewSendAiBtn = document.getElementById('preview-send-ai-btn');
const previewCopyBtn = document.getElementById('preview-copy-btn');
const closePreviewPaneBtn = document.getElementById('close-preview-pane-btn');
const filesBasePath = document.getElementById('files-base-path');
const filesCountBadge = document.getElementById('files-count-badge');

// 📦 Browser Extension Export Modal
const exportExtBtn = document.getElementById('export-ext-btn');
const exportExtModal = document.getElementById('export-ext-modal');
const closeExportExtBtn = document.getElementById('close-export-ext-btn');
const doExportExtBtn = document.getElementById('do-export-ext-btn');
const exportExtStatus = document.getElementById('export-ext-status');

function toggleExportExtModal(open) {
  if (!exportExtModal) return;
  if (typeof window.haptic === 'function') window.haptic('light');
  if (open) {
    if (exportExtStatus) exportExtStatus.classList.add('hidden');
    exportExtModal.classList.remove('opacity-0', 'pointer-events-none');
  } else {
    exportExtModal.classList.add('opacity-0', 'pointer-events-none');
  }
}
window.toggleExportExtModal = toggleExportExtModal;

// 📋 AI Project Guidelines (GEMINI.md / AGENTS.md) Modal
const guidelinesBtn = document.getElementById('guidelines-btn');
const guidelinesModal = document.getElementById('guidelines-modal');
const closeGuidelinesBtn = document.getElementById('close-guidelines-btn');
const copyGuidelinesBtn = document.getElementById('copy-guidelines-btn');
const insertGuidelinesBtn = document.getElementById('insert-guidelines-btn');
const refreshGuidelinesBtn = document.getElementById('refresh-guidelines-btn');
const guidelinesContentTextarea = document.getElementById('guidelines-content-textarea');
const guidelinesFilePath = document.getElementById('guidelines-file-path');
const guidelinesCharCount = document.getElementById('guidelines-char-count');

function updateGuidelinesCharCount() {
  if (guidelinesContentTextarea && guidelinesCharCount) {
    const len = guidelinesContentTextarea.value.length;
    guidelinesCharCount.textContent = `${len.toLocaleString()} 字元`;
  }
}

async function loadGuidelines() {
  if (guidelinesContentTextarea) {
    guidelinesContentTextarea.value = '載入中...';
    guidelinesContentTextarea.disabled = true;
  }
  try {
    const res = await fetch('/api/guidelines');
    const data = await res.json();
    if (data.success && data.content) {
      if (guidelinesContentTextarea) {
        guidelinesContentTextarea.value = data.content;
        guidelinesContentTextarea.disabled = false;
      }
      if (guidelinesFilePath) guidelinesFilePath.textContent = data.path || 'GEMINI.md';
      updateGuidelinesCharCount();
    } else {
      if (guidelinesContentTextarea) guidelinesContentTextarea.value = '⚠️ 無法載入指引內容: ' + (data.error || '未知錯誤');
    }
  } catch (err) {
    if (guidelinesContentTextarea) guidelinesContentTextarea.value = '⚠️ 網路連線錯誤: ' + err.message;
  }
}

if (guidelinesContentTextarea) {
  guidelinesContentTextarea.addEventListener('input', updateGuidelinesCharCount);
}

function toggleGuidelinesModal(open) {
  if (!guidelinesModal) return;
  if (typeof window.haptic === 'function') window.haptic('light');
  if (open) {
    guidelinesModal.classList.remove('opacity-0', 'pointer-events-none');
    loadGuidelines();
  } else {
    guidelinesModal.classList.add('opacity-0', 'pointer-events-none');
  }
}

if (guidelinesBtn) {
  guidelinesBtn.addEventListener('click', () => {
    if (toolsMenuDropdown) toolsMenuDropdown.classList.add('hidden');
    toggleGuidelinesModal(true);
  });
}
if (closeGuidelinesBtn) {
  closeGuidelinesBtn.addEventListener('click', () => toggleGuidelinesModal(false));
}
if (guidelinesModal) {
  guidelinesModal.addEventListener('click', (e) => {
    if (e.target === guidelinesModal) toggleGuidelinesModal(false);
  });
}
if (copyGuidelinesBtn) {
  copyGuidelinesBtn.addEventListener('click', async () => {
    const textToCopy = guidelinesContentTextarea ? guidelinesContentTextarea.value : '';
    if (!textToCopy) return;
    try {
      await navigator.clipboard.writeText(textToCopy);
      if (typeof window.haptic === 'function') window.haptic([30, 50]);
      const origHtml = copyGuidelinesBtn.innerHTML;
      copyGuidelinesBtn.innerHTML = '<span>✅ 已複製全文！</span>';
      copyGuidelinesBtn.classList.remove('bg-purple-600', 'hover:bg-purple-500');
      copyGuidelinesBtn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
      setTimeout(() => {
        copyGuidelinesBtn.innerHTML = origHtml;
        copyGuidelinesBtn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
        copyGuidelinesBtn.classList.add('bg-purple-600', 'hover:bg-purple-500');
      }, 2500);
    } catch (e) {
      alert('複製失敗，請手動選取文字');
    }
  });
}

// 🚀 Sync Guidelines to Default Files (~/GEMINI.md, ~/AGENTS.md, etc.)
const syncGuidelinesBtn = document.getElementById('sync-guidelines-btn');
if (syncGuidelinesBtn) {
  syncGuidelinesBtn.addEventListener('click', async () => {
    const origHtml = syncGuidelinesBtn.innerHTML;
    const contentToSave = guidelinesContentTextarea ? guidelinesContentTextarea.value : '';
    try {
      syncGuidelinesBtn.innerHTML = '<span>⏳ 正在儲存並同步...</span>';
      const res = await fetch('/api/guidelines/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: contentToSave })
      });
      const data = await res.json();
      if (data.success) {
        if (typeof window.haptic === 'function') window.haptic([30, 40, 50]);
        syncGuidelinesBtn.innerHTML = '<span>✅ 已儲存並同步至預設路徑！</span>';
        syncGuidelinesBtn.classList.remove('from-emerald-600', 'to-teal-600');
        syncGuidelinesBtn.classList.add('from-indigo-600', 'to-emerald-600');
        setTimeout(() => {
          syncGuidelinesBtn.innerHTML = origHtml;
          syncGuidelinesBtn.classList.remove('from-indigo-600', 'to-emerald-600');
          syncGuidelinesBtn.classList.add('from-emerald-600', 'to-teal-600');
        }, 3000);
      } else {
        alert('同步失敗: ' + (data.error || '未知錯誤'));
        syncGuidelinesBtn.innerHTML = origHtml;
      }
    } catch (err) {
      alert('連線失敗: ' + err.message);
      syncGuidelinesBtn.innerHTML = origHtml;
    }
  });
}

// 📳 Tactical Mobile Haptic Feedback (Web Vibration API)
function haptic(type = 'light') {
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      if (type === 'light') navigator.vibrate(12);
      else if (type === 'medium') navigator.vibrate(25);
      else if (type === 'success') navigator.vibrate([15, 30, 20]);
      else if (type === 'warning' || type === 'heavy') navigator.vibrate([30, 40, 30]);
    } catch (e) {}
  }
}
window.haptic = haptic;

// Smart Scroll
function scrollToBottom(force = false) {
  if (force || !userScrolledUp) {
    if (messagesContainer) messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
}

// Copy to Clipboard (with Haptic Feedback)
function copyToClipboard(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    haptic('success');
    const original = btn.innerHTML;
    btn.innerHTML = `<span class="text-emerald-400 font-medium">✓ 已複製</span>`;
    setTimeout(() => { btn.innerHTML = original; }, 1800);
  }).catch(() => {
    haptic('warning');
    alert('複製失敗');
  });
}

// Lightbox
function showLightbox(src) {
  if (lightboxImg && lightbox) {
    haptic('light');
    lightboxImg.src = src;
    lightbox.classList.remove('opacity-0', 'pointer-events-none');
  }
}

// Drawer Toggle (with Haptic Feedback)
function toggleDrawer(open) {
  if (!drawer || !drawerOverlay) return;
  haptic('light');
  if (open) {
    drawer.classList.remove('-translate-x-full');
    drawerOverlay.classList.remove('opacity-0', 'pointer-events-none');
    if (typeof loadConversations === 'function') loadConversations();
  } else {
    drawer.classList.add('-translate-x-full');
    drawerOverlay.classList.add('opacity-0', 'pointer-events-none');
  }
}

// Capabilities Cheat Sheet Modal Handlers
function toggleCheatSheet(open) {
  if (!cheatSheetModal) return;
  if (open) {
    cheatSheetModal.classList.remove('opacity-0', 'pointer-events-none');
  } else {
    cheatSheetModal.classList.add('opacity-0', 'pointer-events-none');
  }
}

// Usage Quota Modal Handlers
function toggleUsageModal(open) {
  if (!usageModal) return;
  if (open) {
    usageModal.classList.remove('opacity-0', 'pointer-events-none');
    loadUsageData();
  } else {
    usageModal.classList.add('opacity-0', 'pointer-events-none');
  }
}

async function loadUsageData() {
  if (!usageBarsContainer) return;
  const provider = providerConfig();
  const usage = provider.capabilities?.usage || { mode: 'unsupported' };
  const isEnglish = typeof getCrewLocale === 'function' && getCrewLocale() === 'en';
  if (usage.mode === 'external-link') {
    if (usageModalSubtitle) usageModalSubtitle.textContent = isEnglish ? `${provider.shortLabel || provider.label} usage is available on the official account page` : `${provider.shortLabel || provider.label} 配額由官方帳戶頁面提供`;
    if (usageModalFooterText) usageModalFooterText.textContent = isEnglish ? 'Opens in a new browser tab' : '將在瀏覽器新分頁開啟';
    if (refreshUsageBtn) refreshUsageBtn.classList.add('hidden');
    usageBarsContainer.innerHTML = `
      <div class="p-4 rounded-xl bg-slate-950 border border-emerald-800/70 text-xs text-slate-300 space-y-3">
        <div class="flex items-start gap-3">
          <span class="text-2xl">${provider.icon || '🤖'}</span>
          <div class="space-y-1">
            <div class="font-bold text-white">${escapeHtml(provider.label)} ${isEnglish ? 'usage' : '用量'}</div>
            <p class="text-[11px] text-slate-400 leading-relaxed">${isEnglish ? 'View remaining usage, reset times, and available extra credits for the current plan.' : '查看目前方案的剩餘用量、重置時間與可購買的額外 credits。'}</p>
          </div>
        </div>
        <a href="${escapeHtml(usage.url)}" target="_blank" rel="noopener noreferrer" class="w-full min-h-11 px-3 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-2 no-underline transition active:scale-[0.98] shadow-lg shadow-emerald-900/30">
          <span>🌐 ${isEnglish ? `Open the official ${escapeHtml(provider.shortLabel || provider.label)} usage page` : `前往 ${escapeHtml(provider.shortLabel || provider.label)} 官方用量頁`}</span>
          <span aria-hidden="true">↗</span>
        </a>
      </div>`;
    return;
  }
  if (usage.mode !== 'endpoint') {
    if (usageModalSubtitle) usageModalSubtitle.textContent = isEnglish ? `${provider.label} does not provide usage data yet` : `${provider.label} 尚未提供用量查詢`;
    if (usageModalFooterText) usageModalFooterText.textContent = '';
    if (refreshUsageBtn) refreshUsageBtn.classList.add('hidden');
    usageBarsContainer.innerHTML = `<div class="p-4 text-center text-xs text-slate-400">${isEnglish ? 'Usage data is not supported by this provider yet.' : '此 Provider 尚未支援用量查詢'}</div>`;
    return;
  }
  if (usageModalSubtitle) usageModalSubtitle.textContent = '即時調用 agy /usage 獲取';
  if (usageModalFooterText) usageModalFooterText.textContent = '配額以各模型重置時間為準';
  if (refreshUsageBtn) refreshUsageBtn.classList.remove('hidden');
  usageBarsContainer.innerHTML = `
    <div class="text-center py-6 text-slate-400 text-xs flex flex-col items-center gap-2 font-sans">
      <span class="inline-block w-5 h-5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin"></span>
      <span>正在執行 agy /usage 查詢即時配額...</span>
    </div>
  `;

  try {
    const res = await fetch(usage.endpoint);
    const data = await res.json();

    if (data.quotas && data.quotas.length > 0) {
      usageBarsContainer.innerHTML = data.quotas.map(q => {
        const pct = q.percent;
        let barColor = 'bg-emerald-500';
        let textColor = 'text-emerald-400';
        if (pct < 20) {
          barColor = 'bg-rose-500';
          textColor = 'text-rose-400';
        } else if (pct < 50) {
          barColor = 'bg-amber-500';
          textColor = 'text-amber-400';
        }

        const resetTime = q.resetAt ? new Date(q.resetAt).toLocaleString('zh-TW', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

        return `
          <div class="p-3 rounded-xl bg-slate-950/90 border border-slate-800 space-y-1.5 font-sans shadow-sm">
            <div class="flex items-center justify-between text-xs">
              <span class="font-bold text-white">${escapeHtml(q.model)}</span>
              <span class="font-mono font-bold ${textColor}">${pct}% 剩餘</span>
            </div>
            <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
              <div class="h-full rounded-full ${barColor} transition-all duration-500" style="width: ${pct}%"></div>
            </div>
            <div class="flex items-center justify-between text-[10px] text-slate-400 font-mono">
              <span>${escapeHtml(q.type)}</span>
              ${resetTime ? `<span>重置: ${resetTime}</span>` : ''}
            </div>
          </div>
        `;
      }).join('');
    } else {
      usageBarsContainer.innerHTML = `
        <div class="p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 font-mono whitespace-pre-wrap">${escapeHtml(data.raw || '未能解析到配額資訊')}</div>
      `;
    }
  } catch (err) {
    usageBarsContainer.innerHTML = `
      <div class="p-3 rounded-xl bg-rose-950/50 border border-rose-800 text-xs text-rose-300">查詢失敗: ${escapeHtml(err.message)}</div>
    `;
  }
}

function providerQuery() {
  return 'provider=' + encodeURIComponent(currentProvider);
}

function providerConfig(providerId = currentProvider) {
  return availableProviders.find(provider => provider.id === providerId) || DEFAULT_PROVIDERS.find(provider => provider.id === providerId) || DEFAULT_PROVIDERS[0];
}

function providerStorageKey(kind, providerId = currentProvider) {
  return `${providerConfig(providerId).storagePrefix || providerId}_${kind}`;
}

async function loadProviderCatalog() {
  try {
    const res = await fetch('/api/providers');
    const data = await res.json();
    if (Array.isArray(data.providers) && data.providers.length > 0) availableProviders = data.providers;
  } catch (_) {}
  if (!availableProviders.some(provider => provider.id === currentProvider)) {
    currentProvider = availableProviders[0]?.id || 'antigravity';
    localStorage.setItem('crew_current_provider', currentProvider);
  }
  renderProviderOptions();
  return availableProviders;
}

function activeConversationStorageKey() {
  return providerStorageKey('active_conv_id');
}

function renderProviderOptions() {
  if (!providerOptionsContainer) return;
  providerOptionsContainer.style.gridTemplateColumns = `repeat(${Math.min(availableProviders.length, 3)}, minmax(0, 1fr))`;
  providerOptionsContainer.innerHTML = availableProviders.map(provider => `
    <button type="button" data-provider="${escapeHtml(provider.id)}" onclick="selectProvider('${escapeHtml(provider.id)}')" class="provider-option px-3 py-2 rounded-xl border text-xs font-bold transition active:scale-95">
      ${provider.icon || '🤖'} ${escapeHtml(provider.label)}
    </button>
  `).join('');
  providerOptionsContainer.querySelectorAll('.provider-option').forEach(button => {
    const active = button.dataset.provider === currentProvider;
    button.className = 'provider-option px-3 py-2 rounded-xl border text-xs font-bold transition active:scale-95 ' +
      (active ? 'bg-indigo-950/80 border-indigo-500 text-white ring-2 ring-indigo-500/40' : 'bg-slate-950 border-slate-800 text-slate-400');
  });
}

window.selectProvider = async function(providerId) {
  if (!availableProviders.some(provider => provider.id === providerId) || providerId === currentProvider) return;
  if (currentAbortController) { try { currentAbortController.abort(); } catch (_) {} }
  currentProvider = providerId;
  localStorage.setItem('crew_current_provider', currentProvider);
  currentConversationId = localStorage.getItem(activeConversationStorageKey());
  const models = availableModels.filter(model => (model.provider || 'antigravity') === currentProvider);
  const savedModelKey = providerStorageKey('current_model');
  currentModel = localStorage.getItem(savedModelKey) || (models.find(model => model.isDefault) || models[0] || {}).id || 'gemini-3.7-flash';
  const effortKey = providerStorageKey('current_effort');
  const selectedModel = models.find(model => model.id === currentModel);
  const supported = selectedModel?.supportedReasoningEfforts || ['low', 'medium', 'high'];
  currentEffort = localStorage.getItem(effortKey) || selectedModel?.defaultReasoningEffort || 'low';
  if (!supported.includes(currentEffort)) currentEffort = selectedModel?.defaultReasoningEffort || supported[0] || 'low';
  renderProviderOptions();
  updateModelUI();
  loadModelsList();
  toggleModelModal(false);
  if (currentConversationId) await loadConversationHistory(currentConversationId);
  else {
    messagesContainer.innerHTML = '';
    appendMessage('assistant', providerConfig().greeting || '你好！已為你開啟新對話。有什麼可以幫你的？');
    if (headerTitle) headerTitle.textContent = '新對話';
  }
  loadConversations();
  window.requestProviderPrewarm();
};

// Model & Thinking Effort Handlers
function updateModelUI() {
  const found = availableModels.find(m => m.id === currentModel);
  if (found) {
    if (modelBadgeIcon) modelBadgeIcon.textContent = found.icon;
    if (modelDisplayName) modelDisplayName.textContent = found.name;
  } else {
    if (modelBadgeIcon) modelBadgeIcon.textContent = '✨';
    if (modelDisplayName) modelDisplayName.textContent = currentModel.replace('gemini-', 'Gemini ').replace('claude-', 'Claude ');
  }
}

const EFFORT_UI = {
  low: { name: '極速 (Low)', subtitle: '⚡ 快速回應', icon: '⚡', color: 'emerald' },
  medium: { name: '平衡 (Medium)', subtitle: '⚖️ 平衡推理', icon: '⚖️', color: 'amber' },
  high: { name: '深度 (High)', subtitle: '🧠 深度推理', icon: '🧠', color: 'indigo' },
  xhigh: { name: '極深 (XHigh)', subtitle: '🔬 強化推理', icon: '🔬', color: 'purple' },
  max: { name: '最大 (Max)', subtitle: '🚀 最大推理', icon: '🚀', color: 'rose' },
  ultra: { name: '終極 (Ultra)', subtitle: '💫 終極推理', icon: '💫', color: 'cyan' }
};

function selectedModelConfig() {
  return availableModels.find(model => model.id === currentModel);
}

window.applyConversationSettings = function(settings) {
  if (!settings || settings.provider !== currentProvider) return false;
  const providerModels = availableModels.filter(model => (model.provider || 'antigravity') === currentProvider);
  const selected = providerModels.find(model => model.id === settings.model);
  if (!selected) return false; // Model may have been removed from this device.

  currentModel = selected.id;
  const supported = selected.supportedReasoningEfforts || ['low', 'medium', 'high'];
  currentEffort = supported.includes(settings.effort)
    ? settings.effort
    : (selected.defaultReasoningEffort || supported[0] || 'low');
  localStorage.setItem(providerStorageKey('current_model'), currentModel);
  localStorage.setItem(providerStorageKey('current_effort'), currentEffort);
  updateModelUI();
  updateEffortUI();
  return true;
};

window.saveCurrentConversationSettings = function() {
  if (!currentConversationId) return Promise.resolve(null);
  return fetch('/api/conversation-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: currentProvider,
      conversation_id: currentConversationId,
      model: currentModel,
      effort: currentEffort
    })
  }).then(res => {
    if (!res.ok) throw new Error('儲存對話模型設定失敗');
    return res.json();
  }).catch(err => {
    console.warn('[Conversation Settings]', err.message);
    return null;
  });
};

function supportedEffortsForCurrentModel() {
  const model = selectedModelConfig();
  return model?.supportedReasoningEfforts?.length ? model.supportedReasoningEfforts : ['low', 'medium', 'high'];
}

function updateEffortUI() {
  const conf = EFFORT_UI[currentEffort] || EFFORT_UI.low;
  if (effortBadgeIcon) effortBadgeIcon.textContent = conf.icon;
  if (effortDisplayName) {
    effortDisplayName.textContent = conf.name;
    effortDisplayName.className = `font-semibold text-${conf.color}-300 truncate`;
  }
  if (effortActiveHint) effortActiveHint.textContent = `${conf.name} · 生效中`;
}

function renderEffortOptions() {
  if (!effortOptionsContainer) return;
  const efforts = supportedEffortsForCurrentModel().map(id => ({ id, ...(EFFORT_UI[id] || { name: id, subtitle: 'Reasoning', icon: '🧠', color: 'slate' }) }));
  effortOptionsContainer.className = efforts.length > 3 ? 'grid grid-cols-3 gap-1.5' : 'grid grid-cols-3 gap-1.5';
  effortOptionsContainer.innerHTML = efforts.map(e => {
    const isSelected = e.id === currentEffort;
    const activeClass = isSelected
      ? `bg-${e.color}-950/80 border-${e.color}-500/80 ring-2 ring-${e.color}-500 text-white`
      : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:border-slate-700';
    return `<button type="button" class="p-2 rounded-xl border ${activeClass} transition active:scale-95 flex flex-col items-center text-center gap-0.5" onclick="selectEffort('${e.id}')">
      <span class="text-xs font-bold">${e.name}</span>
      <span class="text-[9px] text-slate-400 font-mono">${e.subtitle}</span>
    </button>`;
  }).join('');
}

let isModelModalOpen = false;

function toggleModelModal(open) {
  if (!modelModal) return;
  if (isModelModalOpen === open) return;
  isModelModalOpen = open;
  modelModal.classList.toggle('hidden', !open);
  modelModal.setAttribute('aria-hidden', open ? 'false' : 'true');
  if (open) {
    renderProviderOptions();
    loadModelsList();
    renderEffortOptions();
  }
}

async function loadModelsList() {
  if (!modelOptionsContainer) return;
  try {
    await loadModelsCatalog();

    const providerModels = availableModels.filter(m => (m.provider || 'antigravity') === currentProvider);
    modelOptionsContainer.innerHTML = providerModels.map(m => {
      const isSelected = (m.id === currentModel);
      const activeRing = isSelected ? 'ring-2 ring-indigo-500 bg-indigo-950/50 border-indigo-500/80' : 'bg-slate-950/80 border-slate-800 hover:border-slate-700';

      return `
        <button type="button" class="w-full text-left p-3 rounded-xl border ${activeRing} transition active:scale-[0.98] flex items-center justify-between gap-2 shadow-sm font-sans" onclick="selectModel('${m.id}')">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="text-xl shrink-0">${m.icon}</span>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="font-bold text-xs text-white truncate">${escapeHtml(m.name)}</span>
                <span class="text-[9px] px-1.5 py-0.5 rounded border font-mono ${m.badgeColor}">${m.badge}</span>
              </div>
              <div class="text-[11px] text-slate-400 truncate mt-0.5">${escapeHtml(m.desc)}</div>
            </div>
          </div>
          ${isSelected ? '<span class="text-indigo-400 font-bold text-sm shrink-0">✓</span>' : ''}
        </button>
      `;
    }).join('');

  } catch (e) {
    modelOptionsContainer.innerHTML = `<div class="p-3 text-xs text-rose-400">載入模型清單失敗</div>`;
  }
}

window.selectModel = function(modelId) {
  currentModel = modelId;
  const selected = selectedModelConfig();
  const supported = supportedEffortsForCurrentModel();
  if (!supported.includes(currentEffort)) currentEffort = selected?.defaultReasoningEffort || supported[0] || 'low';
  localStorage.setItem(providerStorageKey('current_effort'), currentEffort);
  localStorage.setItem(providerStorageKey('current_model'), currentModel);
  updateModelUI();
  updateEffortUI();
  renderEffortOptions();
  toggleModelModal(false);
  if (navigator.vibrate) navigator.vibrate(20);
  console.log(`🤖 已切換 AI 核心模型至: ${currentModel}`);
  window.saveCurrentConversationSettings();
  window.requestProviderPrewarm();
};

window.selectEffort = function(effortId) {
  currentEffort = effortId;
  localStorage.setItem(providerStorageKey('current_effort'), currentEffort);
  updateEffortUI();
  renderEffortOptions();
  if (navigator.vibrate) navigator.vibrate(20);
  console.log(`🧠 已切換思考強度至: ${currentEffort}`);
  window.saveCurrentConversationSettings();
  window.requestProviderPrewarm();
};

// Push Notification Helpers
async function triggerDoneNotification(text) {
  if (!notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;

  const cleanSummary = (text || '回覆已完成')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[*#_~`<>]/g, '')
    .trim()
    .slice(0, 70);

  const notifOptions = {
    body: `✨ ${cleanSummary || '回覆已生成完畢！'}`,
    tag: 'agy-done',
    renotify: true,
    vibrate: [200, 100, 200]
  };

  if (swRegistration && swRegistration.showNotification) {
    try {
      await swRegistration.showNotification('Crew Pocket', notifOptions);
      return;
    } catch (e) {
      console.warn('[SW showNotification error]', e);
    }
  }

  try {
    const n = new Notification('Crew Pocket', notifOptions);
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (e) {}
}

function updateNotifyBtnUI() {
  if (!notifyBtn) return;
  if (!('Notification' in window)) {
    notifyBtn.style.display = 'none';
    return;
  }
  if (Notification.permission === 'granted' && notificationsEnabled) {
    notifyBtn.classList.add('text-indigo-400', 'bg-indigo-600/20');
    notifyBtn.classList.remove('text-slate-400');
    notifyBtn.title = '通知已開啟 (點擊測試/關閉)';
    if (notifyStatusSubtext) notifyStatusSubtext.innerHTML = '<span class="text-emerald-400">已開啟 ✓</span>';
  } else {
    notifyBtn.classList.remove('text-indigo-400', 'bg-indigo-600/20');
    notifyBtn.classList.add('text-slate-400');
    notifyBtn.title = '通知已關閉 (點擊開啟)';
    if (notifyStatusSubtext) notifyStatusSubtext.innerHTML = '<span class="text-slate-500">已關閉</span>';
  }
}

// ==========================================
// 📁 Termux Local Files Explorer Logic
// ==========================================
let currentExplorerPath = '';
let currentPreviewFullPath = '';
let currentPreviewFileName = '';
const FILE_SWIPE_REVEAL_PX = 88;

function toggleFilesModal(open) {
  if (!filesModal) return;
  if (open) {
    filesModal.classList.remove('opacity-0', 'pointer-events-none');
    loadDirectory(currentExplorerPath);
  } else {
    filesModal.classList.add('opacity-0', 'pointer-events-none');
  }
}

async function loadDirectory(relPath = '') {
  if (!filesListContainer) return;
  currentExplorerPath = relPath;
  if (filePreviewPane) filePreviewPane.classList.add('hidden');
  
  filesListContainer.innerHTML = `
    <div class="text-center py-6 text-slate-400 text-xs flex flex-col items-center gap-2 font-sans">
      <span class="inline-block w-4 h-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin"></span>
      <span>正在讀取目錄內容...</span>
    </div>
  `;

  try {
    const res = await fetch(`/api/files?path=${encodeURIComponent(relPath)}`);
    const data = await res.json();
    if (!data.success) {
      filesListContainer.innerHTML = `<div class="p-3 text-rose-400 text-xs font-mono">讀取失敗：${escapeHtml(data.error)}</div>`;
      return;
    }

    if (filesBasePath) filesBasePath.textContent = `~/${data.currentPath || ''}`;
    if (filesCountBadge) filesCountBadge.textContent = `${data.entries ? data.entries.length : 0} 個項目`;

    // Render Breadcrumbs
    renderBreadcrumbs(data.currentPath);

    if (!data.entries || data.entries.length === 0) {
      filesListContainer.innerHTML = `
        <div class="p-6 text-center text-slate-500 font-sans">此資料夾為空</div>
      `;
      return;
    }

    let itemsHtml = '';

    // Up level item if not at root
    if (!data.isRoot) {
      itemsHtml += `
        <div class="p-2 rounded-xl bg-slate-950/60 hover:bg-slate-800/80 border border-slate-800/80 transition flex items-center justify-between cursor-pointer group select-none" onclick="loadDirectory('${escapeHtml(data.parentPath || '')}')">
          <div class="flex items-center gap-2">
            <span class="text-base">📁</span>
            <span class="font-bold text-slate-300 font-mono">.. (回上一層)</span>
          </div>
        </div>
      `;
    }

    data.entries.forEach(item => {
      const safeRelPath = encodeURIComponent(item.relPath);
      const safeName = encodeURIComponent(item.name);
      const deleteAction = `<div class="absolute inset-0 bg-rose-600 text-white flex items-center justify-end pr-7"><button type="button" class="file-swipe-delete min-w-12 min-h-12 hover:bg-rose-500 active:bg-rose-700 rounded-xl text-[11px] font-bold flex flex-col items-center justify-center gap-1" data-file-path="${safeRelPath}" data-file-name="${safeName}" data-file-directory="${item.isDirectory}"><span class="text-base leading-none">🗑️</span><span>刪除</span></button></div>`;
      if (item.isDirectory) {
        itemsHtml += `
          <div class="file-swipe-row relative overflow-hidden rounded-xl" data-file-path="${safeRelPath}">
            ${deleteAction}
            <div class="file-swipe-content relative p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800/80 transition flex items-center justify-between cursor-pointer group select-none touch-pan-y" onclick="loadDirectory('${escapeHtml(item.relPath)}')">
              <div class="flex items-center gap-2 min-w-0">
                <span class="text-base shrink-0">${item.icon}</span>
                <span class="font-bold text-slate-200 font-mono truncate">${escapeHtml(item.name)}/</span>
              </div>
              <span class="text-[10px] text-slate-500 font-mono group-hover:text-emerald-400 transition">進入 ▸</span>
            </div>
          </div>
        `;
      } else {
        itemsHtml += `
          <div class="file-swipe-row relative overflow-hidden rounded-xl" data-file-path="${safeRelPath}">
            ${deleteAction}
            <div class="file-swipe-content relative p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800/60 transition flex items-center justify-between gap-2 group select-none touch-pan-y">
              <div class="flex items-center gap-2 min-w-0 flex-1 cursor-pointer" onclick="previewFile('${escapeHtml(item.relPath)}')">
                <span class="text-base shrink-0">${item.icon}</span>
                <div class="min-w-0">
                  <div class="font-mono text-slate-200 truncate group-hover:text-emerald-300 transition">${escapeHtml(item.name)}</div>
                  <div class="text-[10px] text-slate-500 font-mono">${item.sizeFormatted}</div>
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                <button type="button" class="px-2 py-1 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 active:bg-indigo-700 text-white text-[10px] font-medium flex items-center gap-1 transition active:scale-95 shadow-sm" onclick="sendPathToAI('${escapeHtml(item.fullPath)}', '${escapeHtml(item.name)}')">
                  <span>💬 傳給 AI</span>
                </button>
                <button type="button" class="p-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-[10px] transition active:scale-95" title="預覽內容" onclick="previewFile('${escapeHtml(item.relPath)}')">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                </button>
              </div>
            </div>
          </div>
        `;
      }
    });

    filesListContainer.innerHTML = itemsHtml;
    bindExplorerSwipeDelete();

  } catch (err) {
    filesListContainer.innerHTML = `<div class="p-3 text-rose-400 text-xs">請求異常：${escapeHtml(err.message)}</div>`;
  }
}

function bindExplorerSwipeDelete() {
  if (!filesListContainer) return;
  filesListContainer.querySelectorAll('.file-swipe-delete').forEach(button => {
    button.addEventListener('click', async () => {
      const relPath = decodeURIComponent(button.dataset.filePath || '');
      const name = decodeURIComponent(button.dataset.fileName || '');
      await confirmExplorerDelete(relPath, name, button.dataset.fileDirectory === 'true');
    });
  });

  filesListContainer.querySelectorAll('.file-swipe-row').forEach(row => {
    const content = row.querySelector('.file-swipe-content');
    if (!content) return;
    let startX = 0;
    let offsetX = 0;
    let dragging = false;
    let suppressClick = false;
    const setOffset = (value, animate = false) => {
      content.style.transition = animate ? 'transform 160ms ease-out' : 'none';
      content.style.transform = `translateX(${value}px)`;
    };

    content.addEventListener('pointerdown', event => {
      startX = event.clientX;
      offsetX = content.style.transform ? -FILE_SWIPE_REVEAL_PX : 0;
      dragging = false;
      content.setPointerCapture?.(event.pointerId);
    });
    content.addEventListener('pointermove', event => {
      if (!startX) return;
      const deltaX = event.clientX - startX;
      if (Math.abs(deltaX) < 7 && !dragging) return;
      if (Math.abs(deltaX) > 7) dragging = true;
      const next = Math.max(-FILE_SWIPE_REVEAL_PX, Math.min(0, offsetX + deltaX));
      setOffset(next);
    });
    const finish = event => {
      if (!startX) return;
      const deltaX = event.clientX - startX;
      const draggedToEnd = dragging && (offsetX + deltaX) <= -(FILE_SWIPE_REVEAL_PX - 4);
      suppressClick = dragging;
      setOffset(draggedToEnd ? -FILE_SWIPE_REVEAL_PX : 0, true);
      startX = 0;
      if (draggedToEnd) {
        const deleteButton = row.querySelector('.file-swipe-delete');
        const relPath = decodeURIComponent(deleteButton?.dataset.filePath || '');
        const name = decodeURIComponent(deleteButton?.dataset.fileName || '');
        const isDirectory = deleteButton?.dataset.fileDirectory === 'true';
        window.setTimeout(async () => {
          await confirmExplorerDelete(relPath, name, isDirectory);
          if (row.isConnected) setOffset(0, true);
        }, 120);
      }
      window.setTimeout(() => { suppressClick = false; }, 0);
    };
    content.addEventListener('pointerup', finish);
    content.addEventListener('pointercancel', () => { startX = 0; setOffset(0, true); });
    content.addEventListener('click', event => {
      if (!suppressClick) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  });
}

async function confirmExplorerDelete(relPath, name, isDirectory) {
  const noun = isDirectory ? '資料夾及其全部內容' : '檔案';
  if (!window.confirm(`確定永久刪除${noun}「${name}」？\n此動作無法復原。`)) return false;

  try {
    const res = await fetch('/api/file/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relPath })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '刪除失敗');
    if (filePreviewPane && currentPreviewFullPath.endsWith(`/${relPath}`)) filePreviewPane.classList.add('hidden');
    if (navigator.vibrate) navigator.vibrate([25, 30, 25]);
    await loadDirectory(currentExplorerPath);
    return true;
  } catch (err) {
    window.alert(`刪除失敗：${err.message}`);
    return false;
  }
}

function renderBreadcrumbs(currentRel = '') {
  if (!filesBreadcrumb) return;
  if (!currentRel) {
    filesBreadcrumb.innerHTML = `<span class="text-emerald-400 font-bold font-mono">~ (家目錄)</span>`;
    return;
  }

  const parts = currentRel.split(/[\/\\]+/).filter(Boolean);
  let accumulated = '';
  let html = `<span class="text-slate-400 hover:text-emerald-400 font-bold cursor-pointer hover:underline" onclick="loadDirectory('')">~</span>`;

  parts.forEach((p, idx) => {
    accumulated = accumulated ? `${accumulated}/${p}` : p;
    const isLast = idx === parts.length - 1;
    if (isLast) {
      html += ` <span class="text-slate-600">/</span> <span class="text-emerald-400 font-bold font-mono">${escapeHtml(p)}</span>`;
    } else {
      const curPath = accumulated;
      html += ` <span class="text-slate-600">/</span> <span class="text-slate-300 hover:text-emerald-400 font-mono cursor-pointer hover:underline" onclick="loadDirectory('${escapeHtml(curPath)}')">${escapeHtml(p)}</span>`;
    }
  });

  filesBreadcrumb.innerHTML = html;
}

window.loadDirectory = loadDirectory;
window.previewFile = previewFile;
window.sendPathToAI = sendPathToAI;

async function previewFile(relPath) {
  if (!filePreviewPane) return;
  try {
    const res = await fetch(`/api/file/read?path=${encodeURIComponent(relPath)}`);
    const data = await res.json();
    if (!data.success) {
      alert(`無法預覽：${data.error}`);
      return;
    }

    currentPreviewFullPath = data.fullPath;
    currentPreviewFileName = data.name;

    if (previewFileIcon) previewFileIcon.textContent = data.icon;
    if (previewFileName) previewFileName.textContent = data.name;
    if (previewFileSize) previewFileSize.textContent = data.sizeFormatted;
    if (previewFileContent) previewFileContent.textContent = data.content;

    filePreviewPane.classList.remove('hidden');

  } catch (err) {
    alert(`預覽出錯：${err.message}`);
  }
}

function sendPathToAI(fullPath, name) {
  if (!promptInput) return;
  promptInput.value = `請幫我閱讀並分析這個檔案（${name}）：\n${fullPath}`;
  promptInput.focus();
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
  toggleFilesModal(false);
  if (navigator.vibrate) navigator.vibrate(30);
}
