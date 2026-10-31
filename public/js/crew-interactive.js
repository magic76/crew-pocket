/* Native, declarative widgets for completed Crew replies. No model HTML/JS runs.
 * Only a validated crew-ui JSON code fence can become an interactive card.
 * Actions fill the current Role's composer; sending remains a separate user step.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewInteractive = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[ch]));
  const plain = (value, max) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= max && !/[\u0000-\u001f\u007f]/.test(trimmed) ? trimmed : null;
  };
  const record = value => value && typeof value === 'object' && !Array.isArray(value);

  function normalizeSpec(value) {
    if (!record(value) || value.version !== 1) return null;
    const title = plain(value.title, 90);
    if (!title) return null;
    const question = value.question == null ? '' : plain(value.question, 220);
    if (question === null) return null;
    if (value.type === 'choice') {
      if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 8) return null;
      const options = value.options.map(item => {
        if (!record(item)) return null;
        const label = plain(item.label, 72);
        const answer = item.value == null ? label : plain(item.value, 320);
        return label && answer ? { label, value: answer } : null;
      });
      return options.every(Boolean) ? { version: 1, type: 'choice', title, question, options } : null;
    }
    if (value.type === 'checklist') {
      if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 12) return null;
      const items = value.items.map(item => plain(typeof item === 'string' ? item : item?.label, 160));
      return items.every(Boolean) ? { version: 1, type: 'checklist', title, question, items } : null;
    }
    if (value.type === 'metrics') {
      if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 4) return null;
      const items = value.items.map(item => {
        if (!record(item)) return null;
        const label = plain(item.label, 46);
        const display = plain(item.value, 46);
        return label && display ? { label, value: display } : null;
      });
      return items.every(Boolean) ? { version: 1, type: 'metrics', title, question, items } : null;
    }
    return null;
  }

  function parseSpec(raw) {
    if (typeof raw !== 'string' || raw.length > 5000) return null;
    try { return normalizeSpec(JSON.parse(raw)); } catch (_) { return null; }
  }

  let nextId = 0;
  function widgetHtml(spec) {
    const heading = '<div class="crew-interactive-heading"><strong>' + escapeHtml(spec.title) + '</strong>' +
      '<span>互動卡片</span></div>';
    const hint = spec.question ? '<p class="crew-interactive-question">' + escapeHtml(spec.question) + '</p>' : '';
    if (spec.type === 'metrics') {
      return heading + hint + '<div class="crew-interactive-metrics">' + spec.items.map(item =>
        '<div class="crew-interactive-metric"><strong>' + escapeHtml(item.value) + '</strong><span>' +
        escapeHtml(item.label) + '</span></div>').join('') + '</div>';
    }
    const name = 'crew-interactive-choice-' + (++nextId);
    const choices = spec.type === 'choice' ? spec.options.map((option, index) =>
      '<label class="crew-interactive-option"><input type="radio" name="' + name +
      '" data-crew-selection="' + index + '"><span>' + escapeHtml(option.label) + '</span></label>').join('')
      : spec.items.map((item, index) =>
      '<label class="crew-interactive-option"><input type="checkbox" data-crew-selection="' + index +
      '"><span>' + escapeHtml(item) + '</span></label>').join('');
    return heading + hint + '<div class="crew-interactive-options">' + choices + '</div>' +
      '<div class="crew-interactive-actions"><button type="button" data-crew-draft-action="selection">填入輸入框</button>' +
      '<span class="crew-interactive-footnote">確認內容後再發送</span></div>' +
      '<p class="crew-interactive-feedback" role="status" aria-live="polite"></p>';
  }

  function buildDraft(spec, indices) {
    if (!spec || !Array.isArray(indices) || !indices.length) return '';
    const header = '針對上一則回覆的「' + spec.title + '」：';
    const question = spec.question ? '\n' + spec.question : '';
    if (spec.type === 'choice') {
      const choice = spec.options[indices[0]];
      return choice ? header + question + '\n我選擇：' + choice.value : '';
    }
    if (spec.type === 'checklist') {
      const choices = indices.map(index => spec.items[index]).filter(Boolean);
      return choices.length ? header + question + '\n請協助處理以下項目：\n' +
        choices.map(item => '- ' + item).join('\n') : '';
    }
    return '';
  }

  function setFeedback(widget, message) {
    const node = widget.querySelector('.crew-interactive-feedback');
    if (node) node.textContent = message;
  }

  function fillComposer(text, context, widget) {
    const win = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    const input = doc?.getElementById('prompt-input');
    if (!input || !text) return false;
    if (typeof win?.crewInteractiveContextMatches === 'function' && !win.crewInteractiveContextMatches(context)) {
      setFeedback(widget, '已切換角色或工作，請回到原對話再操作。');
      return false;
    }
    if (input.value.trim() && input.value.trim() !== text) {
      setFeedback(widget, '輸入框已有草稿，請先送出或清空，避免覆蓋。');
      return false;
    }
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    setFeedback(widget, '已填入，請檢查內容後按發送。');
    return true;
  }

  function mount(pre, spec, context) {
    const widget = document.createElement('section');
    widget.className = 'crew-interactive';
    widget.dataset.crewInteractive = spec.type;
    widget.setAttribute('aria-label', spec.title);
    widget.innerHTML = widgetHtml(spec);
    if (spec.type !== 'metrics') {
      widget.addEventListener('click', event => {
        const button = event.target.closest('[data-crew-draft-action="selection"]');
        if (!button) return;
        const inputs = [...widget.querySelectorAll('input[data-crew-selection]:checked')];
        const indices = inputs.map(input => Number(input.dataset.crewSelection))
          .filter(index => Number.isInteger(index));
        if (!indices.length) {
          setFeedback(widget, spec.type === 'choice' ? '請先選擇一個方案。' : '請至少勾選一個項目。');
          return;
        }
        fillComposer(buildDraft(spec, indices), context, widget);
      });
    }
    pre.replaceWith(widget);
  }

  function sectionActions(container, context) {
    const panels = [...container.querySelectorAll('.visual-answer-panel')];
    if (panels.length < 2) return;
    panels.slice(0, 6).forEach(panel => {
      const heading = panel.querySelector('h2');
      if (!heading || heading.dataset.crewFollowup === 'true') return;
      const title = plain(heading.textContent, 90);
      if (!title) return;
      heading.dataset.crewFollowup = 'true';
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'crew-interactive-followup';
      button.textContent = '追問這段';
      button.setAttribute('aria-label', '追問：' + title);
      button.addEventListener('click', () => {
        fillComposer('請針對剛才回覆的「' + title + '」這一節進一步說明。', context, panel);
      });
      const feedback = document.createElement('p');
      feedback.className = 'crew-interactive-feedback';
      feedback.setAttribute('role', 'status');
      feedback.setAttribute('aria-live', 'polite');
      heading.insertAdjacentElement('afterend', button);
      button.insertAdjacentElement('afterend', feedback);
    });
  }

  function enhance(container, context = {}) {
    if (!container) return 0;
    let count = 0;
    for (const code of container.querySelectorAll('pre > code.language-crew-ui')) {
      if (count >= 5) break;
      const pre = code.parentElement;
      if (!pre || pre.dataset.crewInteractiveTried) continue;
      pre.dataset.crewInteractiveTried = 'true';
      const spec = parseSpec(code.textContent || '');
      if (!spec) continue; // Invalid/unsupported data remains visible as ordinary code.
      mount(pre, spec, context);
      count++;
    }
    sectionActions(container, context);
    return count;
  }

  return { normalizeSpec, parseSpec, buildDraft, widgetHtml, enhance };
});
