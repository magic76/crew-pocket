// User-controlled storage management. Nothing is deleted during scanning.
const storagePageBtn = document.getElementById('storage-btn');
const storageModal = document.getElementById('storage-modal');
const closeStorageBtn = document.getElementById('close-storage-btn');
const refreshStorageBtn = document.getElementById('refresh-storage-btn');
const deleteStorageBtn = document.getElementById('delete-storage-btn');
const storageList = document.getElementById('storage-list');
const storageSubtitle = document.getElementById('storage-subtitle');
let storageReport = null;
let storageTab = 'conversations';
let storageSort = 'updated_desc';

function storageBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB']; let value = bytes; let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}
function storageEscape(value) { const node = document.createElement('span'); node.textContent = value || ''; return node.innerHTML; }
function storageDate(timestamp) {
  if (!timestamp) return '時間未知';
  return new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp));
}
function sortStorageItems(items) {
  return [...items].sort((a, b) => {
    if (storageSort === 'size_desc') return b.bytes - a.bytes;
    if (storageSort === 'size_asc') return a.bytes - b.bytes;
    if (storageSort === 'updated_asc') return a.modifiedAt - b.modifiedAt;
    return b.modifiedAt - a.modifiedAt;
  });
}
function toggleStorageModal(show) {
  if (!storageModal) return;
  if (typeof window.cancelDeferredModalDataLoad === 'function') window.cancelDeferredModalDataLoad(storageModal);
  storageModal.classList.toggle('opacity-0', !show); storageModal.classList.toggle('pointer-events-none', !show);
  if (!show) return;
  renderStorageLoading();
  // Storage scanning can be expensive. Start it after the modal fade gets its
  // first paint instead of blocking the opening animation every time.
  if (typeof window.deferModalDataLoad === 'function') {
    window.deferModalDataLoad(storageModal, () => loadStorageReport(false));
  } else {
    loadStorageReport(false);
  }
}
function renderStorageLoading() {
  if (!storageList) return;
  storageList.innerHTML = '<div class="text-center text-slate-500 py-8">正在掃描本機資料…</div>';
}
async function loadStorageReport(showLoading = true) {
  if (!storageList) return;
  if (showLoading) renderStorageLoading();
  try {
    const res = await fetch('/api/storage'); const data = await res.json(); if (!res.ok) throw new Error(data.error || '掃描失敗');
    storageReport = data; renderStorageReport();
  } catch (err) { storageList.innerHTML = `<div class="text-rose-300 p-3">無法讀取儲存空間：${storageEscape(err.message)}</div>`; }
}
function renderStorageReport() {
  const conversations = sortStorageItems(storageReport?.conversations || []); const media = sortStorageItems(storageReport?.media || []); const totals = storageReport?.totals || {};
  if (storageSubtitle) storageSubtitle.textContent = `對話 ${storageBytes(totals.conversations || 0)} · 媒體 ${storageBytes(totals.media || 0)}`;
  const conversationRows = conversations.map(item => `<label class="flex gap-2 items-center p-3 rounded-2xl bg-slate-950/70 border border-slate-800"><input type="checkbox" class="storage-conversation accent-rose-500 w-4 h-4" data-id="${storageEscape(item.id)}" data-provider="${item.provider}"><span class="min-w-0 flex-1"><span class="flex gap-1.5 items-center"><span class="text-[9px] px-1.5 py-0.5 rounded border ${item.provider === 'codex' ? 'border-emerald-700 text-emerald-300' : 'border-indigo-700 text-indigo-300'}">${item.provider === 'codex' ? 'CODEX' : 'AGY'}</span><span class="truncate text-slate-100 font-semibold">${storageEscape(item.title)}</span></span><span class="block truncate text-[10px] text-slate-400 mt-1">${storageEscape(item.preview || '尚無可預覽的使用者訊息')}</span><span class="block text-[10px] text-slate-500 mt-1">最後更新：${storageDate(item.modifiedAt)}</span></span><span class="text-amber-300 font-mono shrink-0">${storageBytes(item.bytes)}</span></label>`).join('') || '<div class="text-slate-500 text-center py-8">沒有可列出的對話紀錄</div>';
  const mediaRows = media.map(item => `<label class="flex gap-2 items-center p-2 rounded-2xl bg-slate-950/70 border border-slate-800"><input type="checkbox" class="storage-media accent-rose-500 w-4 h-4" data-root="${storageEscape(item.root)}" data-path="${storageEscape(item.path)}">${item.isImage ? `<a href="${item.previewUrl}" target="_blank" class="w-14 h-14 rounded-xl overflow-hidden bg-slate-800 shrink-0"><img src="${item.previewUrl}" class="w-full h-full object-cover" loading="lazy" alt="圖片縮圖"></a>` : '<div class="w-14 h-14 rounded-xl bg-slate-800 flex items-center justify-center shrink-0">📄</div>'}<span class="min-w-0 flex-1"><span class="block truncate text-slate-200">${storageEscape(item.path)}</span><span class="text-[10px] text-slate-500">${storageEscape(item.root)} · ${new Date(item.modifiedAt).toLocaleDateString()}</span></span><span class="text-amber-300 font-mono shrink-0">${storageBytes(item.bytes)}</span></label>`).join('') || '<div class="text-slate-500 text-center py-8">沒有媒體或快取檔</div>';
  const tabs = `<div class="grid grid-cols-2 gap-2"><button data-storage-tab="conversations" class="storage-tab min-h-11 rounded-xl border text-xs font-bold ${storageTab === 'conversations' ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'}">💬 對話 ${conversations.length}</button><button data-storage-tab="media" class="storage-tab min-h-11 rounded-xl border text-xs font-bold ${storageTab === 'media' ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-800 border-slate-700 text-slate-300'}">🖼️ 圖片／檔案 ${media.length}${storageReport.mediaTruncated ? '+' : ''}</button></div><select id="storage-sort" class="w-full min-h-11 rounded-xl bg-slate-800 border border-slate-700 px-3 text-xs text-slate-200 outline-none"><option value="updated_desc" ${storageSort === 'updated_desc' ? 'selected' : ''}>最後更新：最新在前</option><option value="updated_asc" ${storageSort === 'updated_asc' ? 'selected' : ''}>最後更新：最舊在前</option><option value="size_desc" ${storageSort === 'size_desc' ? 'selected' : ''}>檔案大小：最大在前</option><option value="size_asc" ${storageSort === 'size_asc' ? 'selected' : ''}>檔案大小：最小在前</option></select>`;
  const activeSection = storageTab === 'conversations' ? `<section><div class="text-[10px] text-slate-500 mb-2">標題與最近一句供你確認；刪除會移除整個 session。</div><div class="space-y-2">${conversationRows}</div></section>` : `<section><div class="text-[10px] text-slate-500 mb-2">點圖片可放大確認；只會刪除已勾選的單一檔案。</div><div class="space-y-2">${mediaRows}</div></section>`;
  storageList.innerHTML = `<div class="p-3 rounded-xl bg-amber-950/30 border border-amber-700/30 text-[10px] text-amber-100">不會自動刪除；勾選、確認後才會執行。</div>${tabs}${activeSection}`;
  storageList.querySelectorAll('.storage-tab').forEach(button => button.addEventListener('click', () => { storageTab = button.dataset.storageTab; renderStorageReport(); }));
  storageList.querySelector('#storage-sort')?.addEventListener('change', event => { storageSort = event.target.value; renderStorageReport(); });
}
async function deleteStorageSelection() {
  const conversationInputs = [...document.querySelectorAll('.storage-conversation:checked')]; const mediaInputs = [...document.querySelectorAll('.storage-media:checked')];
  if (!conversationInputs.length && !mediaInputs.length) return window.alert('請先勾選要刪除的項目。');
  const message = `確定永久刪除 ${conversationInputs.length} 個對話與 ${mediaInputs.length} 個媒體檔？此動作無法復原。`;
  if (!window.confirm(message)) return;
  deleteStorageBtn.disabled = true;
  try {
    for (const input of conversationInputs) {
      const res = await fetch(`/api/conversation?id=${encodeURIComponent(input.dataset.id)}&provider=${encodeURIComponent(input.dataset.provider)}`, { method: 'DELETE' });
      const data = await res.json(); if (!res.ok || !data.success) throw new Error(data.error || `無法刪除對話 ${input.dataset.id}`);
    }
    const items = mediaInputs.map(input => ({ root: input.dataset.root, path: input.dataset.path }));
    if (items.length) { const res = await fetch('/api/storage/media', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }) }); const data = await res.json(); if (!res.ok) throw new Error(data.error || '媒體刪除失敗'); }
    if (typeof loadConversations === 'function') loadConversations();
    if (navigator.vibrate) navigator.vibrate([30, 40, 30]);
    await loadStorageReport();
  } catch (err) { window.alert(`刪除失敗：${err.message}`); }
  finally { deleteStorageBtn.disabled = false; }
}
function openStorageModalFromToolsMenu() {
  const toolsMenuDropdown = document.getElementById('tools-menu-dropdown');
  if (toolsMenuDropdown) toolsMenuDropdown.classList.add('hidden');
  // The storage launcher shares the tools popover's stacking level. Waiting
  // for the next paint prevents the two opacity layers from flashing.
  window.requestAnimationFrame(() => toggleStorageModal(true));
}
if (storagePageBtn) storagePageBtn.addEventListener('click', openStorageModalFromToolsMenu);
if (closeStorageBtn) closeStorageBtn.addEventListener('click', () => toggleStorageModal(false));
if (refreshStorageBtn) refreshStorageBtn.addEventListener('click', loadStorageReport);
if (deleteStorageBtn) deleteStorageBtn.addEventListener('click', deleteStorageSelection);
if (storageModal) storageModal.addEventListener('click', event => { if (event.target === storageModal) toggleStorageModal(false); });
window.toggleStorageModal = toggleStorageModal;
