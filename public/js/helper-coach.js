// Helper Coach Growth Center. Data and metrics are rendered only from the local event ledger.
(() => {
  'use strict';

  const modal = document.getElementById('helper-coach-modal');
  const openButton = document.getElementById('helper-coach-open');
  const closeButton = document.getElementById('helper-coach-close');
  const refreshButton = document.getElementById('helper-coach-refresh');
  const statusNode = document.getElementById('helper-coach-runtime-status');
  const errorNode = document.getElementById('helper-coach-error');
  const noticeNode = document.getElementById('helper-coach-notice');
  const pairButton = document.getElementById('helper-coach-pair');
  const revokeButton = document.getElementById('helper-coach-revoke');
  const pairForm = document.getElementById('helper-coach-pair-form');
  const pairKey = document.getElementById('helper-coach-pair-key');
  const pairSecret = document.getElementById('helper-coach-pair-secret');
  let currentDashboard = null;
  let loading = false;

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  async function request(path, options = {}) {
    const response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.success === false) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  }

  function showError(message = '') {
    errorNode.textContent = message;
    errorNode.classList.toggle('hidden', !message);
  }

  function showNotice(message = '') {
    noticeNode.textContent = message;
    noticeNode.classList.toggle('hidden', !message);
  }

  function formatTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function setVisible(value) {
    if (!modal) return;
    modal.classList.toggle('hidden', !value);
    modal.classList.toggle('flex', value);
    requestAnimationFrame(() => modal.classList.toggle('opacity-0', !value));
    if (value) refresh();
  }

  function renderStatus(data) {
    const label = data.status === 'runtime_connected'
      ? 'Helper Bridge 已連線並收到事件'
      : data.status === 'bridge_connected_waiting'
        ? 'Bridge 已連線 · 等待 Helper 任務事件'
        : data.status === 'bridge_unavailable'
          ? '等待 Helper Bridge 連線'
          : '尚未配對';
    const style = data.status === 'runtime_connected'
      ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-100'
      : ['bridge_connected_waiting', 'bridge_unavailable'].includes(data.status)
        ? 'border-amber-500/30 bg-amber-500/5 text-amber-100'
        : 'border-slate-700 bg-slate-900/70 text-slate-300';
    statusNode.className = `rounded-2xl border p-3 text-[11px] ${style}`;
    statusNode.innerHTML = `<div class="font-semibold">${escapeHtml(label)}</div>
      <div class="mt-1 text-[10px] opacity-80">${escapeHtml(data.helperCompatibility || '')}</div>
      <div class="mt-1 text-[9px] opacity-70">策略只使用 app_package、GoalIntent、結果代碼及 Helper 公告的安全動作；不讀取查詢文字、目標標籤或畫面內容。</div>
      <div class="mt-1 text-[9px] opacity-70">Pocket 可追蹤 task_received、觀察與終態；目前 Helper v1 尚未送出 task_received，因此第一筆觀察前的已接收訊息仍不可見。</div>
      <div class="mt-1 text-[9px] opacity-60">Bridge 最近連線：${escapeHtml(formatTime(data.bridgeLastReachableAt))} · 最近事件：${escapeHtml(formatTime(data.runtimeLastSeenAt))}${data.bridgeLastError ? ` · ${escapeHtml(data.bridgeLastError)}` : ''}</div>`;
    pairForm.classList.toggle('hidden', Boolean(data.enabled));
    revokeButton.classList.toggle('hidden', !data.enabled);
  }

  function renderMetrics(metrics = {}) {
    document.getElementById('helper-coach-metric-observed').textContent = metrics.trackedTasks ?? '—';
    document.getElementById('helper-coach-metric-observed-detail').textContent =
      `收件回執 ${metrics.receivedTasks ?? 0} · 觀察 ${metrics.observedTasks ?? 0} · 尚無終態 ${metrics.openTasks ?? 0}`;
    document.getElementById('helper-coach-metric-success').textContent = Number.isFinite(metrics.successRate)
      ? `${Math.round(metrics.successRate * 100)}% (${metrics.verifiedSuccesses}/${metrics.verifiableOutcomes})` : '—';
    document.getElementById('helper-coach-metric-success-detail').textContent =
      `${metrics.verifiableOutcomes ?? 0} 個有專屬驗證規則的終態`;
    document.getElementById('helper-coach-metric-failed').textContent = String(metrics.failedOutcomes ?? 0);
    document.getElementById('helper-coach-metric-failed-detail').textContent =
      `終態 ${metrics.completedTasks ?? 0} · 無驗證規則 ${metrics.unverifiableOutcomes ?? 0}`;
    document.getElementById('helper-coach-metric-retries').textContent = String(metrics.retryCount ?? 0);
    document.getElementById('helper-coach-metric-retries-detail').textContent =
      `Pocket 建議 ${metrics.adviceCount ?? 0} · 策略覆蓋 ${metrics.coachSupportedTasks ?? 0}/${metrics.trackedTasks ?? 0}`;
  }

  function renderCoverage(coverage = []) {
    const node = document.getElementById('helper-coach-coverage');
    if (!coverage.length) {
      node.innerHTML = '<p class="py-2 text-center text-[10px] text-slate-500">尚未收到 Helper 任務事件。</p>';
      return;
    }
    node.innerHTML = coverage.map(item => {
      const strategy = item.coachSupported ? '有教練策略' : '策略尚未涵蓋';
      const verifier = item.verificationSupported ? '有驗證規則' : '無驗證規則';
      return `<article class="rounded-xl border border-slate-800 bg-slate-950/50 px-2.5 py-2">
        <div class="flex items-start justify-between gap-2"><strong class="text-[10px] text-slate-200">${escapeHtml(item.label)}</strong><span class="shrink-0 text-[9px] ${item.verificationSupported ? 'text-teal-200' : 'text-amber-200'}">${verifier}</span></div>
        <p class="mt-1 text-[9px] text-slate-500">${escapeHtml(item.appPackage)} · ${escapeHtml(item.goal || 'GoalIntent 未分類')} · ${strategy}</p>
        <p class="mt-1 text-[9px] text-slate-400">任務 ${Number(item.taskCount) || 0} · 收件回執 ${Number(item.receivedTasks) || 0} · 觀察 ${Number(item.observationCount) || 0} · 已收終態 ${Number(item.tasksWithOutcome) || 0} · 驗證成功 ${Number(item.verifiedSuccesses) || 0} · 可驗證失敗 ${Number(item.failedOutcomes) || 0} · 無驗證規則 ${Number(item.unverifiableOutcomes) || 0}</p>
      </article>`;
    }).join('');
  }

  function renderTrend(tasks = []) {
    const node = document.getElementById('helper-coach-trend');
    const now = new Date();
    const buckets = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (6 - index));
      const key = date.toLocaleDateString('en-CA');
      return { key, label: date.toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }), passed: 0, failed: 0 };
    });
    const byDate = new Map(buckets.map(item => [item.key, item]));
    for (const task of tasks) {
      if (!task.verificationSupported || !task.outcome?.at) continue;
      const key = new Date(task.outcome.at).toLocaleDateString('en-CA');
      const bucket = byDate.get(key);
      if (!bucket) continue;
      if (task.outcome.verified) bucket.passed++;
      else bucket.failed++;
    }
    const max = Math.max(1, ...buckets.map(item => item.passed + item.failed));
    const hasData = buckets.some(item => item.passed + item.failed > 0);
    node.innerHTML = hasData ? buckets.map(item => {
      const total = item.passed + item.failed;
      const okWidth = Math.round((item.passed / max) * 100);
      const failWidth = Math.round((item.failed / max) * 100);
      return `<div class="grid grid-cols-[38px_1fr_46px] items-center gap-2 text-[9px] text-slate-400">
        <span>${escapeHtml(item.label)}</span><div class="flex h-2 overflow-hidden rounded-full bg-slate-800">
          <span class="bg-emerald-400" style="width:${okWidth}%"></span><span class="bg-rose-400" style="width:${failWidth}%"></span>
        </div><span class="text-right">${total ? `${item.passed}✓ ${item.failed}×` : '—'}</span></div>`;
    }).join('') : '<p class="py-2 text-[10px] text-slate-500">尚無已驗證的成功或失敗結果；收到真實 Runtime outcome 後才會出現趨勢。</p>';
  }

  function renderSkills(skills = []) {
    const node = document.getElementById('helper-coach-skills');
    document.getElementById('helper-coach-skill-count').textContent = `${skills.length} 筆紀錄`;
    if (!skills.length) {
      node.innerHTML = '<p class="py-3 text-center text-[10px] text-slate-500">尚無從成功任務提取的技能。候選技能需兩個不同任務獨立驗證才會啟用。</p>';
      return;
    }
    node.innerHTML = skills.map(skill => {
      const active = skill.status === 'active';
      const badge = active ? '已啟用' : '候選';
      const evidenceCount = Number(skill.outcomeCount) || 0;
      const successRate = Number.isFinite(skill.successRate) ? `${Math.round(skill.successRate * 100)}%` : '—';
      return `<article class="rounded-xl border ${active ? 'border-emerald-500/25' : 'border-amber-500/20'} bg-slate-950/60 p-2.5">
        <div class="flex items-start justify-between gap-2"><strong class="text-[11px] text-slate-100">${escapeHtml(skill.title)}</strong>
          <span class="shrink-0 rounded-full border px-2 py-0.5 text-[9px] ${active ? 'border-emerald-500/30 text-emerald-200' : 'border-amber-500/30 text-amber-200'}">${badge}</span></div>
        <p class="mt-1 text-[9px] text-slate-400">範圍：${escapeHtml(skill.appPackage || '—')} · ${escapeHtml(skill.goal || '—')}</p>
        ${skill.readyForReview ? '<p class="mt-1 text-[9px] text-teal-200">已有兩筆獨立驗證結果，可到 Helper 檢視並由使用者啟用。</p>' : ''}
        <p class="mt-1 text-[9px] text-slate-500">成功率：${successRate} (${evidenceCount} 個獨立結果)；驗證方式：${escapeHtml(skill.verification?.method || '尚未完成獨立驗證')}</p>
        <details class="mt-2 text-[9px] text-slate-400"><summary class="cursor-pointer">查看前置條件與操作步驟</summary>
          <p class="mt-1">前置：${escapeHtml((skill.preconditions || []).join(' · ') || '—')}</p>
          <ol class="mt-1 list-decimal space-y-0.5 pl-4">${(skill.steps || []).map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
        </details>
        <details class="mt-1 text-[9px] text-slate-400"><summary class="cursor-pointer">查看獨立驗證證據 (${evidenceCount})</summary>
          <ul class="mt-1 space-y-0.5">${(skill.evidence || []).map(item => `<li>${escapeHtml(item.taskId)} · ${escapeHtml(item.outcome)} · ${escapeHtml(item.verificationMethod)} · ${escapeHtml(formatTime(item.at))}</li>`).join('') || '<li>尚無驗證證據</li>'}</ul>
          <p class="mt-1 break-words text-slate-500">來源事件：${escapeHtml((skill.sourceEventIds || []).join(' · ') || '—')}</p>
        </details>
      </article>`;
    }).join('');
  }

  function renderTasks(tasks = []) {
    const node = document.getElementById('helper-coach-tasks');
    if (!tasks.length) {
      node.innerHTML = '<p class="py-3 text-center text-[10px] text-slate-500">尚無 Helper Runtime 任務事件。此處不放示範或模擬數據。</p>';
      return;
    }
    node.innerHTML = tasks.slice(0, 30).map(task => {
      const stageLabels = {
        received: 'Helper 已接收，等待首次觀察', observed: '已收到觀察', advice_submitting: '教練建議送出中', awaiting_action_result: '等待操作結果',
        awaiting_observation: '等待 Helper 下一次觀察', awaiting_outcome: '等待任務終態',
        abstained: 'Pocket 暫不建議，交由 Helper 重新規劃', stale_observation: '觀察已過期',
        retry_limit_reached: '已達安全重試上限', outcome_verified: '已獨立驗證成功', failed: '任務未通過驗證'
      };
      const outcome = task.verificationStatus === 'verified' ? 'Pocket 已獨立驗證成功'
        : task.verificationStatus === 'unverified' ? '未通過專屬驗證'
          : task.verificationStatus === 'no_verifier' ? '已收終態 · Pocket 無驗證規則'
            : stageLabels[task.stage] || task.stage;
      const style = task.verificationStatus === 'verified' ? 'text-emerald-200'
        : task.verificationStatus === 'unverified' ? 'text-rose-200'
          : task.verificationStatus === 'no_verifier' ? 'text-amber-200' : 'text-slate-300';
      return `<article class="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
        <div class="flex items-start justify-between gap-2"><strong class="text-[10px] text-slate-100">${escapeHtml(task.label)}</strong><span class="${style} text-[9px]">${escapeHtml(outcome)}</span></div>
        <p class="mt-1 text-[9px] text-slate-500">${escapeHtml(task.appPackage)} · ${escapeHtml(task.goal || 'GoalIntent 未分類')} · ${escapeHtml(formatTime(task.updatedAt))}</p>
        <p class="mt-1 text-[9px] text-slate-500">${task.coachSupported ? '教練策略可用' : '教練策略未涵蓋'} · ${task.verificationSupported ? '有專屬驗證規則' : '尚無專屬驗證規則'} · 觀察 ${Number(task.observationCount) || 0} 次</p>
        <p class="mt-1 text-[9px] text-slate-400">安全重試 ${Number(task.retryCount) || 0}/${Number(task.maxRetries) || 3}${task.lastFailureCause ? ` · 錯誤代碼 ${escapeHtml(task.lastFailureCause)}` : ''}</p>
        ${(task.advice || []).length ? `<details class="mt-2 text-[9px] text-slate-400"><summary class="cursor-pointer">查看 Pocket 建議與 Runtime 結果</summary><ul class="mt-1 space-y-1">${task.advice.map(item => {
          const status = { sending: '送出中', queued: '已排隊，等待 Runtime 結果', executed: 'Runtime 已執行', failed: 'Runtime 執行失敗', cancelled: 'Runtime 已取消', rejected: 'Helper 拒絕', suppressed_terminal: '任務已終止，Pocket 未送出', suppressed_awaiting_outcome: '等待 Helper 任務終態，Pocket 暫停建議', acceptance_unknown: '送達狀態不明', expired_no_result: '建議已過期，尚無 Runtime 結果' }[item.status] || item.status;
          return `<li>${escapeHtml(item.actionId)} · ${escapeHtml(status)}${item.runtimeActionSuccess ? ' · 操作成功，尚不代表任務完成' : ''}${item.errorCode ? ` · ${escapeHtml(item.errorCode)}` : ''}${item.runtimeDecision ? ` · Runtime: ${escapeHtml(item.runtimeDecision)}` : ''} · ${escapeHtml(formatTime(item.completedAt || item.createdAt))}</li>`;
        }).join('')}</ul></details>` : ''}
      </article>`;
    }).join('');
  }

  function renderEvents(events = []) {
    const node = document.getElementById('helper-coach-events');
    node.innerHTML = events.length ? events.slice(0, 40).map(event => `<div class="flex gap-2 border-l border-teal-500/30 pl-2.5">
      <span class="mt-0.5 shrink-0 text-[8px] text-slate-500">${escapeHtml(formatTime(event.at))}</span>
      <div class="min-w-0"><div class="text-[9px] font-semibold text-slate-200">${escapeHtml(event.stage || event.kind)}</div>
      <p class="mt-0.5 break-words text-[9px] text-slate-400">${escapeHtml(event.summary || event.kind)}</p></div></div>`).join('')
      : '<p class="py-3 text-center text-[10px] text-slate-500">尚無教練或 Runtime 紀錄。</p>';
  }

  function renderCodeProposals(proposals = [], tasks = []) {
    const node = document.getElementById('helper-coach-code');
    const taskEligible = tasks.some(task => task.failureAttribution === 'runtime_defect' && ['failed', 'aborted'].includes(task.stage));
    const statusLabels = { needs_code_review: '待確認是否為 Runtime 缺陷', proposal_only: '修正提案已整理', draft_pr_opened: 'Draft PR 已建立', staged_in_helper: '已送 Helper 待審查' };
    const entries = proposals.map(proposal => `<article class="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
      <div class="flex items-start justify-between gap-2"><strong class="text-[10px] text-slate-100">${escapeHtml(proposal.diagnosis)}</strong><span class="text-[9px] text-slate-400">${escapeHtml(statusLabels[proposal.status] || proposal.status)}</span></div>
      <p class="mt-1 text-[9px] text-slate-500">${escapeHtml(proposal.taskId)} · ${escapeHtml(formatTime(proposal.createdAt))}${proposal.prUrl ? ` · <a class="text-teal-300 underline" href="${escapeHtml(proposal.prUrl)}" target="_blank" rel="noopener">Draft PR</a>` : ''}${proposal.helperStageStatus ? ` · Helper：${escapeHtml(proposal.helperStageStatus)}` : ''}</p>
      ${proposal.status === 'needs_code_review' ? `<details class="mt-2 rounded-lg border border-indigo-500/20 p-2" open><summary class="cursor-pointer text-[9px] text-indigo-200">檢查並整理程式改善計畫</summary>
        <form class="mt-2 space-y-2" data-coach-refine-proposal="${escapeHtml(proposal.id)}">
          <label class="flex items-start gap-2 text-[9px] text-amber-200"><input name="runtimeDefectConfirmed" type="checkbox" required class="mt-0.5">我確認這次失敗可能來自 Helper Runtime 程式缺陷，並同意進行原始碼檢查。</label>
          <textarea name="diagnosis" required minlength="12" maxlength="1200" rows="2" class="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-[10px] text-slate-100">${escapeHtml(proposal.diagnosis)}</textarea>
          <textarea name="reproductionSteps" required rows="3" class="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-[10px] text-slate-100">${escapeHtml((proposal.reproductionSteps || []).join('\n'))}</textarea>
          <textarea name="testPlan" required rows="3" class="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-[10px] text-slate-100">${escapeHtml((proposal.testPlan || []).join('\n'))}</textarea>
          <button class="min-h-9 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-3 text-[10px] text-indigo-100">保存改善計畫</button>
        </form></details>` : ''}
      ${proposal.status === 'proposal_only' ? `<details class="mt-2 rounded-lg border border-slate-700 p-2"><summary class="cursor-pointer text-[9px] text-teal-200">提交程式修正並開 Draft PR</summary>
        <form class="mt-2 space-y-2" data-coach-open-pr="${escapeHtml(proposal.id)}">
          <input name="title" required minlength="8" maxlength="90" class="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 text-[10px] text-slate-100" value="${escapeHtml(proposal.diagnosis.slice(0, 88))}" aria-label="PR 標題">
          <textarea name="patch" required rows="8" class="w-full rounded-lg border border-slate-700 bg-slate-950 p-2 font-mono text-[9px] text-slate-100" placeholder="只接受 Helper Java 原始碼及測試檔案的 unified diff"></textarea>
          <button class="min-h-9 rounded-lg border border-teal-500/30 bg-teal-500/10 px-3 text-[10px] text-teal-100">測試並開 Draft PR</button>
        </form></details>` : ''}
      </article>`).join('');
    node.innerHTML = entries || (taskEligible
      ? '<p class="py-2 text-[10px] text-slate-400">已找到 Runtime 歸因的失敗；正在整理對應的程式改善建議。</p>'
      : '<p class="py-2 text-[10px] text-slate-500">目前沒有由真實 Runtime 缺陷事件建立的程式改善提案。</p>');
  }

  function render(data) {
    currentDashboard = data;
    renderStatus(data);
    renderMetrics(data.metrics);
    renderCoverage(data.coverage);
    renderTrend(data.tasks);
    renderSkills(data.skills);
    renderTasks(data.tasks);
    renderEvents(data.events);
    renderCodeProposals(data.codeProposals, data.tasks);
  }

  async function refresh() {
    if (loading) return;
    loading = true;
    showError('');
    try { render(await request('/api/helper-coach/dashboard')); }
    catch (error) { showError(error.message); }
    finally { loading = false; }
  }

  async function refineProposal(form) {
    const values = new FormData(form);
    const splitLines = key => String(values.get(key) || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const result = await request('/api/helper-coach/code-proposals', {
      method: 'POST', body: JSON.stringify({ proposalId: form.getAttribute('data-coach-refine-proposal'), diagnosis: values.get('diagnosis'),
        runtimeDefectConfirmed: values.get('runtimeDefectConfirmed') === 'on',
        reproductionSteps: splitLines('reproductionSteps'), testPlan: splitLines('testPlan') })
    });
    showNotice(`程式改善提案已保存：${result.proposal.id}`);
    await refresh();
  }

  async function openPR(form) {
    const values = new FormData(form);
    if (!window.confirm('將在 Crew Helper 的獨立分支套用此 diff，執行 testDebugUnitTest，並建立 Draft PR。流程不會合併、部署或安裝 APK。繼續？')) return;
    const button = form.querySelector('button[type="submit"], button:not([type])');
    if (button) { button.disabled = true; button.textContent = '正在測試並建立 Draft PR…'; }
    try {
      const result = await request('/api/helper-coach/code-pr', {
        method: 'POST', body: JSON.stringify({
          proposalId: form.getAttribute('data-coach-open-pr'),
          title: values.get('title'), patch: values.get('patch'), confirmed: true
        })
      });
      showNotice(result.helperStage?.staged
        ? `測試完成、Draft PR 已建立並送到 Helper 待審查：${result.prUrl}`
        : `測試完成，Draft PR 已建立：${result.prUrl}${result.helperStage?.reason ? ` · Helper 提案未送達（${result.helperStage.reason}）` : ''}`);
      await refresh();
    } catch (error) {
      showError(error.message);
      if (button) { button.disabled = false; button.textContent = '測試並開 Draft PR'; }
    }
  }

  openButton?.addEventListener('click', () => setVisible(true));
  closeButton?.addEventListener('click', () => setVisible(false));
  refreshButton?.addEventListener('click', refresh);
  modal?.addEventListener('click', event => { if (event.target === modal) setVisible(false); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal?.classList.contains('hidden')) setVisible(false); });
  pairButton?.addEventListener('click', async () => {
    pairButton.disabled = true;
    try {
      const secret = String(pairKey?.value || '').trim();
      if (!/^[a-fA-F0-9]{64}$/.test(secret)) throw new Error('請貼上 Helper 顯示的 64 位十六進位 Coach 金鑰。');
      const result = await request('/api/helper-coach/pair', { method: 'POST', body: JSON.stringify({ secret }) });
      if (pairKey) pairKey.value = '';
      pairSecret.classList.remove('hidden');
      pairSecret.textContent = result.note;
      await refresh();
    } catch (error) { showError(error.message); }
    finally { if (pairKey) pairKey.value = ''; pairButton.disabled = false; }
  });
  revokeButton?.addEventListener('click', async () => {
    if (!window.confirm('撤銷 Helper Coach 配對金鑰？')) return;
    try { await request('/api/helper-coach/revoke', { method: 'POST', body: '{}' }); pairSecret.classList.add('hidden'); await refresh(); }
    catch (error) { showError(error.message); }
  });
  document.getElementById('helper-coach-content')?.addEventListener('submit', event => {
    const proposal = event.target.closest('[data-coach-refine-proposal]');
    const pr = event.target.closest('[data-coach-open-pr]');
    if (!proposal && !pr) return;
    event.preventDefault();
    if (proposal) refineProposal(proposal).catch(error => showError(error.message));
    if (pr) openPR(pr);
  });

  window.CrewHelperCoach = { refresh, open: () => setVisible(true), getSnapshot: () => currentDashboard };
})();
