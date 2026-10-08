// Completed AI replies are enhanced in place. Markdown remains the only stored source.
// Do not create a second reader, iframe, model call, or independent scroll surface.
(function () {
  'use strict';

  const PANEL_KINDS = [
    ['summary', /^(摘要|重點|概覽|總覽|executive summary|summary|overview|key findings|tl;?dr)\b/i],
    ['comparison', /^(比較|對比|方案比較|選項|comparison|alternatives?|options?|trade.?offs?)\b/i],
    ['risks', /^(風險|注意事項|限制|risks?|caveats?|limitations?|concerns?)\b/i],
    ['conclusion', /^(結論|建議|下一步|後續|行動項目|conclusions?|recommendations?|next steps?|action items?)\b/i],
    ['implementation', /^(實作|修改|變更|驗證|測試|implementation|changes?|validation|tests?|files?)\b/i]
  ];

  function visualAnswerEligible(content) {
    if (typeof content !== 'string' || content.length > 48000) return false;
    if (/(?:<!doctype\s+html|<html\b)/i.test(content)) return false;
    const prose = content.replace(/`{3,}[\s\S]*?`{3,}/g, '').trim();
    if (prose.length < 180) return false;
    const headings = (prose.match(/^#{1,3}\s+\S/gm) || []).length;
    const listItems = (prose.match(/^\s*[-*+]\s+\S/gm) || []).length;
    return (headings >= 2 || /^\|[^|\n]+\|[^|\n]+\|/m.test(prose) || listItems >= 4)
      || (prose.length > 700 && headings >= 1);
  }

  function sectionKind(title) {
    const normalized = String(title || '').trim().replace(/[：:。.!！?？]\s*$/, '');
    return PANEL_KINDS.find(([, pattern]) => pattern.test(normalized))?.[0] || 'detail';
  }

  function groupSections(container) {
    const topLevel = Array.from(container.children);
    const h2s = topLevel.filter(node => node.tagName === 'H2');
    if (!h2s.length || (h2s.length === 1 && container.textContent.length < 650)) return;

    // Move, never clone, existing safe Markdown nodes. Anchors and code remain intact.
    let panel = null;
    for (const node of Array.from(container.childNodes)) {
      if (node.nodeType === 1 && node.tagName === 'H2') {
        panel = document.createElement('section');
        panel.className = 'visual-answer-panel';
        panel.dataset.sectionKind = sectionKind(node.textContent);
        container.insertBefore(panel, node);
      }
      if (panel) panel.appendChild(node);
    }
  }

  function enhanceTables(container) {
    for (const table of container.querySelectorAll('table')) {
      if (table.closest('.table-wrapper, .visual-answer-table')) continue;
      const scroller = document.createElement('div');
      scroller.className = 'visual-answer-table';
      table.parentNode.insertBefore(scroller, table);
      scroller.appendChild(table);
    }
  }

  function enhanceContent(container, markdown) {
    if (!container || container.dataset.visualEnhanced === 'true') return;
    container.dataset.visualEnhanced = 'true';
    container.classList.add('visual-answer-content');
    const headingCount = (String(markdown).match(/^#{1,3}\s+\S/gm) || []).length;
    if (headingCount >= 2) container.classList.add('visual-answer-report');
    groupSections(container);
    enhanceTables(container);
    for (const heading of container.querySelectorAll('h2, h3')) {
      heading.classList.add('visual-answer-heading');
    }
  }

  function attachVisualAnswerAction(messageNode, rawMarkdown, options = {}) {
    if (!messageNode || options.failed || !visualAnswerEligible(rawMarkdown)) return;
    const article = messageNode.querySelector('.assistant-article');
    if (!article) return;

    const card = article.querySelector('.execution-result-card');
    const decorate = () => {
      const response = card ? article.querySelector('.execution-result-response') : article;
      if (!response) return false;
      enhanceContent(response.querySelector('.msg-content'), rawMarkdown);
      return true;
    };

    if (decorate() || !card || card.dataset.visualWaiting === 'true') return;
    // Historical task cards hydrate only when expanded; reuse their sole reply.
    card.dataset.visualWaiting = 'true';
    card.addEventListener('toggle', () => {
      if (card.open) decorate();
    });
  }

  window.attachVisualAnswerAction = attachVisualAnswerAction;
  window.visualAnswerEligible = visualAnswerEligible;
  window.visualAnswerSectionKind = sectionKind;
})();
