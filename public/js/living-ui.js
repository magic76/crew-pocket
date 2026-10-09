/* Crew Living UI: trusted, opt-in execution workbench over structured turn_result.
 * No model HTML, script, diff or test outcome is executed or inferred here.
 * The assistant's formatted response comes from the existing safe renderer.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewLivingUI = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const statuses = {
    completed: { label: '回覆已結束', help: '代表這輪執行回覆已結束，不等於測試或建置通過。' },
    failed: { label: '執行失敗', help: '執行未成功結束；請查看報告與工具紀錄。' },
    interrupted: { label: '執行中斷', help: '這輪工作已中斷，不代表已完成。' },
    unknown: { label: '終態未知', help: '缺少可靠的完成狀態，不會推定成功。' }
  };
  function stateOf(result) {
    const status = String(result?.status || '').toLowerCase();
    if (['completed', 'complete', 'success', 'succeeded'].includes(status)) return 'completed';
    if (['failed', 'error'].includes(status)) return 'failed';
    if (['interrupted', 'cancelled', 'canceled', 'aborted'].includes(status)) return 'interrupted';
    return 'unknown';
  }
  function finiteNonNegative(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? Math.trunc(parsed) : null;
  }
  function normalize(input = {}) {
    const result = input.turnResult || {};
    const files = Array.isArray(result.changed_files)
      ? [...new Set(result.changed_files.filter(value => typeof value === 'string')
        .map(value => value.trim()).filter(Boolean))].slice(0, 80)
      : [];
    const checks = Array.isArray(result.checks)
      ? result.checks.filter(check => check && typeof check === 'object').slice(0, 50).map(check => {
        const status = String(check.status || check.state || '').toLowerCase();
        return {
          label: String(check.label || check.name || check.type || 'Check'),
          status: ['passed', 'success', 'succeeded', 'completed'].includes(status) ? 'passed'
            : ['failed', 'error'].includes(status) ? 'failed' : 'unknown'
        };
      })
      : [];
    const rawCommit = result.commit && typeof result.commit === 'object'
      ? String(result.commit.hash || result.commit.short_hash || '').trim() : '';
    const commit = /^[0-9a-f]{7,64}$/i.test(rawCommit) ? rawCommit : '';
    const duration = finiteNonNegative(result.duration_ms);
    return {
      state: stateOf(result),
      mode: String(result.execution_mode || '').toUpperCase(),
      files, checks, commit, duration,
      executions: finiteNonNegative(result.executions),
      polls: finiteNonNegative(result.polls),
      tools: finiteNonNegative(result.tool_count),
      toolRows: finiteNonNegative(input.toolRows) || 0
    };
  }
  function sectionTab(kind, name, count = null) {
    return '<button type="button" class="living-tab" data-living-tab="' + kind +
      '" role="tab" aria-selected="' + (kind === 'report') + '"' +
      (kind === 'report' ? ' tabindex="0"' : ' tabindex="-1"') + '>' +
      escape(name) + (count === null ? '' : '<span class="living-tab-count">' + count + '</span>') +
      '</button>';
  }
  function panel(kind, html, active = false) {
    return '<section class="living-panel" data-living-panel="' + kind +
      '" role="tabpanel"' + (!active ? ' hidden' : '') + '>' + html + '</section>';
  }
  function filePanel(files) {
    if (!files.length) return '';
    return '<div class="living-panel-toolbar"><span>實際記錄的修改路徑 · ' + files.length +
      '</span><input type="search" class="living-file-search" data-living-file-search ' +
      'placeholder="搜尋檔名或路徑" aria-label="搜尋修改檔案" maxlength="200"></div>' +
      '<ul class="living-file-list">' + files.map(file =>
        '<li class="living-file-row" data-living-file-row data-file-search="' + escape(file.toLocaleLowerCase()) + '">' +
          '<span class="living-file-icon" aria-hidden="true">⌁</span>' +
          '<code class="living-file-path">' + escape(file) + '</code>' +
          '<button type="button" data-living-copy="file" class="living-copy-btn" ' +
            'aria-label="複製檔案路徑" data-copy-text="' + escape(file) + '">複製</button>' +
        '</li>').join('') + '</ul><p class="living-evidence-note">' +
      '這些是 Runtime 記錄的檔案路徑，沒有補造 Diff；若需要 Diff，請要求 Agent 提供實際版本差異。</p>' +
      '<p class="living-file-no-match" hidden>沒有符合的檔案路徑。</p>';
  }
  function checkPanel(checks, legacyHtml) {
    if (!checks.length) return '';
    // Preserve existing .execution-result-check and data-check-state contract.
    return legacyHtml + '<p class="living-evidence-note">只顯示結構化回報中明確提供的驗證結果；未知狀態不計為通過。</p>';
  }
  function summaryChips(info) {
    const rows = [];
    if (info.files.length) rows.push(['修改路徑', info.files.length]);
    if (info.checks.length) {
      const pass = info.checks.filter(check => check.status === 'passed').length;
      const fail = info.checks.filter(check => check.status === 'failed').length;
      const unknown = info.checks.length - pass - fail;
      rows.push(['已記錄驗證', info.checks.length]);
      rows.push(['通過', pass]);
      if (fail) rows.push(['失敗', fail]);
      if (unknown) rows.push(['未知', unknown]);
    }
    if (info.executions !== null) rows.push(['操作次數', info.executions]);
    if (info.tools !== null && info.tools > 0) rows.push(['工具種類', info.tools]);
    if (info.polls !== null && info.polls > 0) rows.push(['輪詢次數', info.polls]);
    return rows.length ? '<div class="living-metrics">' + rows.map(([name, value]) =>
      '<div class="living-metric"><strong>' + value + '</strong><span>' + escape(name) + '</span></div>'
    ).join('') + '</div>' : '';
  }
  function render({
    turnResult = null,
    responseHtml = '',
    changedFilesHtml = '',
    checksHtml = '',
    executionHtml = '',
    summaryBits = [],
    structuredCommit = '',
    toolRows = 0
  } = {}) {
    const info = normalize({ turnResult, toolRows });
    const tabs = [sectionTab('report', '工作報告')];
    if (info.files.length) tabs.push(sectionTab('files', '檔案', info.files.length));
    if (info.checks.length) tabs.push(sectionTab('checks', '驗證', info.checks.length));
    if (info.toolRows) tabs.push(sectionTab('tools', '操作', info.toolRows));
    const commit = info.commit; // Only validated structured commit metadata.
    const summary = summaryBits.length || structuredCommit
      ? '<div class="execution-result-hero" aria-label="執行資料">' +
        '<span class="execution-result-hero-meta">' +
        summaryBits.map(bit => '<span>' + escape(bit) + '</span>').join('') +
        (commit ? '<span class="execution-result-commit" title="Commit">' +
          escape(commit.slice(0,12)) + '</span>' : '') +
        '</span></div>' : '';
    return '<div class="living-workbench" data-living-ui="execution">' +
      '<div class="living-hero">' +
        '<div class="living-hero-top"><span class="living-kicker">CREW WORKBENCH</span>' +
          '<span class="living-outcome" data-state="' + info.state + '">' +
            escape(statuses[info.state].label) + '</span></div>' +
        summary +
        '<p class="living-outcome-note">' + escape(statuses[info.state].help) + '</p>' +
        summaryChips(info) +
      '</div>' +
      '<div class="living-tablist" role="tablist" aria-label="執行成果檢視">' +
        tabs.join('') + '</div>' +
      panel('report', '<section class="execution-result-section execution-result-response">' +
        '<div class="msg-content min-w-0">' + responseHtml + '</div></section>', true) +
      (info.files.length ? panel('files', filePanel(info.files)) : '') +
      (info.checks.length ? panel('checks', checkPanel(info.checks, checksHtml)) : '') +
      (info.toolRows ? panel('tools', executionHtml) : '') +
      '<div class="living-action-feedback" data-living-feedback role="status" aria-live="polite"></div>' +
    '</div>';
  }

  function rootOf(target) { return target?.closest?.('.living-workbench'); }
  function changeTab(root, kind) {
    if (!root || !['report', 'files', 'checks', 'tools'].includes(kind)) return;
    const tabs = [...root.querySelectorAll('[data-living-tab]')];
    const chosen = tabs.find(tab => tab.dataset.livingTab === kind);
    if (!chosen) return;
    tabs.forEach(tab => {
      const active = tab === chosen;
      tab.setAttribute('aria-selected', String(active));
      tab.setAttribute('tabindex', active ? '0' : '-1');
      tab.classList.toggle('is-active', active);
    });
    root.querySelectorAll('[data-living-panel]').forEach(panel => {
      panel.hidden = panel.dataset.livingPanel !== kind;
    });
  }

  async function copyText(root, value) {
    const message = root.querySelector('[data-living-feedback]');
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(value);
      if (message) message.textContent = '已複製路徑';
    } catch (_) {
      if (message) message.textContent = '無法自動複製，請長按檔案路徑選取。';
    }
  }
  let installed = false;
  function install(doc) {
    if (!doc || installed) return;
    installed = true;
    doc.addEventListener('click', event => {
      const root = rootOf(event.target);
      if (!root) return;
      const tab = event.target.closest('[data-living-tab]');
      if (tab) { changeTab(root, tab.dataset.livingTab); return; }
      const copy = event.target.closest('[data-living-copy="file"]');
      if (copy) void copyText(root, copy.dataset.copyText || '');
    });
    doc.addEventListener('input', event => {
      if (!event.target.matches?.('[data-living-file-search]')) return;
      const root = rootOf(event.target);
      if (!root) return;
      const query = String(event.target.value || '').trim().toLocaleLowerCase();
      let shown = 0;
      root.querySelectorAll('[data-living-file-row]').forEach(row => {
        row.hidden = !String(row.dataset.fileSearch || '').includes(query);
        if (!row.hidden) shown++;
      });
      const empty = root.querySelector('.living-file-no-match');
      if (empty) empty.hidden = shown > 0;
    });
    doc.addEventListener('keydown', event => {
      const tab = event.target.closest?.('[data-living-tab]');
      if (!tab || !['ArrowRight','ArrowLeft','Home','End'].includes(event.key)) return;
      const root = rootOf(tab);
      if (!root) return;
      const options = [...root.querySelectorAll('[data-living-tab]')];
      const current = options.indexOf(tab);
      if (current < 0) return;
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length-1
        : (current + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length;
      event.preventDefault();
      changeTab(root, options[index].dataset.livingTab);
      options[index].focus();
    });
  }

  if (typeof document !== 'undefined') install(document);
  return { normalize, render, changeTab, install, stateOf };
});
