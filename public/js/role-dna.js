/* Role DNA skill inspector. Candidate proposals are not verified results.
 * Runtime observations use tool-reported exit codes; human evidence is user-attested.
 */
(() => {
  'use strict';
  const modal = document.getElementById('role-dna-modal');
  const list = document.getElementById('role-dna-list');
  const summary = document.getElementById('role-dna-summary');
  const title = document.getElementById('role-dna-title');
  const refresh = document.getElementById('role-dna-refresh');
  if (!modal || !list || !summary || !refresh) return;

  let roleId = null;
  let controller = null;
  let generation = 0;
  let busy = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g,
    char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const human = name => ({
    proposed: 'Dreaming 提案', 'evidence-added': '附加證據',
    'failure-recorded': '失敗／撤銷驗證', verify: '使用者確認',
    activate: '啟用技能', retire: '停用技能', 'more-sources': '新增來源',
    'runtime-check-passed': 'Runtime 檢查通過',
    'runtime-check-failed': 'Runtime 檢查失敗',
    'auto-activated': '自動啟用'
  })[name] || name;

  function card(skill) {
    const evidence = skill.evidence || [];
    const source = skill.sourceConversationIds || [];
    const isCandidate = skill.status === 'candidate';
    const isVerified = skill.status === 'verified';
    const isRetired = skill.status === 'retired';
    const lastFailure = evidence.findLastIndex(item => item.outcome === 'failed');
    const recentEvidence = evidence.slice(lastFailure + 1);
    const proofs = recentEvidence.filter(item =>
      ['test', 'ci'].includes(item.kind) && item.outcome === 'passed').length;
    const runtimePasses = new Set(recentEvidence.filter(item =>
      item.kind === 'runtime-check' && item.outcome === 'passed').map(item => item.reference)).size;
    const statusLabel = isCandidate
      ? '候選 · 未驗證 · 自動試用' + (runtimePasses ? ` · 檢查 ${Math.min(2, runtimePasses)}/2` : '')
        : isVerified ? '已確認證據 · 待啟用'
        : skill.status === 'active' && skill.verification?.method === 'runtime-observed'
          ? '已自動啟用 · 兩回合檢查通過'
          : skill.status === 'active' ? '已啟用 · 任務匹配時載入'
            : '已停用';
    const verificationLabel = skill.verification?.method === 'runtime-observed'
      ? 'Runtime 在 ' + (Number(skill.verification.successfulTurns) || 2) + ' 個不同回合觀察到符合此技能驗收類型的檢查命令成功；依實際退出碼判定，不代表檢查內容另經獨立審核。'
      : skill.verification?.method === 'user-attested'
        ? '使用者已確認；不等於 CI 或工具獨立驗證。'
        : '尚未確認。Dreaming 提案會在匹配任務中安全試用。';
    const evidenceKind = kind => kind === 'runtime-check' ? 'Runtime 檢查'
      : ({ test: '測試', ci: 'CI', commit: 'Commit', manual: '手動', failure: '失敗' })[kind] || kind;
    const runtimeCategory = category => ({
      test: '測試', syntax: '語法', lint: 'Lint', typecheck: '型別', build: '建置', diff: '差異'
    })[category] || category;
    return '<article class="role-dna-card" data-skill-id="' + esc(skill.id) + '">' +
      '<div class="role-dna-row"><strong>' + esc(skill.title) + '</strong>' +
        '<span class="role-dna-badge" data-state="' + esc(skill.status) + '">' +
          esc(statusLabel) + '</span></div>' +
      '<p>' + esc(skill.problem) + '</p>' +
      '<div class="role-dna-lines"><b>觸發條件</b><span>' + esc((skill.triggers || []).join(' · ')) + '</span></div>' +
      '<div class="role-dna-lines"><b>操作步驟</b><ol>' +
        (skill.steps || []).map(item => '<li>' + esc(item) + '</li>').join('') + '</ol></div>' +
      '<div class="role-dna-lines"><b>驗收檢查</b><ul>' +
        (skill.checks || []).map(item => '<li>' + esc(item) + '</li>').join('') + '</ul></div>' +
      '<details class="role-dna-proof"><summary>來源與檢查紀錄 · ' + evidence.length + ' 筆</summary>' +
        '<div><b>來源對話</b><p>' + (source.length ? source.map(esc).join('、') : '無來源') + '</p></div>' +
        '<div><b>啟用依據</b><p>' + esc(verificationLabel) + '</p></div>' +
        (evidence.length ? '<ul>' + evidence.map(item =>
          '<li><b>' + esc(evidenceKind(item.kind)) + ' / ' + esc(item.outcome) + '</b> · ' +
          esc(item.kind === 'runtime-check'
            ? '自動記錄 · ' + (item.categories || []).map(runtimeCategory).join('、')
            : item.reference) +
          '<small>' + esc(item.note || '') + '</small></li>').join('') +
          '</ul>' : '<p>沒有測試證據。</p>') +
      '</details>' +
      (!isRetired ? '<details class="role-dna-form"><summary>記錄測試 / Commit 證據</summary>' +
        '<div class="role-dna-form-fields">' +
          '<label>證據類型<select data-skill-kind>' +
            '<option value="test">測試結果（自行驗收）</option>' +
            '<option value="ci">CI 連結（自行確認）</option>' +
            '<option value="commit">Git commit</option>' +
            '<option value="manual">手動檢查備註</option>' +
            '<option value="failure">失敗紀錄</option>' +
          '</select></label>' +
          '<label>結果<select data-skill-outcome>' +
            '<option value="passed">通過</option><option value="failed">失敗</option>' +
            '<option value="informational">參考資訊</option></select></label>' +
          '<label>測試名稱 / Commit / CI URL<input maxlength="250" data-skill-ref placeholder="例如 npm test 或 SHA" /></label>' +
          '<label>說明<textarea data-skill-note maxlength="350" rows="2" placeholder="實際檢查了什麼？"></textarea></label>' +
          '<button type="button" data-skill-action="evidence">記錄證據</button>' +
          '<p class="role-dna-notice">只有 Test／CI 通過可供人工確認；Commit／手動備註只作參考。自動檢查則以 Runtime 工具回報的退出碼記錄。</p>' +
        '</div></details>' : '') +
      '<div class="role-dna-actions">' +
        (isCandidate ? '<button type="button" data-skill-action="verify" ' +
          (proofs ? '' : 'disabled ') + '>人工確認 Test/CI（' + proofs + '）</button>' : '') +
        (isVerified ? '<button type="button" data-skill-action="activate">啟用技能</button>' : '') +
        (!isRetired ? '<button type="button" data-skill-action="retire">停用</button>' : '') +
      '</div>' +
      '</article>';
  }
  function render(data) {
    const skills = data.skills || [];
    const active = skills.filter(skill => skill.status === 'active').length;
    const trial = skills.filter(skill => skill.status === 'candidate').length;
    summary.textContent = skills.length + ' 項技能 · ' + active +
      ' 已啟用 · ' + trial + ' 自動試用候選';
    list.innerHTML = skills.length
      ? '<p class="role-dna-notice">候選會在匹配任務時自動試用。符合技能驗收項目的檢查在不同回合中兩次通過，Runtime 會自動啟用；只計入工具明確回報退出碼的檢查。無法辨識驗收類型或沒有退出碼的情況會繼續試用。其他證據仍可由你確認。</p>' +
        skills.map(card).join('')
      : '<div class="role-dna-empty">尚無技能。Dreaming 整理到可重複的流程時，會提出候選；候選會在匹配任務時自動試用。</div>';
  }
  async function load() {
    if (!roleId) return;
    controller?.abort();
    const current = ++generation;
    controller = new AbortController();
    summary.textContent = '載入技能中…';
    try {
      const response = await fetch('/api/role-skills?role_id=' + encodeURIComponent(roleId), {
        cache: 'no-store', signal: controller.signal
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '技能讀取失敗');
      if (current === generation) render(data);
    } catch (error) {
      if (current === generation && error.name !== 'AbortError') {
        summary.textContent = '讀取失敗';
        list.textContent = error.message || '技能載入失敗';
      }
    }
  }
  async function submit(action, skillId, evidence) {
    if (!roleId || busy) return;
    const messages = {
      verify: '確認你已親自查核通過的測試證據？這不是自動測試驗證。',
      activate: '啟用此技能？之後只會在任務相關時提供給本 Role 使用。',
      retire: '停用此技能？停用後不會再載入工作 Context。'
    };
    if (messages[action] && !window.confirm(messages[action])) return;
    busy = true;
    summary.textContent = '儲存中…';
    try {
      const response = await fetch('/api/role-skills', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, roleId, skillId, ...(evidence ? { evidence } : {}) })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '更新失敗');
      render(data);
    } catch (error) {
      summary.textContent = '無法儲存：' + (error.message || '未知問題');
    } finally {
      busy = false;
    }
  }
  list.addEventListener('click', event => {
    const button = event.target.closest('[data-skill-action]');
    if (!button) return;
    const article = button.closest('[data-skill-id]');
    if (!article) return;
    const action = button.dataset.skillAction;
    let evidence;
    if (action === 'evidence') {
      evidence = {
        kind: article.querySelector('[data-skill-kind]').value,
        outcome: article.querySelector('[data-skill-outcome]').value,
        reference: article.querySelector('[data-skill-ref]').value.trim(),
        note: article.querySelector('[data-skill-note]').value.trim()
      };
      if (!evidence.reference || (evidence.kind === 'manual' && !evidence.note)) {
        summary.textContent = '請提供具體的測試名稱／參考資訊和必要說明。';
        return;
      }
      if (!window.confirm('確認這份結果是你實際檢查過的證據，而非 AI 自述？')) return;
    }
    submit(action, article.dataset.skillId, evidence);
  });
  refresh.addEventListener('click', load);
  window.RoleDNA = {
    open(role) {
      roleId = role?.id || null;
      title.textContent = (role?.name || 'Role') + ' · Skill DNA';
      load();
    },
    close() {
      roleId = null;
      controller?.abort();
      generation++;
    }
  };
})();
