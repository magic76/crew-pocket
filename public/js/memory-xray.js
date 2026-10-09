/* Memory X-Ray + Time Machine: evidence-driven, Role-scoped, read-only. */
(() => {
  'use strict';
  const modal = document.getElementById('role-memory-modal');
  const list = document.getElementById('role-memory-list');
  const note = document.getElementById('memory-xray-note');
  const search = document.getElementById('memory-xray-search');
  const filter = document.getElementById('memory-xray-filter');
  const refresh = document.getElementById('memory-xray-refresh');
  const tabs = [...document.querySelectorAll('[data-memory-xray-tab]')];
  if (!modal || !list || !note || !search || !filter || !tabs.length) return;

  const tr = (zh, en) => window.getCrewLocale?.() === 'en' ? en : zh;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
  const nameOf = derivation => ({
    USER_EXPLICIT: tr('使用者明確提供', 'User explicit'),
    SYSTEM_OBSERVED: tr('系統觀察', 'System observed'),
    TOOL_OBSERVED: tr('工具觀察', 'Tool observed'),
    MODEL_INFERRED: tr('模型推論', 'Model inferred')
  })[derivation] || tr('未記錄推導方式', 'Derivation unknown');
  const statusOf = status => ({
    active: tr('啟用', 'Active'),
    superseded: tr('已被取代', 'Superseded'),
    disputed: tr('有爭議', 'Disputed'),
    archived: tr('已封存', 'Archived')
  })[status] || tr('狀態未知', 'Unknown status');
  const at = value => Number.isFinite(Number(value)) && Number(value) > 0
    ? new Date(Number(value)).toLocaleString(window.getCrewLocale?.() === 'en' ? 'en' : 'zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    })
    : tr('未記錄', 'Not recorded');
  const safePercent = value =>
    value !== null && value !== undefined && Number.isFinite(Number(value))
      ? Math.round(Math.max(0, Math.min(1, Number(value))) * 100) + '%'
      : '—';

  let roleId = null;
  let roleName = '';
  let mode = 'overview';
  let payload = null;
  let pending = null;
  let generation = 0;
  let selectedRevisionId = null;

  function isVisible() { return !modal.classList.contains('hidden') && roleId; }
  function records() { return Array.isArray(payload?.records) ? payload.records : []; }
  function revisions() { return Array.isArray(payload?.revisions) ? payload.revisions : []; }
  function searchMatch(record) {
    const query = search.value.trim().toLocaleLowerCase();
    if (!query) return true;
    const details = [record.text, record.kind, record.source,
      record.provenance?.derivation,
      ...(record.tags || []),
      ...(record.provenance?.sources || []).map(source => source.type + ' ' + source.id)];
    return details.some(value => String(value || '').toLocaleLowerCase().includes(query));
  }
  function match(record) {
    return record && (filter.value === 'all' || record.status === filter.value) && searchMatch(record);
  }
  function sourceRefs(record) {
    const refs = record.provenance?.sources || [];
    if (!refs.length) return '<div class="mx-muted">' +
      tr('未保存可追溯來源', 'No traceable source saved') + '</div>';
    return '<div class="mx-sources">' + refs.map(ref =>
      '<div class="mx-source"><span class="mx-source-type">' + esc(ref.type) + '</span>' +
      '<code>' + esc(ref.id) + '</code>' +
      (ref.timestamp ? '<span>' + esc(at(ref.timestamp)) + '</span>' : '') +
      (ref.uri ? '<div class="mx-source-uri">' + esc(ref.uri) + '</div>' : '') +
      '</div>').join('') + '</div>';
  }
  function evidence(record) {
    const derived = record.provenance?.derivedFrom || [];
    const replaced = record.supersedes || [];
    const status = record.status || 'active';
    return '<div class="mx-metadata">' +
      '<div><b>' + tr('Memory ID', 'Memory ID') + '</b><code>' + esc(record.id) + '</code></div>' +
      '<div><b>' + tr('狀態', 'Status') + '</b><span class="mx-status" data-status="' + esc(status) + '">' +
        esc(statusOf(status)) + '</span></div>' +
      '<div><b>' + tr('來源／推導', 'Provenance') + '</b><span>' +
        esc(nameOf(record.provenance?.derivation)) + '</span></div>' +
      '<div><b>' + tr('來源標籤', 'Source label') + '</b><span>' + esc(record.source || '—') + '</span></div>' +
      '<div><b>' + tr('信心標記', 'Recorded confidence') + '</b><span>' + safePercent(record.confidence) + '</span></div>' +
      '<div><b>' + tr('建立於', 'Created') + '</b><span>' + esc(at(record.createdAt)) + '</span></div>' +
      '<div><b>' + tr('更新於', 'Updated') + '</b><span>' + esc(at(record.updatedAt)) + '</span></div>' +
      '</div><div class="mx-evidence-heading">' + tr('來源證據', 'Evidence references') + '</div>' +
      sourceRefs(record) +
      (derived.length ? '<div class="mx-evidence-heading">' + tr('衍生自', 'Derived from') + '</div>' +
        '<div class="mx-link-ids">' + derived.map(id => '<code>' + esc(id) + '</code>').join('') + '</div>' : '') +
      (replaced.length ? '<div class="mx-evidence-heading">' + tr('取代的記憶 ID', 'Superseded memory IDs') + '</div>' +
        '<div class="mx-link-ids">' + replaced.map(id => '<code>' + esc(id) + '</code>').join('') + '</div>' : '') +
      '<p class="mx-disclaimer">' +
        tr('信心分數是當時保存的標記，不代表內容已被獨立驗證。',
          'Confidence is a stored annotation, not independent verification.') + '</p>';
  }
  function summary(record) {
    return '<div class="mx-summary">' +
      '<div class="mx-memory-heading"><span class="mx-kind">' + esc(record.kind || 'experience') +
      '</span><span class="mx-status" data-status="' + esc(record.status || 'active') + '">' +
      esc(statusOf(record.status || 'active')) + '</span></div>' +
      '<div class="mx-text">' + esc(record.text) + '</div>' +
      '<div class="mx-footnote">' + esc(at(record.updatedAt)) + ' · ' +
        esc(record.provenance?.derivation || record.source || tr('來源未知', 'Source unknown')) +
        '</div></div>';
  }
  function renderOverview() {
    const filtered = records().filter(match);
    note.textContent = records().length + tr(' 筆 Role Memory · 僅顯示目前快照', ' Role memories · current snapshots only');
    if (!filtered.length) {
      list.innerHTML = '<div class="mx-empty">' +
        tr('這個條件下沒有 Role Memory。', 'No Role memories match these filters.') + '</div>';
      return;
    }
    const recorded = new Set(revisions().map(revision => revision.recordId));
    list.innerHTML = filtered.map(record =>
      '<article class="mx-memory-card"><details>' +
        '<summary>' + summary(record) + '<span class="mx-expand">' + tr('來源與歷史', 'Sources & history') + '</span></summary>' +
        '<div class="mx-memory-detail">' + evidence(record) +
          '<p class="mx-recording-note">' + (recorded.has(record.id)
            ? tr('這筆記憶有已保存的修訂紀錄，可至時光機查看。',
                 'Recorded revisions exist for this memory in Time Machine.')
            : tr('這筆記憶尚無版本紀錄；不代表它過去沒有被修改。',
                 'No revisions recorded; this does not mean the memory was never edited.')) +
          '</p></div></details></article>'
    ).join('');
  }
  function revisionTitle(revision) {
    return ({
      created: tr('建立記憶', 'Created memory'),
      updated: tr('更新記憶', 'Updated memory'),
      superseded: tr('記憶被取代', 'Memory superseded')
    })[revision.action] || tr('版本事件', 'Revision event');
  }
  function renderRevision(revision, all) {
    // Array order is authoritative; timestamps can collide within one millisecond.
    const position = all.findIndex(other => other.id === revision.id);
    const older = position < 0 ? null :
      all.slice(position + 1).find(other => other.recordId === revision.recordId) || null;
    const before = older?.record;
    const now = revision.record;
    return '<div class="mx-time-detail">' +
      '<div class="mx-time-detail-top"><span class="mx-status" data-status="' + esc(now.status || 'active') + '">' +
      esc(statusOf(now.status || 'active')) + '</span><span>' + esc(at(revision.at)) + '</span></div>' +
      '<h4>' + esc(revisionTitle(revision)) + '</h4>' +
      '<div class="mx-compare">' +
        '<div class="mx-compare-cell"><span>' + tr('上一個已記錄版本', 'Previous recorded version') + '</span>' +
          '<p>' + (before ? esc(before.text) : tr('沒有更早的已保存版本，無法重建修改前內容。',
            'No earlier recorded version; prior content cannot be reconstructed.')) + '</p></div>' +
        '<div class="mx-compare-cell"><span>' + tr('此版本', 'Selected version') + '</span>' +
          '<p>' + esc(now.text) + '</p></div>' +
      '</div>' +
      (revision.causedBy ? '<p class="mx-recording-note">' +
        tr('由記憶', 'Superseded by') + ' <code>' + esc(revision.causedBy) + '</code></p>' : '') +
      '<details class="mx-revision-evidence"><summary>' +
        tr('展開此版本的來源與生命週期', 'View evidence and lifecycle for this version') +
        '</summary>' + evidence(now) + '</details></div>';
  }
  function renderTimeline() {
    const all = revisions();
    const relevant = all.filter(entry => match(entry.record));
    const newestFirst = all;
    note.textContent = relevant.length + tr(' 筆可查看版本', ' recorded revisions') +
      (payload?.historyTruncated ? ' · ' + tr('較舊紀錄已截斷', 'Older history truncated') : '');
    if (!relevant.length) {
      list.innerHTML = '<div class="mx-empty">' +
        tr('尚無此條件的版本事件。此功能只能回看啟用版本紀錄之後的實際變更。',
          'No matching revision events. Only changes recorded after version history was introduced can be replayed.') +
        '</div>';
      return;
    }
    if (!relevant.some(entry => entry.id === selectedRevisionId)) selectedRevisionId = relevant[0].id;
    const selected = relevant.find(entry => entry.id === selectedRevisionId);
    list.innerHTML = '<p class="mx-recording-note">' +
      tr('時光機僅根據實際保存的修訂快照；不會推測舊版內容。',
         'Time Machine uses actual revision snapshots only. It never reconstructs missing past versions.') +
      '</p><div class="mx-time-layout"><div class="mx-time-events" role="list">' +
      relevant.map(entry => '<button role="listitem" type="button" class="mx-time-event ' +
        (selectedRevisionId === entry.id ? 'is-selected' : '') +
        '" data-memory-revision="' + esc(entry.id) + '" aria-pressed="' +
        String(selectedRevisionId === entry.id) + '">' +
        '<span class="mx-time-dot" data-action="' + esc(entry.action) + '"></span>' +
        '<span class="mx-time-event-copy"><strong>' + esc(revisionTitle(entry)) + '</strong>' +
        '<small>' + esc(at(entry.at)) + '</small>' +
        '<span>' + esc(entry.record.kind) + ' · ' +
          esc(entry.record.text.slice(0, 80)) + '</span></span></button>').join('') +
      '</div>' + renderRevision(selected, newestFirst) + '</div>';
  }
  function render() {
    tabs.forEach(tab => {
      const active = tab.dataset.memoryXrayTab === mode;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-pressed', String(active));
    });
    if (!payload) return;
    if (mode === 'timeline') renderTimeline();
    else renderOverview();
  }
  async function load() {
    if (!roleId || !isVisible()) return;
    const token = ++generation;
    pending?.abort();
    pending = typeof AbortController === 'function' ? new AbortController() : null;
    list.innerHTML = '<div class="mx-empty">' + tr('讀取記憶與已保存的版本…', 'Loading memories and recorded versions…') + '</div>';
    note.textContent = tr('正在載入', 'Loading');
    try {
      const response = await fetch('/api/role-memory-inspect?role_id=' + encodeURIComponent(roleId), {
        cache: 'no-store', ...(pending ? { signal: pending.signal } : {})
      });
      const data = await response.json();
      if (!response.ok || data.success !== true || data.roleId !== roleId ||
        !Array.isArray(data.records) || !Array.isArray(data.revisions)) {
        throw new Error('Memory inspection unavailable');
      }
      if (token !== generation || !isVisible()) return;
      payload = data;
      render();
    } catch (error) {
      if (token !== generation || !isVisible() || error.name === 'AbortError') return;
      payload = null;
      note.textContent = tr('載入失敗', 'Load failed');
      list.innerHTML = '<div class="mx-empty mx-error">' +
        tr('無法讀取記憶檢視。請稍後重試。', 'Could not load memory inspection. Try again.') + '</div>';
    }
  }
  function open(role) {
    if (!/^[A-Za-z0-9._-]{1,160}$/.test(role?.id || '')) return;
    roleId = role.id;
    roleName = role.name || '';
    mode = 'overview';
    payload = null;
    selectedRevisionId = null;
    search.value = '';
    filter.value = 'all';
    load();
  }
  function close() {
    generation++;
    pending?.abort();
    roleId = null;
    payload = null;
  }
  tabs.forEach(tab => tab.addEventListener('click', () => {
    mode = tab.dataset.memoryXrayTab === 'timeline' ? 'timeline' : 'overview';
    render();
  }));
  search.addEventListener('input', render);
  filter.addEventListener('change', render);
  refresh?.addEventListener('click', load);
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-memory-revision]');
    if (!button) return;
    selectedRevisionId = button.dataset.memoryRevision;
    renderTimeline();
    const selected = list.querySelector('[data-memory-revision="' +
      selectedRevisionId.replace(/[^A-Za-z0-9._-]/g, '') + '"]');
    selected?.focus?.({ preventScroll: true });
  });
  document.getElementById('close-role-memory-btn')?.addEventListener('click', close);
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  document.addEventListener('crew:localechange', render);
  window.RoleMemoryXRay = { open, close, refresh: load };
})();
