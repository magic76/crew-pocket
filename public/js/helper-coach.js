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
    const statusLabels = {
      not_paired: ['尚未配對', 'border-slate-700 bg-slate-900/70 text-slate-300'],
      waiting_for_helper_runtime: ['等待 Helper Runtime 支援 Coach v1', 'border-amber-500/30 bg-amber-500/5 text-amber-100'],
      runtime_connected: ['近期收到已配對 Runtime 事件', 'border-emerald-500/30 bg-emerald-500/5 text-emerald-100']
    };
    const [label, style] = statusLabels[data.status] || statusLabels.not_paired;
    statusNode.className = `rounded-2xl border p-3 text-[11px] ${style}`;
    statusNode.innerHTML = `<div class="font-semibold">${escapeHtml(label)}</div>
      <div class="mt-1 text-[10px] opacity-80">${escapeHtml(data.helperCompatibility || '')}</div>
      <div class="mt-1 text-[9px] opacity-70">診斷方式：Pocket v1 的明確錯誤碼規則與任務步驟；目前不使用 UI 畫面截圖或模擬成功數據。</div>
      <div class="mt-1 text-[9px] opacity-60">最後事件：${escapeHtml(formatTime(data.runtimeLastSeenAt))}</div>`;
    pairButton.classList.toggle('hidden', Boolean(data.enabled));
    revokeButton.classList.toggle('hidden', !data.enabled);
  }

  function renderMetrics(metrics = {}) {
    document.getElementById('helper-coach-metric-observed').textContent = metrics.observedTasks ?? '—';
    document.getElementById('helper-coach-metric-success').textContent = Number.isFinite(metrics.successRate)
      ? `${Math.round(metrics.successRate * 100)}% (${metrics.verifiedSuccesses}/${metrics.completedTasks})` : '—';
    document.getElementById('helper-coach-metric-failed').textContent = metrics.completedTasks
      ? String(metrics.failedOutcomes ?? 0) : '—';
    document.getElementById('helper-coach-metric-retries').textContent = metrics.observedTasks
      ? String(metrics.retryCount ?? 0) : '—';
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
      if (!task.outcome?.at) continue;
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
        <p class="mt-1 text-[9px] text-slate-400">範圍：${escapeHtml(skill.appPackage || '—')} · ${escapeHtml(skill.appVersion || '—')} · UI ${escapeHtml(skill.uiSignature || '—')}</p>
        <p class="mt-1 text-[9px] text-slate-500">成功率：${successRate} (${evidenceCount} 個獨立結果)；驗證方式：${escapeHtml(skill.verification?.method || '尚未完成獨立驗證')}</p>
        <details class="mt-2 text-[9px] text-slate-400"><summary class="cursor-pointer">查看前置條件與操作步驟</summary>
          <p class="mt-1">前置：${escapeHtml((skill.preconditions || []).join(' · ') || '—')}</p>
          <ol class="mt-1 list-decimal space-y-0.5 pl-4">${(skill.steps || []).map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ol>
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
      const outcome = task.outcome?.verified ? '驗證成功' : task.outcome ? '未驗證成功' : task.stage;
      const style = task.outcome?.verified ? 'text-emerald-200' : task.outcome ? 'text-rose-200' : 'text-slate-300';
      return `<article class="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
        <div class="flex items-start justify-between gap-2"><strong class="text-[10px] text-slate-100">${escapeHtml(task.label)}</strong><span class="${style} text-[9px]">${escapeHtml(outcome)}</span></div>
        <p class="mt-1 text-[9px] text-slate-500">${escapeHtml(task.appPackage)} ${escapeHtml(task.appVersion)} · ${escapeHtml(formatTime(task.updatedAt))}</p>
        <p class="mt-1 text-[9px] text-slate-400">重試 ${Number(task.retryCount) || 0}/${Number(task.maxRetries) || 3}${task.lastFailureCause ? ` · 失敗原因 ${escapeHtml(task.lastFailureCause)}` : ''}${task.failureAttribution ? ` · 歸因 ${escapeHtml(task.failureAttribution)}` : ''}</p>
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
    const statusLabels = { needs_code_review: '待檢查程式來源', proposal_only: '修正提案已整理', draft_pr_opened: 'Draft PR 已建立' };
    const entries = proposals.map(proposal => `<article class="rounded-xl border border-slate-800 bg-slate-950/60 p-2.5">
      <div class="flex items-start justify-between gap-2"><strong class="text-[10px] text-slate-100">${escapeHtml(proposal.diagnosis)}</strong><span class="text-[9px] text-slate-400">${escapeHtml(statusLabels[proposal.status] || proposal.status)}</span></div>
      <p class="mt-1 text-[9px] text-slate-500">${escapeHtml(proposal.taskId)} · ${escapeHtml(formatTime(proposal.createdAt))}${proposal.prUrl ? ` · <a class="text-teal-300 underline" href="${escapeHtml(proposal.prUrl)}" target="_blank" rel="noopener">Draft PR</a>` : ''}</p>
      ${proposal.status === 'needs_code_review' ? `<details class="mt-2 rounded-lg border border-indigo-500/20 p-2" open><summary class="cursor-pointer text-[9px] text-indigo-200">檢查並整理程式改善計畫</summary>
        <form class="mt-2 space-y-2" data-coach-refine-proposal="${escapeHtml(proposal.id)}">
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
      showNotice(`測試完成，Draft PR 已建立：${result.prUrl}`);
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
      const result = await request('/api/helper-coach/pair', { method: 'POST', body: '{}' });
      pairSecret.classList.remove('hidden');
      pairSecret.replaceChildren();
      const warning = document.createElement('p');
      warning.className = 'text-[10px] text-amber-100';
      warning.textContent = result.note;
      const secret = document.createElement('code');
      secret.className = 'mt-2 block break-all rounded-lg bg-black/40 p-2 text-[10px] text-teal-100';
      secret.textContent = result.pairingSecret;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'mt-2 min-h-9 rounded-lg border border-slate-700 px-3 text-[10px] text-slate-200';
      copy.textContent = '複製配對金鑰';
      copy.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(result.pairingSecret);
        copy.textContent = '已複製';
      });
      pairSecret.append(warning, secret, copy);
      window.setTimeout(() => { secret.textContent = '配對金鑰已從畫面清除'; }, 60_000);
      await refresh();
    } catch (error) { showError(error.message); }
    finally { pairButton.disabled = false; }
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
