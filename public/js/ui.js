// Antigravity Web UI - UI State, Modals & Helpers

// Global State
const DEFAULT_PROVIDERS = [
  { id: 'antigravity', label: 'Antigravity', shortLabel: 'AGY', icon: '✨', storagePrefix: 'agy', badgeClass: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40', greeting: '你好！已為你開啟新對話。有什麼可以幫你的？', capabilities: { history: true, rewind: true, autoTitle: false, compact: 'checkpoint', usage: { mode: 'endpoint', endpoint: '/api/usage' } } },
  { id: 'codex', label: 'OpenAI Codex', shortLabel: 'Codex', icon: '🧩', storagePrefix: 'codex', badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', greeting: '你好！Codex provider 已就緒。有什麼開發任務？', capabilities: { history: true, rewind: false, autoTitle: false, compact: 'native', usage: { mode: 'external-link', url: 'https://chatgpt.com/codex/settings/usage' } } }
];
let availableProviders = DEFAULT_PROVIDERS;
let currentConversationId = null;
let currentProvider = localStorage.getItem('crew_current_provider') || 'antigravity';
const initialModelStoragePrefix = currentProvider === 'codex' ? 'codex' : 'agy';
const initialModelFallback = currentProvider === 'codex' ? 'gpt-5.6-terra' : 'gemini-3.7-flash';
let currentModel = localStorage.getItem(`${initialModelStoragePrefix}_current_model`)
  || (currentProvider === 'antigravity' ? localStorage.getItem('agy_current_model') : null)
  || initialModelFallback;
let currentEffort = localStorage.getItem(providerStorageKey('current_effort')) || 'low';
const BUILTIN_MODEL_FALLBACKS = [
  { id: 'gpt-6-astra', provider: 'codex', name: 'GPT-6 Astra', desc: '最強旗艦 · 複雜多步開發與代理任務', icon: '✦', badge: '旗艦', badgeColor: 'bg-violet-500/20 text-violet-200 border-violet-400/40', isDefault: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-6-sol', provider: 'codex', name: 'GPT-6 Sol', desc: '日常開發與複雜工作主力模型', icon: '☀️', badge: 'Sol', badgeColor: 'bg-orange-500/20 text-orange-200 border-orange-400/40', isDefault: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { id: 'gpt-6-luna', provider: 'codex', name: 'GPT-6 Luna', desc: '快速省資源 · 輕量與高頻工作', icon: '🌙', badge: 'Luna', badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDefault: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.6-sol', provider: 'codex', name: 'GPT-5.6 Sol', desc: '旗艦能力 · 複雜推理與大型開發任務', icon: '☀️', badge: 'Sol', badgeColor: 'bg-orange-500/20 text-orange-200 border-orange-400/40', isDefault: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.6-terra', provider: 'codex', name: 'GPT-5.6 Terra', desc: '能力與速度平衡 · 日常開發推薦', icon: '🌍', badge: '預設', badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.6-luna', provider: 'codex', name: 'GPT-5.6 Luna', desc: '快速省資源 · 高頻輕量工作', icon: '🌙', badge: 'Luna', badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', isDefault: false, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }
];
let availableModels = [...BUILTIN_MODEL_FALLBACKS];
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
let streamingStartedAt = 0;
const activeBlobUrls = new Set();
let prewarmTimer = null;
let lastPrewarmKey = '';
let lastPrewarmAt = 0;
let prewarmRequest = null;
let modelsCatalogRequest = null;
let modelsCatalogLoaded = false;
const HOME_WORKSPACE = '/data/data/com.termux/files/home';
let currentWorkspace = localStorage.getItem('crew_current_workspace') || HOME_WORKSPACE;
let availableWorkspaces = [];
let availableProjects = [];
const DEFAULT_ROLE_ID = 'role-general';
let currentRoleId = localStorage.getItem('crew_current_role') || '';
let availableRoles = [];
let crewStatusByRole = new Map();
let crewStatusRequest = null;
let crewStatusUpdatedAt = 0;
let crewStatusVerified = false;

// Coalesce boot/model/effort/new-chat prewarm requests into one provider call.
window.requestProviderPrewarm = function(delay = 250) {
  const payload = { provider: currentProvider, model: currentModel, effort: currentEffort, workspace: currentWorkspace };
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
  if (modelsCatalogLoaded) return { models: availableModels, efforts: availableEfforts };
  if (!modelsCatalogRequest) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    modelsCatalogRequest = fetch('/api/models', { signal: controller.signal })
      .then(res => {
        if (!res.ok) throw new Error('模型清單載入失敗');
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data.models) && data.models.length > 0) {
          availableModels = data.models;
          modelsCatalogLoaded = true;
        }
        if (Array.isArray(data.efforts) && data.efforts.length > 0) availableEfforts = data.efforts;
        return { models: availableModels, efforts: availableEfforts };
      })
      .catch(() => ({ models: availableModels, efforts: availableEfforts }))
      .finally(() => {
        clearTimeout(timeout);
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
const roleNavList = document.getElementById('role-nav-list');
const crewRoomSummary = document.getElementById('crew-room-summary');
const roleNavView = document.getElementById('role-nav-view');
const roleHistoryView = document.getElementById('role-history-view');
const roleHistoryTitle = document.getElementById('role-history-title');
const newChatBtn = document.getElementById('new-chat-btn');
const notifyBtn = document.getElementById('notify-btn');
const notifyStatusSubtext = document.getElementById('notify-status-subtext');
const toolsMenuBtn = document.getElementById('tools-menu-btn');
const toolsMenuDropdown = document.getElementById('tools-menu-dropdown');
const headerTitle = document.getElementById('header-title');
const workspaceSelectorBtn = document.getElementById('workspace-selector-btn');
const workspaceModal = document.getElementById('workspace-modal');
const workspaceOptions = document.getElementById('workspace-options');
const closeWorkspaceModalBtn = document.getElementById('close-workspace-modal-btn');
const workspaceIcon = document.getElementById('workspace-icon');
const workspaceLabel = document.getElementById('workspace-label');
const headerRoleProject = document.getElementById('header-role-project');
const headerCurrentTask = document.getElementById('header-current-task');
const drawerNewRoleBtn = document.getElementById('drawer-new-role-btn');
const roleEditorModal = document.getElementById('role-editor-modal');
const roleEditorForm = document.getElementById('role-editor-form');
const roleEditorTitle = document.getElementById('role-editor-title');
const roleEditorId = document.getElementById('role-editor-id');
const roleEditorName = document.getElementById('role-editor-name');
const roleEditorProject = document.getElementById('role-editor-project');
const roleEditorWorkspace = document.getElementById('role-editor-workspace');
const roleEditorDescription = document.getElementById('role-editor-description');
const roleEditorSkills = document.getElementById('role-editor-skills');
const roleEditorSystemContext = document.getElementById('role-editor-system-context');
const closeRoleEditorBtn = document.getElementById('close-role-editor-btn');
const cancelRoleEditorBtn = document.getElementById('cancel-role-editor-btn');
const roleDangerZone = document.getElementById('role-danger-zone');
const roleDangerCopy = document.getElementById('role-danger-copy');
const deleteRoleBtn = document.getElementById('delete-role-btn');
const roleDeleteModal = document.getElementById('role-delete-modal');
const roleDeleteName = document.getElementById('role-delete-name');
const closeRoleDeleteBtn = document.getElementById('close-role-delete-btn');
const cancelRoleDeleteBtn = document.getElementById('cancel-role-delete-btn');
const confirmRoleDeleteBtn = document.getElementById('confirm-role-delete-btn');
const roleMemoryModal = document.getElementById('role-memory-modal');
const roleMemoryTitle = document.getElementById('role-memory-title');
const roleMemorySubtitle = document.getElementById('role-memory-subtitle');
const roleMemoryList = document.getElementById('role-memory-list');
const closeRoleMemoryBtn = document.getElementById('close-role-memory-btn');
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
const filesDownloadBtn = document.getElementById('files-download-btn');
const filesBreadcrumb = document.getElementById('files-breadcrumb');
const filesListContainer = document.getElementById('files-list-container');
const filesTransferBar = document.getElementById('files-transfer-bar');
const filesTransferLabel = document.getElementById('files-transfer-label');
const filesTransferActions = document.getElementById('files-transfer-actions');
const filesTransferCopyBtn = document.getElementById('files-transfer-copy-btn');
const filesTransferMoveBtn = document.getElementById('files-transfer-move-btn');
const filesTransferDeleteBtn = document.getElementById('files-transfer-delete-btn');
const filesTransferPasteBtn = document.getElementById('files-transfer-paste-btn');
const filesTransferCancelBtn = document.getElementById('files-transfer-cancel-btn');
const filePreviewPane = document.getElementById('file-preview-pane');
const previewFileIcon = document.getElementById('preview-file-icon');
const previewFileName = document.getElementById('preview-file-name');
const previewFileSize = document.getElementById('preview-file-size');
const previewFileContent = document.getElementById('preview-file-content');
const previewFileImageWrap = document.getElementById('preview-file-image-wrap');
const previewFileImage = document.getElementById('preview-file-image');
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
  cancelDeferredModalDataLoad(guidelinesModal);
  if (open) {
    guidelinesModal.classList.remove('opacity-0', 'pointer-events-none');
    if (guidelinesContentTextarea) {
      guidelinesContentTextarea.value = '準備載入指引內容...';
      guidelinesContentTextarea.disabled = true;
    }
    deferModalDataLoad(guidelinesModal, loadGuidelines);
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
function showRoleNavigationView() {
  roleNavView?.classList.remove('hidden');
  roleNavView?.classList.add('flex');
  renderRoleNavigation();
}

const roleHistoryModal = document.getElementById('role-history-modal');
const roleCollaborationModal = document.getElementById('role-collaboration-modal');
const roleCollaborationTitle = document.getElementById('role-collaboration-title');
let historyRoleId = null;
let historyReturnFocus = null;
let collaborationReturnFocus = null;

// Listing another Role's history must not silently switch the active conversation.
window.getCrewHistoryRoleId = () => historyRoleId;
function showRoleHistoryView(roleId = currentRoleId || DEFAULT_ROLE_ID) {
  const role = roleMeta(roleId);
  if (!role || !roleHistoryModal) return;
  historyRoleId = role.id;
  historyReturnFocus = document.activeElement;
  if (roleHistoryTitle) roleHistoryTitle.textContent = role.name + ' · 工作紀錄';
  if (convList) convList.innerHTML = '<div class="crew-record-loading">正在讀取此角色的工作紀錄…</div>';
  toggleRoleModal(roleHistoryModal, true);
  window.renderCrewHistoryFromCache?.();
  // force refresh even when the crew home itself did not need refreshing.
  if (typeof loadConversations === 'function') {
    loadConversations({ force: true }).catch(() => {
      if (convList && historyRoleId === role.id) {
        convList.innerHTML = '<div class="crew-record-loading">工作紀錄讀取失敗，請重試。</div>';
      }
    });
  }
  document.getElementById('back-to-role-nav-btn')?.focus({ preventScroll: true });
}
function closeCrewHistory() {
  if (!roleHistoryModal || roleHistoryModal.classList.contains('hidden')) return;
  toggleRoleModal(roleHistoryModal, false);
  historyRoleId = null;
  const focus = historyReturnFocus;
  historyReturnFocus = null;
  focus?.focus?.({ preventScroll: true });
}
function openCrewCollaboration(roleId = currentRoleId || DEFAULT_ROLE_ID) {
  const role = roleMeta(roleId);
  if (!role || !roleCollaborationModal) return;
  collaborationReturnFocus = document.activeElement;
  if (roleCollaborationTitle) roleCollaborationTitle.textContent = role.name + ' · 協作紀錄';
  toggleRoleModal(roleCollaborationModal, true);
  window.CrewMissionGraph?.inspectRole(role.id);
  document.getElementById('close-role-collaboration-btn')?.focus({ preventScroll: true });
}
function closeCrewCollaboration({ handoff = false } = {}) {
  if (!roleCollaborationModal || roleCollaborationModal.classList.contains('hidden')) return;
  window.CrewMissionGraph?.close?.();
  toggleRoleModal(roleCollaborationModal, false, { handoff });
  const focus = collaborationReturnFocus;
  collaborationReturnFocus = null;
  focus?.focus?.({ preventScroll: true });
}
document.getElementById('back-to-role-nav-btn')?.addEventListener('click', closeCrewHistory);
document.getElementById('close-role-collaboration-btn')?.addEventListener('click', closeCrewCollaboration);
document.getElementById('crew-collaboration-open')?.addEventListener('click', () => openCrewCollaboration());
roleHistoryModal?.addEventListener('click', event => {
  if (event.target === roleHistoryModal) closeCrewHistory();
});
roleCollaborationModal?.addEventListener('click', event => {
  if (event.target === roleCollaborationModal) closeCrewCollaboration();
});
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (!roleHistoryModal?.classList.contains('hidden')) closeCrewHistory();
  if (!roleCollaborationModal?.classList.contains('hidden')) closeCrewCollaboration();
});
window.showRoleNavigationView = showRoleNavigationView;
window.showRoleHistoryView = showRoleHistoryView;
window.closeCrewHistory = closeCrewHistory;
window.openCrewCollaboration = openCrewCollaboration;
window.closeCrewCollaboration = closeCrewCollaboration;

// Compatibility boundary for existing Role navigation call sites. This is now
// a primary page transition; there is no Drawer overlay or swipe gesture.
function toggleDrawer(open) {
  if (typeof window.setPrimaryTab === 'function') {
    window.setPrimaryTab(open ? 'crew' : 'chat', { hapticFeedback: false });
    return;
  }
  drawer?.classList.toggle('hidden', !open);
  if (open) showRoleNavigationView();
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
  cancelDeferredModalDataLoad(usageModal);
  if (open) {
    usageModal.classList.remove('opacity-0', 'pointer-events-none');
    if (usageModalSubtitle) usageModalSubtitle.textContent = '準備讀取模型配額...';
    if (usageBarsContainer) usageBarsContainer.innerHTML = `<div class="text-center py-6 text-slate-400 text-xs flex flex-col items-center gap-2 font-sans"><span class="inline-block w-5 h-5 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin"></span><span>正在準備用量資料...</span></div>`;
    deferModalDataLoad(usageModal, loadUsageData);
  } else {
    usageModal.classList.add('opacity-0', 'pointer-events-none');
  }
}

async function loadUsageData(force = false) {
  if (!usageBarsContainer) return;
  const isForce = (force === true);
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
    const fetchUrl = isForce ? `${usage.endpoint}?refresh=1` : usage.endpoint;
    const res = await fetch(fetchUrl);
    const data = await res.json();

    if (data.warning && usageModalSubtitle) {
      usageModalSubtitle.textContent = `⚠️ ${data.warning}`;
    } else if (data.cached && usageModalSubtitle) {
      usageModalSubtitle.textContent = `快取配額 (${data.cacheAgeSec || 0} 秒前)`;
    }

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

function workspaceMeta(workspace = currentWorkspace) {
  return availableWorkspaces.find(item => item.path === workspace) || {
    path: workspace,
    label: workspace === HOME_WORKSPACE ? 'Home' : workspace.split('/').filter(Boolean).pop(),
    icon: workspace === HOME_WORKSPACE ? '🏠' : '📁'
  };
}

function projectMeta(projectId) {
  if (!projectId) return null;
  return availableProjects.find(item => item.id === projectId) || null;
}

function projectForWorkspace(workspace = currentWorkspace) {
  return availableProjects.find(item => item.workspace === workspace) || null;
}

function roleMeta(roleId = currentRoleId) {
  return availableRoles.find(item => item.id === roleId) || null;
}

function compactWorkspaceLabel(meta) {
  const raw = String(meta?.label || '').trim();
  if (!raw || raw === 'Home') return 'Home';
  return raw.split('/').filter(Boolean).pop() || raw;
}

function roleWorkspace(role = roleMeta()) {
  if (!role?.projectId) return currentWorkspace || HOME_WORKSPACE;
  return projectMeta(role.projectId)?.workspace || currentWorkspace || HOME_WORKSPACE;
}

function updateWorkspaceUI() {
  let role = roleMeta();
  if (!role) role = roleMeta(DEFAULT_ROLE_ID) || availableRoles[0] || null;

  if (role) {
    if (role.id !== currentRoleId) {
      currentRoleId = role.id;
      localStorage.setItem('crew_current_role', currentRoleId);
    }
    const project = projectMeta(role.projectId);
    const nextWorkspace = project?.workspace || currentWorkspace || HOME_WORKSPACE;
    if (nextWorkspace !== currentWorkspace) {
      currentWorkspace = nextWorkspace;
      localStorage.setItem('crew_current_workspace', currentWorkspace);
    }
    const projectLabel = project?.name || (role.projectId ? role.projectId : 'General');
    if (workspaceIcon) workspaceIcon.textContent = project?.icon || '🧠';
    if (workspaceLabel) workspaceLabel.textContent = role.name;
    if (headerRoleProject) headerRoleProject.textContent = projectLabel;
    const status = crewStatusForRole(role.id);
    const latest = roleLatestConversation(role.id);
    const workTitle = status?.currentWork?.title || status?.conversationTitle || latest?.title || '新工作';
    if (headerCurrentTask) headerCurrentTask.textContent = workTitle;
    if (workspaceSelectorBtn) workspaceSelectorBtn.title = `目前 Role · ${role.name} · ${projectLabel}`;
    return;
  }

  const meta = workspaceMeta();
  if (workspaceIcon) workspaceIcon.textContent = meta.icon;
  if (workspaceLabel) workspaceLabel.textContent = 'General';
  if (headerRoleProject) headerRoleProject.textContent = compactWorkspaceLabel(meta);
  if (headerCurrentTask) headerCurrentTask.textContent = '新工作';
  if (workspaceSelectorBtn) workspaceSelectorBtn.title = '目前 Role · General';
}

window.getCurrentRoleId = () => currentRoleId || DEFAULT_ROLE_ID;

window.setConversationRoleDirect = function(roleId, projectId, workspace) {
  currentRoleId = roleId || DEFAULT_ROLE_ID;
  localStorage.setItem('crew_current_role', currentRoleId);
  const project = projectMeta(projectId || roleMeta(currentRoleId)?.projectId);
  const nextWorkspace = project?.workspace || workspace;
  if (nextWorkspace) {
    currentWorkspace = nextWorkspace;
    localStorage.setItem('crew_current_workspace', currentWorkspace);
  }
  updateWorkspaceUI();
};

// Compatibility shim for older cached UI callers. Crew Member is no longer identity.
window.setConversationCrewMemberDirect = function(_memberId, workspace) {
  if (workspace) window.setConversationWorkspaceDirect(workspace);
};

window.setConversationWorkspaceDirect = function(workspace) {
  if (!workspace) return;
  currentWorkspace = workspace;
  localStorage.setItem('crew_current_workspace', currentWorkspace);
  updateWorkspaceUI();
};

async function loadWorkspaces() {
  const [workspaceResponse, projectResponse, roleResponse] = await Promise.all([
    fetch('/api/workspaces'),
    fetch('/api/projects'),
    fetch('/api/roles')
  ]);
  if (!workspaceResponse.ok) throw new Error('無法讀取工作區');
  if (!projectResponse.ok) throw new Error('無法讀取 Projects');
  if (!roleResponse.ok) throw new Error('無法讀取 Roles');

  const [workspaceData, projectData, roleData] = await Promise.all([
    workspaceResponse.json(),
    projectResponse.json(),
    roleResponse.json()
  ]);
  availableWorkspaces = Array.isArray(workspaceData.workspaces) ? workspaceData.workspaces : [];
  availableProjects = Array.isArray(projectData.projects) ? projectData.projects : [];
  availableRoles = Array.isArray(roleData.roles) ? roleData.roles : [];

  let role = roleMeta();
  if (!role) {
    const currentProject = projectForWorkspace(currentWorkspace);
    role = currentProject
      ? (availableRoles.find(item => item.projectId === currentProject.id && item.source === 'project')
        || availableRoles.find(item => item.projectId === currentProject.id))
      : null;
  }
  if (!role) role = roleMeta(DEFAULT_ROLE_ID) || availableRoles[0] || null;

  if (role) {
    currentRoleId = role.id;
    localStorage.setItem('crew_current_role', currentRoleId);
    const project = projectMeta(role.projectId);
    if (project?.workspace) {
      currentWorkspace = project.workspace;
      localStorage.setItem('crew_current_workspace', currentWorkspace);
    }
  }

  updateWorkspaceUI();
  await loadCrewStatus({ force: true }).catch(() => null);
  renderRoleNavigation();
  return availableWorkspaces;
}

function crewStatusForRole(roleId) {
  return crewStatusByRole.get(String(roleId || DEFAULT_ROLE_ID)) || null;
}

function crewStatusMeta(status) {
  const state = status?.state || 'new';
  if (state === 'working') {
    return {
      label: 'WORKING',
      dot: 'bg-emerald-400 animate-pulse',
      badge: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
      avatar: 'border-emerald-500/40 bg-emerald-500/10'
    };
  }
  if (state === 'waiting') {
    return {
      label: 'WAITING',
      dot: 'bg-amber-400 animate-pulse',
      badge: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
      avatar: 'border-amber-500/40 bg-amber-500/10'
    };
  }
  if (state === 'idle') {
    return {
      label: 'IDLE',
      dot: 'bg-slate-500',
      badge: 'border-slate-700 bg-slate-800/70 text-slate-400',
      avatar: 'border-slate-700/70 bg-slate-900'
    };
  }
  return {
    label: 'NEW',
    dot: 'bg-indigo-400',
    badge: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300',
    avatar: 'border-indigo-500/30 bg-indigo-500/10'
  };
}

async function loadCrewStatus({ force = false } = {}) {
  const freshEnough = Date.now() - crewStatusUpdatedAt < 1200;
  if (!force && freshEnough && crewStatusVerified) return crewStatusByRole;
  if (crewStatusRequest) return crewStatusRequest;

  crewStatusRequest = fetch('/api/crew-status', { cache: 'no-store' })
    .then(async response => {
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '無法讀取 Crew 狀態');
      crewStatusByRole = new Map((data.roles || []).map(status => [status.roleId, status]));
      crewStatusUpdatedAt = Number(data.generatedAt) || Date.now();
      crewStatusVerified = true;
      updateWorkspaceUI();
      renderRoleNavigation();
      window.dispatchEvent(new CustomEvent('crew:status-updated'));
      return crewStatusByRole;
    })
    .catch(error => {
      console.warn('[Crew Status] Failed:', error.message);
      crewStatusVerified = false;
      renderRoleNavigation();
      window.dispatchEvent(new CustomEvent('crew:status-updated'));
      return crewStatusByRole;
    })
    .finally(() => {
      crewStatusRequest = null;
    });
  return crewStatusRequest;
}

window.loadCrewStatus = loadCrewStatus;

async function prepareNewRoleRuntime(roleId = currentRoleId || DEFAULT_ROLE_ID) {
  const role = roleMeta(roleId);
  if (!role) return null;
  const response = await fetch('/api/role-runtime', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'prepare_new',
      role_id: role.id,
      provider: currentProvider,
      model: currentModel,
      effort: currentEffort,
      workspace: currentWorkspace
    })
  });
  const data = await response.json();
  if (!response.ok || !data.success || !data.runtime) {
    throw new Error(data.error || '無法建立 Role 新工作狀態');
  }
  const previous = crewStatusForRole(role.id) || { roleId: role.id, roleName: role.name };
  crewStatusByRole.set(role.id, {
    ...previous,
    state: 'new',
    busy: false,
    runtime: data.runtime,
    currentWork: {
      conversationId: null,
      title: '新工作',
      status: 'new',
      startedAt: Number(data.runtime.activatedAt || Date.now()),
      updatedAt: Number(data.runtime.updatedAt || Date.now())
    },
    conversationTitle: null,
    queuedMessageCount: Number(previous.queuedMessageCount || 0),
    queuedRequestCount: Number(previous.queuedRequestCount || 0),
    unreadReplyCount: Number(previous.unreadReplyCount || 0),
    attentionCount: Number(previous.attentionCount || 0),
    lastActivityAt: Number(data.runtime.updatedAt || Date.now())
  });
  crewStatusUpdatedAt = Date.now();
  updateWorkspaceUI();
  renderRoleNavigation();
  return data.runtime;
}

window.prepareNewRoleRuntime = prepareNewRoleRuntime;

function closeWorkspaceModal() {
  if (!workspaceModal) return;
  workspaceModal.classList.add('opacity-0');
  window.setTimeout(() => workspaceModal.classList.add('hidden'), 160);
}

function roleProjectLabel(role) {
  if (!role?.projectId) return 'General';
  const project = projectMeta(role.projectId);
  return project?.name || role.projectId;
}

function roleLatestConversation(roleId) {
  return window.getLatestConversationForRole?.(roleId) || null;
}

function formatRoleLastActivity(conversation) {
  if (!conversation) return '';
  const updatedAt = Number(conversation.updatedAt || 0);
  if (!updatedAt) return conversation.title || '最近工作';
  const diffMs = Math.max(0, Date.now() - updatedAt);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return '剛剛';
  if (minutes < 60) return `${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小時前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(updatedAt).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' });
}

let lastRoleRosterMarkup = null;
function renderRoleNavigation() {
  if (!roleNavList) return;
  const roles = availableRoles.length ? availableRoles : [];
  const statuses = crewStatusVerified ? roles.map(role => crewStatusForRole(role.id)).filter(Boolean) : [];
  const workingCount = statuses.filter(status => status.state === 'working').length;
  const attentionCount = statuses.reduce((sum, status) => sum + Number(status.attentionCount || 0), 0);
  if (crewRoomSummary) {
    crewRoomSummary.innerHTML = crewStatusVerified
      ? [
        '<span class="crew-summary-item" data-kind="working">' + workingCount + ' 工作中</span>',
        attentionCount ? '<span class="crew-summary-item" data-kind="attention">' + attentionCount + ' 待處理</span>' : '',
        '<span class="crew-summary-item" data-kind="roles">' + roles.length + ' 位成員</span>'
      ].filter(Boolean).join('')
      : '<span class="crew-summary-item" data-kind="roles">' + roles.length +
        ' 位成員</span><span>Runtime 狀態尚未同步</span>';
  }

  const stateName = state => ({
    working: '工作中', waiting: '等待處理', idle: '待命', new: '新工作', unknown: '狀態未知'
  })[state] || '狀態未知';

  const markup = roles.length ? roles.map(role => {
    const selected = role.id === (currentRoleId || DEFAULT_ROLE_ID);
    const project = projectMeta(role.projectId);
    const latest = roleLatestConversation(role.id);
    const status = crewStatusVerified ? crewStatusForRole(role.id) : null;
    const state = status ? String(status.state || 'unknown') : 'unknown';
    const title = status?.currentWork?.title || status?.conversationTitle || latest?.title || '';
    const hasWork = Boolean(title);
    const queued = Number(status?.queuedMessageCount || 0) + Number(status?.queuedRequestCount || 0);
    const unread = Number(status?.unreadReplyCount || 0);
    const attention = queued + unread;
    return '<article class="role-nav-card" data-role-card-id="' + escapeHtml(role.id) +
      '" data-selected="' + selected + '">' +
      '<button type="button" data-role-nav-id="' + escapeHtml(role.id) +
        '" aria-label="進入 ' + escapeHtml(role.name) + ' 的目前對話">' +
        '<span class="crew-role-avatar">' + escapeHtml(project?.icon || '🧠') +
          '<span class="crew-role-dot" data-state="' + escapeHtml(state) +
          '" aria-hidden="true"></span></span>' +
        '<span class="crew-role-name">' + escapeHtml(role.name) + '</span>' +
        '<span class="crew-role-state" data-state="' + escapeHtml(state) + '">' +
          escapeHtml(stateName(state)) + '</span>' +
        '<span class="crew-role-work">' + (hasWork ? escapeHtml(title) : '尚無工作') + '</span>' +
      '</button>' +
      (attention ? '<span class="crew-role-attention" aria-label="' + attention + ' 則待處理">' +
        attention + '</span>' : '') +
      '<button type="button" data-role-menu-btn="' + escapeHtml(role.id) +
        '" aria-label="管理 ' + escapeHtml(role.name) + '" title="角色管理"><span aria-hidden="true">⋯</span></button>' +
    '</article>';
  }).join('') : '<div class="crew-roster-loading">尚未建立 AI 角色。點擊右上角＋新增。</div>';

  // SSE may repeat the same status. Preserve DOM, scroll anchor and touch focus.
  if (markup === lastRoleRosterMarkup) return;
  lastRoleRosterMarkup = markup;
  const focusedRole = document.activeElement?.dataset?.roleNavId;
  const focusedMenu = document.activeElement?.dataset?.roleMenuBtn;
  roleNavList.innerHTML = markup;
  if (focusedRole || focusedMenu) {
    const target = [...roleNavList.querySelectorAll('[data-role-nav-id], [data-role-menu-btn]')]
      .find(button => (focusedRole && button.dataset.roleNavId === focusedRole)
        || (focusedMenu && button.dataset.roleMenuBtn === focusedMenu));
    target?.focus?.({ preventScroll: true });
  }
  window.dispatchEvent(new CustomEvent('crew:roster-updated'));
}

// Delegation is stable across roster refreshes and avoids duplicating handlers.
roleNavList?.addEventListener('click', event => {
  const menu = event.target.closest('[data-role-menu-btn]');
  if (menu) { openCrewRoleDetail(menu.dataset.roleMenuBtn); return; }
  const role = event.target.closest('[data-role-nav-id]');
  if (role) selectRole(role.dataset.roleNavId);
});

const crewRoleDetailModal = document.getElementById('crew-role-detail-modal');
const crewRoleDetailName = document.getElementById('crew-role-detail-name');
const crewRoleDetailStatus = document.getElementById('crew-role-detail-status');
let crewRoleDetailId = null;
let crewRoleDetailReturnFocus = null;
function closeCrewRoleDetail({ handoff = false, fromHistory = false } = {}) {
  if (!crewRoleDetailModal || crewRoleDetailModal.classList.contains('hidden')) return;
  crewRoleDetailModal.classList.add('hidden');
  if (!handoff && !fromHistory) window.CrewNavigation?.closeOverlay('role-detail');
  const previousFocus = crewRoleDetailReturnFocus;
  crewRoleDetailId = null;
  crewRoleDetailReturnFocus = null;
  previousFocus?.focus?.({ preventScroll: true });
}
function openCrewRoleDetail(roleId) {
  const role = roleMeta(roleId);
  if (!role || !crewRoleDetailModal) return;
  crewRoleDetailId = role.id;
  crewRoleDetailReturnFocus = document.activeElement;
  const status = crewStatusVerified ? crewStatusForRole(role.id) : null;
  const state = status?.state === 'working' ? '工作中'
    : status?.state === 'waiting' ? '等待處理'
    : status?.state === 'idle' ? '待命'
    : status?.state === 'new' ? '新工作' : '狀態未知';
  if (crewRoleDetailName) crewRoleDetailName.textContent = role.name;
  if (crewRoleDetailStatus) crewRoleDetailStatus.textContent =
    roleProjectLabel(role) + ' · ' + state;
  crewRoleDetailModal.classList.remove('hidden');
  window.CrewNavigation?.openOverlay('role-detail');
  document.getElementById('crew-role-detail-close')?.focus({ preventScroll: true });
}
crewRoleDetailModal?.addEventListener('click', async event => {
  if (event.target === crewRoleDetailModal ||
      event.target.closest('#crew-role-detail-close')) {
    closeCrewRoleDetail(); return;
  }
  const action = event.target.closest('[data-crew-role-detail-action]');
  if (!action || !crewRoleDetailId) return;
  const roleId = crewRoleDetailId;
  const role = roleMeta(roleId);
  closeCrewRoleDetail({ handoff: true });
  if (!role) {
    window.CrewNavigation?.dropOverlay('role-detail');
    return;
  }
  switch (action.dataset.crewRoleDetailAction) {
    case 'new-work':
      window.CrewNavigation?.dropOverlay('role-detail');
      return selectRole(roleId, true);
    case 'history': return showRoleHistoryView(roleId);
    case 'memory': return openRoleMemory(roleId);
    case 'settings': return openRoleEditor(roleId);
    case 'collaboration': return openCrewCollaboration(roleId);
  }
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && crewRoleDetailId) closeCrewRoleDetail();
});
window.openCrewRoleDetail = openCrewRoleDetail;

window.renderRoleNavigation = renderRoleNavigation;

window.getCrewCockpitSnapshot = () => ({
  verified: crewStatusVerified,
  updatedAt: crewStatusVerified ? crewStatusUpdatedAt : 0,
  activeRoleId: currentRoleId || DEFAULT_ROLE_ID,
  roles: availableRoles.map(role => {
    const project = projectMeta(role.projectId);
    const latest = roleLatestConversation(role.id);
    return {
      id: role.id,
      name: role.name,
      project: roleProjectLabel(role),
      icon: project?.icon || '🧠',
      latestTitle: latest?.title || '',
      latestUpdatedAt: latest?.updatedAt || 0,
      status: crewStatusVerified ? crewStatusForRole(role.id) : null
    };
  })
});
window.openCrewCockpitRole = (roleId, newWork = false) => selectRole(roleId, newWork);

const crewStatusEvents = new EventSource('/api/crew-status/events');
crewStatusEvents.addEventListener('crew-status', () => {
  crewStatusUpdatedAt = 0;
  loadCrewStatus({ force: true }).catch(() => {});
});
crewStatusEvents.addEventListener('error', () => {
  // Connection status is not proof of current agent state. Clear trusted status
  // until a fresh API response arrives instead of displaying stale live counts.
  crewStatusVerified = false;
  crewStatusUpdatedAt = 0;
  renderRoleNavigation();
  window.dispatchEvent(new CustomEvent('crew:status-updated'));
  console.warn('[Crew Status] Event stream disconnected; browser will reconnect automatically.');
});
document.addEventListener('visibilitychange', () => {
  // Android WebView may suspend SSE while the app is in the background.
  if (!document.hidden && window.getPrimaryTab?.() === 'crew') {
    loadCrewStatus({ force: true }).catch(() => {});
  }
});
window.addEventListener('crew:streaming-state', () => {
  crewStatusUpdatedAt = 0;
  loadCrewStatus({ force: true }).catch(() => {});
});

const roleModalCloseTimers = new WeakMap();
function toggleRoleModal(modal, open, { fromHistory = false, handoff = false } = {}) {
  if (!modal) return;
  const wasHidden = modal.classList.contains('hidden');
  const pendingClose = roleModalCloseTimers.get(modal);
  if (pendingClose) window.clearTimeout(pendingClose);
  roleModalCloseTimers.delete(modal);
  if (open) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    if (wasHidden) window.CrewNavigation?.openOverlay(modal.id);
    requestAnimationFrame(() => {
      if (!modal.classList.contains('hidden') && !roleModalCloseTimers.has(modal)) {
        modal.classList.remove('opacity-0');
      }
    });
  } else {
    if (!fromHistory && !handoff && !wasHidden) window.CrewNavigation?.closeOverlay(modal.id);
    if (handoff) window.CrewNavigation?.dropOverlay(modal.id);
    modal.classList.add('opacity-0');
    roleModalCloseTimers.set(modal, window.setTimeout(() => {
      roleModalCloseTimers.delete(modal);
      modal.classList.add('hidden');
      modal.classList.remove('flex');
    }, 150));
  }
}
// Native Android Back calls WebView.goBack(); close any sheets not belonging to
// the restored history entry, without adding another history transition.
window.addEventListener('crew:navigation-popstate', event => {
  const active = event.detail?.overlay || null;
  if (active !== 'role-detail' && crewRoleDetailId) {
    closeCrewRoleDetail({ fromHistory: true });
  }
  for (const modal of [roleHistoryModal, roleCollaborationModal,
    roleMemoryModal, roleEditorModal, roleDeleteModal]) {
    if (modal && modal.id !== active && !modal.classList.contains('hidden')) {
      if (modal === roleHistoryModal) historyRoleId = null;
      if (modal === roleCollaborationModal) window.CrewMissionGraph?.close?.();
      if (modal === roleMemoryModal) window.RoleMemoryXRay?.close?.();
      toggleRoleModal(modal, false, { fromHistory: true });
    }
  }
});

function updateRoleEditorWorkspace(projectId = '') {
  if (!roleEditorWorkspace) return;
  const project = projectMeta(projectId);
  const workspace = project?.workspace || '';
  roleEditorWorkspace.textContent = workspace ? `工作目錄：${workspace}` : '工作目錄：—';
  roleEditorWorkspace.title = workspace || '';
}

function renderRoleProjectOptions(selectedProjectId = '') {
  if (!roleEditorProject) return;
  roleEditorProject.innerHTML = [
    '<option value="">General / 不綁定專案</option>',
    ...availableProjects
      .filter(project => String(project.name || '').toLowerCase() !== 'general')
      .map(project => `<option value="${escapeHtml(project.id)}">${escapeHtml(project.name || project.id)}</option>`)
  ].join('');
  roleEditorProject.value = selectedProjectId || '';
  updateRoleEditorWorkspace(roleEditorProject.value);
}

let roleDeleteTarget = null;

function openRoleEditor(roleId = '') {
  const role = roleId ? roleMeta(roleId) : null;
  if (roleEditorTitle) roleEditorTitle.textContent = role ? 'Role 設定' : '新增 Role';
  const roleSubmit = document.getElementById('save-role-btn');
  if (roleSubmit) roleSubmit.textContent = role ? '儲存變更' : '建立 Role';
  if (roleEditorId) roleEditorId.value = role?.id || '';
  if (roleEditorName) roleEditorName.value = role?.name || '';
  if (roleEditorDescription) roleEditorDescription.value = role?.description || '';
  if (roleEditorSkills) roleEditorSkills.value = Array.isArray(role?.skills) ? role.skills.join(', ') : '';
  if (roleEditorSystemContext) roleEditorSystemContext.value = role?.systemContext || '';
  renderRoleProjectOptions(role?.projectId || '');

  if (roleDangerZone) roleDangerZone.classList.toggle('hidden', !role);
  if (role && roleDangerCopy) {
    roleDangerCopy.textContent = role.id === DEFAULT_ROLE_ID
      ? 'General 是預設 Role，負責 fallback 與舊資料相容，因此無法刪除。'
      : '永久刪除這個 Role 與它的 Role Memory。Project、專案檔案與已完成工作歷史會保留。';
  }
  if (deleteRoleBtn) {
    const protectedRole = role?.id === DEFAULT_ROLE_ID;
    deleteRoleBtn.classList.toggle('hidden', !role || protectedRole);
    deleteRoleBtn.disabled = !role || protectedRole;
  }

  toggleRoleModal(roleEditorModal, true);
  window.setTimeout(() => roleEditorName?.focus(), 80);
}

function closeRoleEditor() {
  toggleRoleModal(roleEditorModal, false);
}

function closeRoleDeleteModal() {
  roleDeleteTarget = null;
  toggleRoleModal(roleDeleteModal, false);
}

function openRoleDeleteModal(roleId) {
  const role = roleMeta(roleId);
  if (!role || role.id === DEFAULT_ROLE_ID) return;
  roleDeleteTarget = role;
  if (roleDeleteName) roleDeleteName.textContent = role.name;
  toggleRoleModal(roleDeleteModal, true);
}

async function confirmRoleDelete() {
  const role = roleDeleteTarget;
  if (!role) return;
  const wasCurrent = role.id === currentRoleId;
  const originalText = confirmRoleDeleteBtn?.textContent || '刪除 Role';

  if (confirmRoleDeleteBtn) {
    confirmRoleDeleteBtn.disabled = true;
    confirmRoleDeleteBtn.textContent = '刪除中…';
    confirmRoleDeleteBtn.classList.add('opacity-60');
  }

  try {
    const response = await fetch(`/api/roles?id=${encodeURIComponent(role.id)}`, {
      method: 'DELETE'
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '刪除 Role 失敗');

    closeRoleDeleteModal();
    closeRoleEditor();

    if (typeof window.clearActiveRoleStream === 'function') {
      window.clearActiveRoleStream(role.id);
    }

    if (wasCurrent) {
      currentRoleId = DEFAULT_ROLE_ID;
      localStorage.setItem('crew_current_role', DEFAULT_ROLE_ID);
      if (typeof window.syncActiveRoleStreamingState === 'function') {
        window.syncActiveRoleStreamingState();
      }
    }

    await loadWorkspaces();

    if (wasCurrent) {
      await selectRole(DEFAULT_ROLE_ID, true);
    } else {
      renderRoleNavigation();
    }
  } catch (error) {
    alert(error.message || '刪除 Role 失敗');
  } finally {
    if (confirmRoleDeleteBtn) {
      confirmRoleDeleteBtn.disabled = false;
      confirmRoleDeleteBtn.textContent = originalText;
      confirmRoleDeleteBtn.classList.remove('opacity-60');
    }
  }
}

async function saveRoleEditor(event) {
  event?.preventDefault();
  const id = roleEditorId?.value?.trim() || '';
  const payload = {
    ...(id ? { id } : {}),
    name: roleEditorName?.value?.trim() || '',
    projectId: roleEditorProject?.value || null,
    description: roleEditorDescription?.value?.trim() || '',
    skills: String(roleEditorSkills?.value || '').split(',').map(item => item.trim()).filter(Boolean),
    systemContext: roleEditorSystemContext?.value?.trim() || ''
  };
  if (!payload.name) return alert('請輸入 Role 名稱');

  const submit = document.getElementById('save-role-btn');
  if (submit) {
    submit.disabled = true;
    submit.textContent = '儲存中…';
  }
  try {
    const response = await fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    if (!response.ok || !data.success || !data.role) throw new Error(data.error || '儲存 Role 失敗');
    const created = !id;
    await loadWorkspaces();
    closeRoleEditor();
    if (created) {
      await selectRole(data.role.id, true);
    } else {
      if (data.role.id === currentRoleId) activateRoleIdentity(data.role);
      renderRoleNavigation();
    }
  } catch (error) {
    alert(error.message || '儲存 Role 失敗');
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = '儲存變更';
    }
  }
}

async function openRoleMemory(roleId) {
  const role = roleMeta(roleId);
  if (!role) return;
  if (roleMemoryTitle) roleMemoryTitle.textContent = `${role.name} · Memory X-Ray`;
  if (roleMemorySubtitle) roleMemorySubtitle.textContent = '只檢視此 Role 的記憶來源、生命週期與已記錄的版本。';
  toggleRoleModal(roleMemoryModal, true);
  window.RoleMemoryXRay?.open({ id: role.id, name: role.name });
}

window.openRoleEditor = openRoleEditor;
window.openRoleMemory = openRoleMemory;

if (roleEditorProject) roleEditorProject.addEventListener('change', () => updateRoleEditorWorkspace(roleEditorProject.value));
if (drawerNewRoleBtn) drawerNewRoleBtn.addEventListener('click', () => openRoleEditor());
if (closeRoleEditorBtn) closeRoleEditorBtn.addEventListener('click', closeRoleEditor);
if (cancelRoleEditorBtn) cancelRoleEditorBtn.addEventListener('click', closeRoleEditor);
if (deleteRoleBtn) deleteRoleBtn.addEventListener('click', () => openRoleDeleteModal(roleEditorId?.value || ''));
if (closeRoleDeleteBtn) closeRoleDeleteBtn.addEventListener('click', closeRoleDeleteModal);
if (cancelRoleDeleteBtn) cancelRoleDeleteBtn.addEventListener('click', closeRoleDeleteModal);
if (confirmRoleDeleteBtn) confirmRoleDeleteBtn.addEventListener('click', confirmRoleDelete);
if (roleDeleteModal) roleDeleteModal.addEventListener('click', event => {
  if (event.target === roleDeleteModal) closeRoleDeleteModal();
});
if (roleEditorForm) roleEditorForm.addEventListener('submit', saveRoleEditor);
if (roleEditorModal) roleEditorModal.addEventListener('click', event => {
  if (event.target === roleEditorModal) closeRoleEditor();
});
if (closeRoleMemoryBtn) closeRoleMemoryBtn.addEventListener('click', () => toggleRoleModal(roleMemoryModal, false));
if (roleMemoryModal) roleMemoryModal.addEventListener('click', event => {
  if (event.target === roleMemoryModal) toggleRoleModal(roleMemoryModal, false);
});

function renderWorkspaceOptions() {
  if (!workspaceOptions) return;
  workspaceOptions.innerHTML = availableRoles.map(role => {
    const active = role.id === (currentRoleId || DEFAULT_ROLE_ID);
    const project = projectMeta(role.projectId);
    const projectLabel = roleProjectLabel(role);
    return `<button type="button" data-role-id="${escapeHtml(role.id)}" class="role-option w-full flex items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99] ${active ? 'border-teal-400/70 bg-teal-500/15' : 'border-slate-800 bg-slate-950/70 hover:border-slate-700 hover:bg-slate-800'}">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-700/70 bg-slate-900 text-xl">${escapeHtml(project?.icon || '🧠')}</span>
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2"><span class="truncate text-xs font-bold text-slate-100">${escapeHtml(role.name)}</span><span class="shrink-0 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] text-indigo-300">Role</span></span>
        <span class="block truncate pt-1 text-[10px] text-slate-400">專案：${escapeHtml(projectLabel)}</span>
        ${role.description ? `<span class="block truncate pt-0.5 text-[9px] text-slate-500">${escapeHtml(role.description)}</span>` : ''}
      </span>
      ${active ? '<span class="text-xs font-bold text-teal-300">✓</span>' : ''}
    </button>`;
  }).join('') || '<div class="p-5 text-center text-xs text-slate-400">尚未找到 Role。</div>';

  workspaceOptions.querySelectorAll('.role-option').forEach(button => {
    button.addEventListener('click', () => selectRole(button.dataset.roleId));
  });
}

function activateRoleIdentity(role) {
  if (!role) return null;
  currentRoleId = role.id;
  localStorage.setItem('crew_current_role', currentRoleId);
  window.dispatchEvent(new CustomEvent('crew:role-selected'));

  const project = projectMeta(role.projectId);
  if (project?.workspace) {
    currentWorkspace = project.workspace;
    localStorage.setItem('crew_current_workspace', currentWorkspace);
  }

  updateWorkspaceUI();
  renderRoleNavigation();
  if (typeof window.syncActiveRoleStreamingState === 'function') {
    window.syncActiveRoleStreamingState();
  }
  if (typeof window.hydrateRoleMessageQueue === 'function') {
    window.hydrateRoleMessageQueue(role.id, { force: true }).then(() => {
      window.syncActiveRoleStreamingState?.();
    }).catch(() => {});
  }
  return role;
}

async function selectRole(roleId, isCreatingNewChat = false) {
  if (!roleId) return closeWorkspaceModal();
  const role = roleMeta(roleId);
  if (!role) return alert('找不到這個 Role。');

  let restorePendingNew = false;

  if (!isCreatingNewChat) {
    try {
      await loadCrewStatus({ force: true });
      const status = crewStatusForRole(role.id);
      const runtime = status?.runtime || null;

      if (runtime?.pendingNew && !runtime.conversationId) {
        restorePendingNew = true;
        activateRoleIdentity(role);
      } else if (
        runtime?.conversationId &&
        runtime?.providerId &&
        window.openCrewConversation
      ) {
        activateRoleIdentity(role);
        closeWorkspaceModal();
        if (typeof toggleDrawer === 'function') toggleDrawer(false);

        if (
          roleId === currentRoleId &&
          currentConversationId === runtime.conversationId &&
          currentProvider === runtime.providerId
        ) {
          return;
        }

        await window.openCrewConversation(runtime.providerId, runtime.conversationId);
        return;
      }

      if (!restorePendingNew && currentConversationId && roleId === currentRoleId) {
        closeWorkspaceModal();
        if (typeof toggleDrawer === 'function') toggleDrawer(false);
        return;
      }

      if (!restorePendingNew) {
        activateRoleIdentity(role);
        if (typeof loadConversations === 'function') await loadConversations({ force: true });
        const latest = roleLatestConversation(role.id);
        if (latest && window.openCrewConversation) {
          closeWorkspaceModal();
          if (typeof toggleDrawer === 'function') toggleDrawer(false);
          await window.openCrewConversation(latest.provider, latest.id);
          return;
        }
      }
    } catch (error) {
      console.warn('[Role Navigation] Failed to restore current work:', error);
    }
  }

  activateRoleIdentity(role);

  if (isCreatingNewChat) {
    try {
      await prepareNewRoleRuntime(role.id);
    } catch (error) {
      console.warn('[Role Runtime] Failed to prepare new work:', error.message);
    }
  }

  // A Role owns durable identity/memory. A fresh Conversation is created only
  // when this Role has no current/prior work or the user explicitly asks for New Work.
  currentConversationId = null;
  localStorage.setItem(activeConversationStorageKey(), '__new__');

  if (typeof revokeAllBlobUrls === 'function') revokeAllBlobUrls();
  if (typeof clearQueuedBtwMessages === 'function') await clearQueuedBtwMessages();
  if (typeof updateContextPill === 'function') updateContextPill(null);
  if (promptInput) {
    promptInput.value = '';
    promptInput.style.height = 'auto';
  }
  uploadedImagePath = null;
  if (cameraInput) cameraInput.value = '';
  if (typeof attachInput !== 'undefined' && attachInput) attachInput.value = '';
  if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');

  if (headerTitle) headerTitle.textContent = '新工作';
  if (messagesContainer) {
    messagesContainer.innerHTML = '';
    if (typeof appendMessage === 'function') {
      const projectLine = role.projectId ? `\n\n專案：${roleProjectLabel(role)}` : '';
      appendMessage('assistant', `🧠 ${role.name} 已就位。${projectLine}\n\n這是一段新的工作 Context；Role 的長期記憶仍會保留。`);
    }
  }

  closeWorkspaceModal();
  showRoleNavigationView();
  if (typeof toggleDrawer === 'function') toggleDrawer(false);
  window.requestProviderPrewarm?.(0);
}

async function selectWorkspace(workspace, isCreatingNewChat = false) {
  if (!workspace) return closeWorkspaceModal();
  const project = projectForWorkspace(workspace);
  const role = project
    ? (availableRoles.find(item => item.projectId === project.id && item.source === 'project')
      || availableRoles.find(item => item.projectId === project.id))
    : null;
  if (role) return selectRole(role.id, isCreatingNewChat);
  currentWorkspace = workspace;
  localStorage.setItem('crew_current_workspace', currentWorkspace);
  updateWorkspaceUI();
  closeWorkspaceModal();
}

async function handleCreateWorkspaceSubmit(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('create-workspace-input');
  const name = input ? input.value.trim() : '';
  if (!name) return alert('請輸入欲建立的專案目錄名稱');

  try {
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || '建立專案失敗');

    if (input) input.value = '';
    await loadWorkspaces();
    renderWorkspaceOptions();
    await selectWorkspace(data.workspace.path, true);
  } catch (err) {
    alert(err.message || '建立專案出錯');
  }
}

window.openWorkspacePicker = async function() {
  if (!workspaceModal) return;
  workspaceModal.classList.remove('hidden');
  requestAnimationFrame(() => workspaceModal.classList.remove('opacity-0'));
  if (workspaceOptions) workspaceOptions.innerHTML = '<div class="p-5 text-center text-xs text-slate-400">載入 Roles 中…</div>';

  const form = document.getElementById('create-workspace-form');
  if (form && !form.dataset.bound) {
    form.dataset.bound = 'true';
    form.addEventListener('submit', handleCreateWorkspaceSubmit);
  }

  try {
    await loadWorkspaces();
    renderWorkspaceOptions();
  } catch (error) {
    if (workspaceOptions) workspaceOptions.innerHTML = `<div class="p-5 text-center text-xs text-rose-300">${escapeHtml(error.message)}</div>`;
  }
};
window.closeWorkspacePicker = closeWorkspaceModal;

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
  const providerSection = document.getElementById('provider-section');
  if (providerSection) {
    providerSection.style.display = availableProviders.length <= 1 ? 'none' : 'block';
  }
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

window.selectProvider = async function(providerId, { preserveActiveStream = false } = {}) {
  if (!availableProviders.some(provider => provider.id === providerId) || providerId === currentProvider) return;
  if (isStreaming && !preserveActiveStream && typeof window.stopGeneration === 'function') {
    await window.stopGeneration();
  }
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
    const activeRoleName = roleMeta()?.name || '';
    appendMessage('assistant', activeRoleName
      ? `🧠 ${activeRoleName} 已切換 Provider；目前是新的工作 Context。`
      : (providerConfig().greeting || '已開啟新的工作 Context。'));
    if (headerTitle) headerTitle.textContent = '新工作';
  }
  loadConversations();
  window.requestProviderPrewarm();
};

window.openCrewConversation = async function(providerId, conversationId) {
  const targetProvider = String(providerId || '').trim() || currentProvider;
  const targetConversationId = String(conversationId || '').trim();
  if (!targetConversationId) return false;

  if (!availableProviders.some(provider => provider.id === targetProvider)) {
    await loadProviderCatalog();
  }
  if (!availableProviders.some(provider => provider.id === targetProvider)) return false;

  // Seed the target provider's active conversation before switching providers.
  // selectProvider() can then restore the exact thread without briefly opening
  // whatever that provider last had active.
  localStorage.setItem(providerStorageKey('active_conv_id', targetProvider), targetConversationId);

  if (targetProvider !== currentProvider) {
    await window.selectProvider(targetProvider, { preserveActiveStream: true });
  } else if (currentConversationId !== targetConversationId) {
    await loadConversationHistory(targetConversationId);
  } else {
    await loadConversationHistory(targetConversationId, { preserveComposer: true });
  }

  return currentProvider === targetProvider && currentConversationId === targetConversationId;
};

window.openCrewTaskResult = async function(providerId, conversationId, taskId) {
  const opened = await window.openCrewConversation(providerId, conversationId);
  if (!opened) return false;
  const cleanTaskId = String(taskId || '').trim();
  if (cleanTaskId && typeof window.showTaskBriefingBanner === 'function') {
    await window.showTaskBriefingBanner(cleanTaskId);
  }
  return true;
};

// Model & Thinking Effort Handlers
function compactModelLabel(label) {
  return String(label || '')
    .replace(/\s+(?:Flash|Preview|Latest)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function updateModelUI() {
  if (!currentModel) {
    if (modelBadgeIcon) modelBadgeIcon.textContent = '⌛';
    if (modelDisplayName) modelDisplayName.textContent = '載入對話模型…';
    return;
  }
  const found = availableModels.find(m => m.id === currentModel);
  if (found) {
    if (modelBadgeIcon) modelBadgeIcon.textContent = found.icon;
    if (modelDisplayName) modelDisplayName.textContent = compactModelLabel(found.name);
  } else {
    if (modelBadgeIcon) modelBadgeIcon.textContent = '✨';
    if (modelDisplayName) modelDisplayName.textContent = compactModelLabel(currentModel.replace('gemini-', 'Gemini ').replace('claude-', 'Claude '));
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
  if (!settings) return false;
  if (settings.provider && settings.provider !== currentProvider) {
    currentProvider = settings.provider;
    localStorage.setItem('crew_current_provider', currentProvider);
    renderProviderOptions();
  }
  const roleId = settings.roleId || settings.role_id || DEFAULT_ROLE_ID;
  currentRoleId = roleId;
  localStorage.setItem('crew_current_role', currentRoleId);
  if (settings.workspace) {
    currentWorkspace = settings.workspace;
    localStorage.setItem('crew_current_workspace', currentWorkspace);
  }
  updateWorkspaceUI();
  const providerModels = availableModels.filter(model => (model.provider || 'antigravity') === currentProvider);
  if (!settings.model && settings.loadingModel) {
    currentModel = null;
    updateModelUI();
    return true;
  }
  if (!settings.model) return true;
  const selected = providerModels.find(model => model.id === settings.model);
  const modelToApply = selected;
  if (modelToApply) {
    currentModel = modelToApply.id;
    const supported = modelToApply.supportedReasoningEfforts || ['low', 'medium', 'high'];
    currentEffort = supported.includes(settings.effort)
      ? settings.effort
      : (modelToApply.defaultReasoningEffort || supported[0] || 'low');
    localStorage.setItem(providerStorageKey('current_model'), currentModel);
    localStorage.setItem(providerStorageKey('current_effort'), currentEffort);
    updateModelUI();
    updateEffortUI();
  } else {
    // The model catalog can still be loading while history is restored. Keep
    // the conversation's persisted model visible and send it on the next turn
    // instead of briefly falling back to another provider's default.
    currentModel = String(settings.model);
    currentEffort = String(settings.effort || 'low');
    localStorage.setItem(providerStorageKey('current_model'), currentModel);
    localStorage.setItem(providerStorageKey('current_effort'), currentEffort);
    updateModelUI();
    updateEffortUI();
  }
  return true;
};

window.saveCurrentConversationSettings = function(overrides = {}) {
  if (!currentConversationId) return Promise.resolve(null);
  const payload = {
    provider: currentProvider,
    conversation_id: currentConversationId,
    model: overrides.model !== undefined ? overrides.model : currentModel,
    effort: overrides.effort !== undefined ? overrides.effort : currentEffort,
    workspace: overrides.workspace !== undefined ? overrides.workspace : currentWorkspace,
    role_id: overrides.roleId !== undefined ? overrides.roleId : (currentRoleId || DEFAULT_ROLE_ID),
    role: 'general'
  };
  return fetch('/api/conversation-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
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
    if (typeof window.syncCodexWarmup === 'function') window.syncCodexWarmup();
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
  window.saveCurrentConversationSettings({ model: currentModel, effort: currentEffort });
  window.requestProviderPrewarm();
};

window.selectEffort = function(effortId) {
  currentEffort = effortId;
  localStorage.setItem(providerStorageKey('current_effort'), currentEffort);
  updateEffortUI();
  renderEffortOptions();
  if (navigator.vibrate) navigator.vibrate(20);
  console.log(`🧠 已切換思考強度至: ${currentEffort}`);
  window.saveCurrentConversationSettings({ effort: currentEffort });
  window.requestProviderPrewarm();
};

// Push Notification Helpers
async function triggerDoneNotification(text) {
  if (!notificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted') return;

  // Android expands Web Notifications into a multi-line card. Keep the full
  // readable reply here; the browser itself applies its platform safety limit.
  const cleanReply = (text || '回覆已完成')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[*#_~`]/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 3500);

  const notifOptions = {
    body: cleanReply || '回覆已生成完畢！',
    tag: 'agy-done',
    renotify: true,
    vibrate: [200, 100, 200]
  };

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
let pendingExplorerTransfer = null;
let currentPreviewFullPath = '';
let currentPreviewFileName = '';
const FILE_SWIPE_REVEAL_PX = 88;
const modalDataLoadTimers = new WeakMap();

// Shared loader for data-heavy dialogs. Render the lightweight loading state,
// let the opening frame finish, then run scans/fetches without stuttering the
// modal animation. Closing a dialog cancels work that has not started yet.
function deferModalDataLoad(modal, loader, delay = 220) {
  if (!modal || typeof loader !== 'function') return;
  cancelDeferredModalDataLoad(modal);
  const timer = window.setTimeout(async () => {
    modalDataLoadTimers.delete(modal);
    if (modal.classList.contains('opacity-0') || modal.classList.contains('hidden')) return;
    try {
      await loader();
    } catch (err) {
      console.error('[Modal data load] failed:', err);
    }
  }, delay);
  modalDataLoadTimers.set(modal, timer);
}

function cancelDeferredModalDataLoad(modal) {
  const timer = modal && modalDataLoadTimers.get(modal);
  if (timer) window.clearTimeout(timer);
  if (modal) modalDataLoadTimers.delete(modal);
}

window.deferModalDataLoad = deferModalDataLoad;
window.cancelDeferredModalDataLoad = cancelDeferredModalDataLoad;

function toggleFilesModal(open) {
  if (!filesModal) return;
  cancelDeferredModalDataLoad(filesModal);
  if (open) {
    filesModal.classList.remove('opacity-0', 'pointer-events-none');
    renderFilesLoading();
    // Let the 200ms modal fade paint first. Directory parsing and DOM creation
    // can otherwise starve the exact frame that is opening the dialog.
    deferModalDataLoad(filesModal, () => loadDirectory(currentExplorerPath, false));
  } else {
    filesModal.classList.add('opacity-0', 'pointer-events-none');
  }
}

function renderFilesLoading() {
  if (!filesListContainer) return;
  filesListContainer.innerHTML = `
    <div class="text-center py-6 text-slate-400 text-xs flex flex-col items-center gap-2 font-sans">
      <span class="inline-block w-4 h-4 rounded-full border-2 border-emerald-400 border-t-transparent animate-spin"></span>
      <span>正在讀取目錄內容...</span>
    </div>
  `;
}

async function loadDirectory(relPath = '', showLoading = true) {
  if (!filesListContainer) return;
  currentExplorerPath = relPath;
  if (filePreviewPane) filePreviewPane.classList.add('hidden');
  if (showLoading) renderFilesLoading();

  try {
    const res = await fetch(`/api/files?path=${encodeURIComponent(relPath)}`);
    const data = await res.json();
    if (!data.success) {
      filesListContainer.innerHTML = `<div class="p-3 text-rose-400 text-xs font-mono">讀取失敗：${escapeHtml(data.error)}</div>`;
      return;
    }

    if (filesBasePath) filesBasePath.textContent = `~/${data.currentPath || ''}`;
    if (filesCountBadge) filesCountBadge.textContent = `${data.entries ? data.entries.length : 0} 個項目`;
    renderExplorerTransferBar();
    const selectedCount = filesListContainer.querySelectorAll('.file-bulk-select:checked').length;

    // Render Breadcrumbs
    renderBreadcrumbs(data.currentPath);

    if (!data.entries || data.entries.length === 0) {
      filesListContainer.innerHTML = `
        <div class="p-6 text-center text-slate-500 font-sans">此資料夾為空</div>
      `;
      return;
    }

    let itemsHtml = `<div class="flex items-center justify-between gap-2 mb-2 px-1"><span class="text-[10px] text-slate-500">可勾選多個檔案或資料夾</span><button type="button" class="file-bulk-delete min-h-9 px-2 rounded-lg bg-rose-700/80 text-white text-[10px] font-bold disabled:opacity-40" ${selectedCount ? '' : 'disabled'}>刪除選取 <span class="file-bulk-count">${selectedCount}</span></button></div>`;

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
      const bulkSelect = `<input type="checkbox" class="file-bulk-select accent-rose-500 w-4 h-4 shrink-0" data-file-path="${safeRelPath}" data-file-name="${safeName}" data-file-directory="${item.isDirectory}" aria-label="選取 ${escapeHtml(item.name)}" onclick="event.stopPropagation()">`;
      const actionButton = `<button type="button" class="file-transfer-action min-w-10 min-h-10 rounded-lg bg-slate-800 text-slate-300 active:bg-slate-700 text-base" data-file-path="${safeRelPath}" data-file-name="${safeName}" data-file-directory="${item.isDirectory}" title="複製或移動">⋮</button>`;
      if (item.isDirectory) {
        itemsHtml += `
          <div class="file-swipe-row relative overflow-hidden rounded-xl" data-file-path="${safeRelPath}">
            ${deleteAction}
            <div class="file-swipe-content relative p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800/80 transition flex items-center justify-between cursor-pointer group select-none touch-pan-y" onclick="loadDirectory('${escapeHtml(item.relPath)}')">
              <div class="flex items-center gap-2 min-w-0">${bulkSelect}
                <span class="text-base shrink-0">${item.icon}</span>
                <div class="min-w-0"><div class="font-bold text-slate-200 font-mono truncate">${escapeHtml(item.name)}/</div><div class="text-[10px] text-slate-500 font-mono">${item.sizeFormatted || '計算大小中…'}</div></div>
              </div>
              <div class="flex items-center gap-1"><span class="text-[10px] text-slate-500 font-mono group-hover:text-emerald-400 transition">進入 ▸</span>${actionButton}</div>
            </div>
          </div>
        `;
      } else {
        itemsHtml += `
          <div class="file-swipe-row relative overflow-hidden rounded-xl" data-file-path="${safeRelPath}">
            ${deleteAction}
            <div class="file-swipe-content relative p-2 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800/60 transition flex items-center justify-between gap-2 group select-none touch-pan-y">
              <div class="flex items-center gap-2 min-w-0 flex-1 cursor-pointer">${bulkSelect}<span class="flex items-center gap-2 min-w-0 flex-1" onclick="previewFile('${escapeHtml(item.relPath)}')">
                <span class="text-base shrink-0">${item.icon}</span>
                <div class="min-w-0">
                  <div class="font-mono text-slate-200 truncate group-hover:text-emerald-300 transition">${escapeHtml(item.name)}</div>
                  <div class="text-[10px] text-slate-500 font-mono">${item.sizeFormatted}</div>
                </div>
              </span></div>
              <div class="flex items-center gap-1 shrink-0">
                ${actionButton}
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
    bindExplorerBulkDelete();
    bindExplorerSwipeDelete();
    bindExplorerTransferActions();

  } catch (err) {
    filesListContainer.innerHTML = `<div class="p-3 text-rose-400 text-xs">請求異常：${escapeHtml(err.message)}</div>`;
  }
}

function bindExplorerBulkDelete() {
  if (!filesListContainer) return;
  const update = () => {
    const selected = [...filesListContainer.querySelectorAll('.file-bulk-select:checked')];
    const button = filesListContainer.querySelector('.file-bulk-delete');
    if (!button) return;
    button.disabled = selected.length === 0;
    const count = button.querySelector('.file-bulk-count');
    if (count) count.textContent = selected.length;
  };
  filesListContainer.querySelectorAll('.file-bulk-select').forEach(input => input.addEventListener('change', update));
  filesListContainer.querySelector('.file-bulk-delete')?.addEventListener('click', async () => {
    const selected = [...filesListContainer.querySelectorAll('.file-bulk-select:checked')].map(input => ({
      path: decodeURIComponent(input.dataset.filePath || ''),
      name: decodeURIComponent(input.dataset.fileName || ''),
      isDirectory: input.dataset.fileDirectory === 'true'
    }));
    if (!selected.length || !window.confirm(`確定刪除選取的 ${selected.length} 個項目？\n此動作無法復原。`)) return;
    const button = filesListContainer.querySelector('.file-bulk-delete');
    if (button) button.disabled = true;
    try {
      for (const item of selected) {
        const res = await fetch('/api/file/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: item.path }) });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(`${item.name}: ${data.error || '刪除失敗'}`);
      }
      if (navigator.vibrate) navigator.vibrate([25, 30, 25]);
      await loadDirectory(currentExplorerPath);
    } catch (err) {
      window.alert(`部分刪除失敗：${err.message}`);
      await loadDirectory(currentExplorerPath);
    }
  });
}

function renderExplorerTransferBar() {
  if (!filesTransferBar) return;
  const transfer = pendingExplorerTransfer;
  filesTransferBar.classList.toggle('hidden', !transfer);
  if (!transfer) return;
  const choosingAction = !transfer.action;
  if (filesTransferLabel) filesTransferLabel.textContent = choosingAction
    ? `已選「${transfer.name}」：選擇操作`
    : `已選「${transfer.name}」：瀏覽到目標資料夾後，按「貼到這裡」`;
  if (filesTransferActions) filesTransferActions.classList.toggle('hidden', !choosingAction);
  if (filesTransferActions) filesTransferActions.classList.toggle('flex', choosingAction);
  if (filesTransferPasteBtn) filesTransferPasteBtn.classList.toggle('hidden', choosingAction);
  if (filesTransferPasteBtn) filesTransferPasteBtn.textContent = transfer.action === 'move' ? '移到這裡' : '複製到這裡';
}

function bindExplorerTransferActions() {
  if (!filesListContainer) return;
  filesListContainer.querySelectorAll('.file-transfer-action').forEach(button => {
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const relPath = decodeURIComponent(button.dataset.filePath || '');
      const name = decodeURIComponent(button.dataset.fileName || '');
      pendingExplorerTransfer = { action: null, relPath, name, isDirectory: button.dataset.fileDirectory === 'true' };
      renderExplorerTransferBar();
      if (navigator.vibrate) navigator.vibrate(20);
    });
  });
}

async function pasteExplorerTransfer() {
  const transfer = pendingExplorerTransfer;
  if (!transfer) return;
  if (transfer.action === 'move' && !window.confirm(`確定將「${transfer.name}」移到目前資料夾？`)) return;
  try {
    const res = await fetch('/api/file/transfer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: transfer.action, sourcePath: transfer.relPath, destinationPath: currentExplorerPath })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || '檔案操作失敗');
    pendingExplorerTransfer = null;
    renderExplorerTransferBar();
    if (navigator.vibrate) navigator.vibrate([25, 30, 25]);
    await loadDirectory(currentExplorerPath);
  } catch (error) {
    window.alert(`操作失敗：${error.message}`);
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
    let startX = null;
    let offsetX = 0;
    let isRevealed = false;
    let dragging = false;
    let suppressClick = false;
    const setOffset = (value, animate = false) => {
      content.style.transition = animate ? 'transform 160ms ease-out' : 'none';
      content.style.transform = `translateX(${value}px)`;
    };

    content.addEventListener('pointerdown', event => {
      startX = event.clientX;
      offsetX = isRevealed ? -FILE_SWIPE_REVEAL_PX : 0;
      dragging = false;
      content.setPointerCapture?.(event.pointerId);
    });
    content.addEventListener('pointermove', event => {
      if (startX === null) return;
      const deltaX = event.clientX - startX;
      if (Math.abs(deltaX) < 7 && !dragging) return;
      if (Math.abs(deltaX) > 7) dragging = true;
      const next = Math.max(-FILE_SWIPE_REVEAL_PX, Math.min(0, offsetX + deltaX));
      setOffset(next);
    });
    const finish = event => {
      if (startX === null) return;
      const deltaX = event.clientX - startX;
      startX = null;
      // A normal tap (including opening the preview) must leave no swipe
      // transform behind for the next gesture to misinterpret.
      if (!dragging) return;
      const draggedToEnd = dragging && (offsetX + deltaX) <= -(FILE_SWIPE_REVEAL_PX - 4);
      suppressClick = dragging;
      setOffset(draggedToEnd ? -FILE_SWIPE_REVEAL_PX : 0, true);
      isRevealed = draggedToEnd;
      if (draggedToEnd) {
        const deleteButton = row.querySelector('.file-swipe-delete');
        const relPath = decodeURIComponent(deleteButton?.dataset.filePath || '');
        const name = decodeURIComponent(deleteButton?.dataset.fileName || '');
        const isDirectory = deleteButton?.dataset.fileDirectory === 'true';
        window.setTimeout(async () => {
          await confirmExplorerDelete(relPath, name, isDirectory);
          if (row.isConnected) {
            isRevealed = false;
            setOffset(0, true);
          }
        }, 120);
      }
      window.setTimeout(() => { suppressClick = false; }, 0);
    };
    content.addEventListener('pointerup', finish);
    content.addEventListener('pointercancel', () => {
      startX = null;
      isRevealed = false;
      setOffset(0, true);
    });
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
    const isImage = data.type === 'image';
    if (previewFileContent) {
      previewFileContent.textContent = isImage ? '' : data.content;
      previewFileContent.classList.toggle('hidden', isImage);
    }
    if (previewFileImageWrap) previewFileImageWrap.classList.toggle('hidden', !isImage);
    if (previewCopyBtn) previewCopyBtn.classList.toggle('hidden', isImage);
    if (isImage && previewFileImage) {
      const imagePath = encodeURIComponent(data.fullPath);
      const version = encodeURIComponent(String(data.mtime || Date.now()));
      const thumbnailUrl = `/api/image?path=${imagePath}&thumbnail=1&v=${version}`;
      const fullUrl = `/api/image?path=${imagePath}&v=${version}`;
      previewFileImage.src = thumbnailUrl;
      previewFileImage.alt = data.name;
      previewFileImage.onclick = () => showLightbox(fullUrl);
    } else if (previewFileImage) {
      previewFileImage.removeAttribute('src');
      previewFileImage.onclick = null;
    }

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
