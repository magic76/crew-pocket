// Visual Answer is an optional, non-destructive reading view.
// It never changes the streamed Markdown, conversation state or Role memory.
(function () {
  'use strict';

  let modal = null;
  let activeRequest = null;
  let opener = null;

  function visualAnswerEligible(content) {
    if (typeof content !== 'string' || content.length > 48000) return false;
    if (/(?:<!doctype\s+html|<html\b)/i.test(content)) return false;
    const prose = content.replace(/\x60{3,}[\s\S]*?\x60{3,}/g, '').trim();
    if (prose.length < 180) return false;
    const headings = (prose.match(/^#{1,3}\s+\S/gm) || []).length;
    const listItems = (prose.match(/^\s*[-*+]\s+\S/gm) || []).length;
    const hasTable = /^\|[^|\n]+\|[^|\n]+\|/m.test(prose);
    const hasDiagram = /^\s*\x60{3}(?:flow|sequence|tree|timeline|kv|limits|callout)\b/im.test(content);
    return hasDiagram || (prose.length > 260 && (headings >= 2 || hasTable || listItems >= 4))
      || (prose.length > 700 && headings >= 1);
  }

  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'visual-answer-modal';
    modal.className = 'visual-answer-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', '視覺化閱讀');
    modal.innerHTML = [
      '<div class="visual-answer-toolbar">',
      '<button type="button" class="visual-answer-back" aria-label="返回對話">‹ <span>返回對話</span></button>',
      '<div class="visual-answer-toolbar-title">視覺化閱讀</div>',
      '<button type="button" class="visual-answer-copy">複製原文</button>',
      '</div>',
      '<div class="visual-answer-view">',
      '<div class="visual-answer-status" role="status" aria-live="polite">正在整理閱讀版面…</div>',
      '<iframe title="AI 視覺化閱讀內容" sandbox="" referrerpolicy="no-referrer"></iframe>',
      '</div>'
    ].join('');
    document.body.appendChild(modal);
    modal.querySelector('.visual-answer-back').addEventListener('click', closeVisualAnswer);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modal && !modal.hidden) closeVisualAnswer();
    });
    return modal;
  }

  function closeVisualAnswer() {
    if (!modal || modal.hidden) return;
    if (activeRequest) {
      activeRequest.abort();
      activeRequest = null;
    }
    modal.hidden = true;
    const frame = modal.querySelector('iframe');
    frame.removeAttribute('srcdoc');
    frame.style.display = 'none';
    if (opener && opener.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }

  async function showVisualAnswer(source, button) {
    const root = ensureModal();
    if (activeRequest) activeRequest.abort();
    const controller = new AbortController();
    activeRequest = controller;
    opener = button;
    root.hidden = false;
    const frame = root.querySelector('iframe');
    const status = root.querySelector('.visual-answer-status');
    const copy = root.querySelector('.visual-answer-copy');
    frame.style.display = 'none';
    frame.removeAttribute('srcdoc');
    status.hidden = false;
    status.textContent = '正在整理閱讀版面…';
    root.querySelector('.visual-answer-back').focus({ preventScroll: true });

    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(source);
        copy.textContent = '已複製';
        setTimeout(() => { if (modal && !modal.hidden) copy.textContent = '複製原文'; }, 1200);
      } catch (e) {
        copy.textContent = '無法複製';
      }
    };
    copy.textContent = '複製原文';

    try {
      const response = await fetch('/api/visual-answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: source }),
        cache: 'no-store',
        signal: controller.signal
      });
      const result = await response.json();
      if (!response.ok || !result.success || !result.html) {
        throw new Error(result.error || '視覺化渲染失敗');
      }
      if (controller.signal.aborted || activeRequest !== controller) return;
      frame.srcdoc = result.html;
      frame.style.display = 'block';
      status.hidden = true;
    } catch (error) {
      if (controller.signal.aborted || activeRequest !== controller) return;
      status.textContent = (error.message || '視覺化暫不可用') + '。原始 Markdown 回覆不受影響。';
    } finally {
      if (activeRequest === controller) activeRequest = null;
    }
  }

  function attachVisualAnswerAction(messageNode, rawMarkdown, options) {
    if (!messageNode || !visualAnswerEligible(rawMarkdown) || (options && options.failed)) return;
    const article = messageNode.querySelector('.assistant-article');
    if (!article || article.querySelector('.visual-answer-launch')) return;
    const actions = document.createElement('div');
    actions.className = 'visual-answer-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'visual-answer-launch';
    button.textContent = '◇ 視覺化閱讀';
    button.setAttribute('aria-label', '將此回覆轉成視覺化閱讀頁面');
    button.addEventListener('click', () => showVisualAnswer(rawMarkdown, button));
    actions.appendChild(button);
    article.appendChild(actions);
  }

  window.attachVisualAnswerAction = attachVisualAnswerAction;
  window.visualAnswerEligible = visualAnswerEligible;
})();
