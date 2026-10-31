/* Upgrade ordinary completed Markdown to bounded, draft-only inline actions.
 * This module never sends messages, evaluates model code, infers tool success,
 * or replaces the original report/list/table DOM.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.CrewReplyDiscovery = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  const OPTION_RE = /^(?:方案|選項|option)\s*[-#]?\s*([A-D甲乙丙丁一二三四1-6])(?=$|[\s:：、.．)）(\（\-—])/i;
  const COMPARISON_RE = /^(?:方案比較|方案選擇|比較方案|比較|選項|對比|comparison|options?|alternatives?|trade.?offs?)(?=$|[\s:：、\-—])/i;
  const NEXT_RE = /^(?:下一步|後續工作|待辦事項?|待辦|行動項目|next steps?|action items?|to.?do)(?=$|[\s:：、\-—])/i;

  const clean = (raw, max) => {
    if (typeof raw !== 'string') return null;
    const value = raw.trim().replace(/\s+/g, ' ');
    return value && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
  };
  const titleOf = node => clean(node?.textContent, 90);
  const ownHeading = (group, tag) => {
    if (group.classList?.contains('visual-answer-panel')) {
      const child = [...(group.children || [])].find(item => item.tagName === tag.toUpperCase());
      return child || null;
    }
    return [...(group.children || [])].find(item => item.tagName === tag.toUpperCase()) || null;
  };

  function optionLabel(raw) {
    const title = clean(raw, 90);
    if (!title) return null;
    return OPTION_RE.test(title) ? title : null;
  }

  function optionCandidates(group) {
    const heading = ownHeading(group, 'h2');
    const section = titleOf(heading) || '';
    const comparison = COMPARISON_RE.test(section) ||
      group.dataset?.sectionKind === 'comparison';
    const h3s = [...group.querySelectorAll('h3')].filter(node =>
      !node.closest?.('pre, blockquote, .crew-interactive, .crew-auto-actions'));
    const headings = h3s.map(node => optionLabel(node.textContent)).filter(Boolean);
    if (headings.length >= 2 && headings.length <= 6 &&
        new Set(headings).size === headings.length) {
      return { title: section || '方案選擇', labels: headings };
    }
    if (!comparison) return null;

    // Comparisons written as Markdown lists, without changing their list items.
    for (const list of group.querySelectorAll('ul, ol')) {
      if (list.closest?.('pre, blockquote, .crew-interactive')) continue;
      const items = [...(list.children || [])];
      if (items.length < 2 || items.length > 6 ||
          items.some(item => item.tagName !== 'LI' || item.querySelector?.('ul, ol, pre'))) continue;
      const labels = items.map(item => optionLabel(item.textContent));
      if (labels.every(Boolean) && new Set(labels).size === labels.length)
        return { title: section, labels };
    }

    // A 2-column or multi-column Markdown comparison table, with explicit
    // option labels in the first data column, can be selected just as safely.
    for (const table of group.querySelectorAll('table')) {
      const rows = [...table.querySelectorAll('tr')];
      if (rows.length < 3 || rows.length > 7) continue;
      const dataRows = rows.filter(row => row.querySelector('td'));
      const labels = dataRows.map(row => optionLabel(row.querySelector('td')?.textContent));
      if (labels.length >= 2 && labels.length <= 6 && labels.every(Boolean) &&
          new Set(labels).size === labels.length) return { title: section, labels };
    }
    return null;
  }

  function checklistCandidates(group) {
    const section = titleOf(ownHeading(group, 'h2')) || '';
    if (!NEXT_RE.test(section)) return null;
    for (const list of group.querySelectorAll('ul, ol')) {
      if (list.closest?.('pre, blockquote, .crew-interactive, .crew-auto-actions')) continue;
      const items = [...(list.children || [])];
      if (items.length < 2 || items.length > 8 || items.some(item =>
        item.tagName !== 'LI' || item.querySelector?.('ul, ol, pre, code, input, button'))) continue;
      const labels = items.map(item => clean(item.textContent, 130));
      if (labels.every(Boolean)) return { title: section, list, items, labels };
    }
    return null;
  }

  function element(tag, className = '', value = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value) node.textContent = value;
    return node;
  }
  function feedbackArea(bar) {
    const feedback = element('p', 'crew-interactive-feedback');
    feedback.setAttribute('role', 'status');
    feedback.setAttribute('aria-live', 'polite');
    bar.appendChild(feedback);
    return feedback;
  }
  function choiceDraft(section, label) {
    return '請針對剛才回覆的「' + section + '」，選擇「' + label +
      '」作為後續方向，先確認需要做的事情與影響，再繼續處理。';
  }
  function checklistDraft(section, labels) {
    return '請根據剛才回覆的「' + section + '」，繼續處理我勾選的項目：\n' +
      labels.map(label => '- ' + label).join('\n');
  }

  function addChoices(group, { title, labels }, context, draft) {
    const bar = element('div', 'crew-auto-actions');
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', '可選擇的方案');
    bar.appendChild(element('p', 'crew-auto-label', '選一個方案繼續'));
    const chips = element('div', 'crew-auto-chips');
    const feedback = feedbackArea(bar);
    labels.forEach(label => {
      const button = element('button', 'crew-auto-chip', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        if (draft(choiceDraft(title, label), context, bar)) {
          [...chips.children].forEach(node => node.setAttribute('aria-pressed', String(node === button)));
        }
      });
      chips.appendChild(button);
    });
    bar.insertBefore(chips, feedback);
    group.appendChild(bar);
    return bar;
  }

  function addChecklist(group, { title, list, items, labels }, context, draft) {
    const bar = element('div', 'crew-auto-actions crew-auto-checklist');
    const feedback = feedbackArea(bar);
    items.forEach((item, index) => {
      const checkbox = element('input', 'crew-auto-checkbox');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', '選取待辦項目：' + labels[index]);
      item.insertBefore(checkbox, item.firstChild || null);
      item.classList.add('crew-auto-task');
    });
    const button = element('button', 'crew-auto-apply', '依勾選項目繼續');
    button.type = 'button';
    button.addEventListener('click', () => {
      const checked = items.map((item, index) =>
        item.querySelector('.crew-auto-checkbox')?.checked ? labels[index] : null).filter(Boolean);
      if (!checked.length) {
        feedback.textContent = '請先勾選要繼續處理的項目。';
        return;
      }
      draft(checklistDraft(title, checked), context, bar);
    });
    bar.insertBefore(button, feedback);
    group.appendChild(bar);
    return bar;
  }

  function enhance(container, context, draft) {
    if (!container || typeof draft !== 'function') return 0;
    const panels = [...container.querySelectorAll('.visual-answer-panel')];
    const groups = panels.length ? panels : [container];
    let count = 0;
    let choicesShown = false;
    let checklistShown = false;
    for (const group of groups) {
      if (count >= 2) break;
      if (group.dataset?.crewAutoEnhanced || group.querySelector('.crew-interactive')) continue;
      if (!choicesShown) {
        const options = optionCandidates(group);
        if (options) {
          addChoices(group, options, context, draft);
          group.dataset.crewAutoEnhanced = 'choice';
          choicesShown = true;
          count++;
          continue;
        }
      }
      if (!checklistShown) {
        const checklist = checklistCandidates(group);
        if (checklist) {
          addChecklist(group, checklist, context, draft);
          group.dataset.crewAutoEnhanced = 'checklist';
          checklistShown = true;
          count++;
        }
      }
    }
    return count;
  }

  return { optionLabel, optionCandidates, checklistCandidates, choiceDraft, checklistDraft, enhance };
});
