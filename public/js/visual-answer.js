// Visual Answer is a derivative reading surface. Markdown remains the source of truth.
// Render only when a user expands a completed response; never modify conversation data.
(function () {
  'use strict';

  const MAX_SAVED_PAGES = 8;
  const MAX_SAVED_VIEWS = 24;
  const pageCache = new Map();
  const openByConversation = new Map();
  let activeInline = null;
  let modal = null;
  let modalOpener = null;

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

  function visualContextKey(options = {}) {
    // Every Role owns its own conversations. Never use an unscoped message hash.
    const roleId = String(options.roleId || (window.getCurrentRoleId && window.getCurrentRoleId()) || 'default');
    const provider = String(options.provider || 'codex');
    const conversationId = String(options.conversationId || 'draft');
    return JSON.stringify([roleId, provider, conversationId]);
  }

  function fingerprint(markdown) {
    // Bounded, deterministic identity: no source content is persisted in storage.
    let hash = 2166136261;
    for (let i = 0; i < markdown.length; i++) {
      hash ^= markdown.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return markdown.length + ':' + (hash >>> 0).toString(16);
  }

  function remember(map, key, value, limit) {
    map.delete(key);
    map.set(key, value);
    while (map.size > limit) map.delete(map.keys().next().value);
  }

  function clearFrame(frame) {
    if (!frame) return;
    frame.removeAttribute('srcdoc');
  }

  function collapseInline(view, { keepSelection = false } = {}) {
    if (!view || view.panel.hidden) return;
    view.panel.hidden = true;
    view.button.setAttribute('aria-expanded', 'false');
    view.button.textContent = '◇ 視覺化閱讀  ↓';
    if (view.controller) {
      view.controller.abort();
      view.controller = null;
    }
    clearFrame(view.frame);
    if (!keepSelection && openByConversation.get(view.scope) === view.signature) {
      openByConversation.delete(view.scope);
    }
    if (activeInline === view) activeInline = null;
  }

  function showInline(view, { restore = false } = {}) {
    if (!view.panel.hidden) {
      if (!restore) collapseInline(view);
      return;
    }
    if (activeInline && activeInline !== view) {
      // Switching Role/Conversation should keep that Role's remembered selection;
      // opening a second answer in the same conversation replaces the first.
      collapseInline(activeInline, { keepSelection: activeInline.scope !== view.scope });
    }

    activeInline = view;
    remember(openByConversation, view.scope, view.signature, MAX_SAVED_VIEWS);
    view.panel.hidden = false;
    view.button.setAttribute('aria-expanded', 'true');
    view.button.textContent = '◇ 收合視覺化  ↑';
    view.status.hidden = false;
    view.status.textContent = '正在整理閱讀版面…';
    view.frame.hidden = true;

    const saved = pageCache.get(view.cacheKey);
    if (saved) {
      remember(pageCache, view.cacheKey, saved, MAX_SAVED_PAGES);
      displayInline(view, saved);
      return;
    }

    const controller = new AbortController();
    view.controller = controller;
    fetch('/api/visual-answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: view.markdown }),
      cache: 'no-store',
      signal: controller.signal
    }).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.success || !result.html) {
        throw new Error(result.error || '視覺化渲染失敗');
      }
      if (controller.signal.aborted) return;
      remember(pageCache, view.cacheKey, result.html, MAX_SAVED_PAGES);
      if (view.panel.isConnected && !view.panel.hidden && activeInline === view) {
        displayInline(view, result.html);
      }
    }).catch(error => {
      if (controller.signal.aborted || view.panel.hidden || !view.panel.isConnected) return;
      view.frame.hidden = true;
      view.status.hidden = false;
      view.status.textContent = (error.message || '視覺化暫不可用') + '。原始回答仍可正常閱讀。';
    }).finally(() => {
      if (view.controller === controller) view.controller = null;
    });
  }

  function displayInline(view, html) {
    if (!view.panel.isConnected || view.panel.hidden) return;
    view.frame.srcdoc = html;
    view.frame.hidden = false;
    view.status.hidden = true;
  }

  async function copyOriginal(button, content) {
    try {
      await navigator.clipboard.writeText(content);
      button.textContent = '已複製';
    } catch (_) {
      button.textContent = '無法複製';
    }
    setTimeout(() => {
      if (button.isConnected) button.textContent = '複製原文';
    }, 1200);
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
      '<iframe title="AI 視覺化閱讀內容（全螢幕）" sandbox="" referrerpolicy="no-referrer"></iframe>',
      '</div>'
    ].join('');
    document.body.appendChild(modal);
    modal.querySelector('.visual-answer-back').addEventListener('click', closeModal);
    window.addEventListener('keydown', event => {
      if (event.key === 'Escape' && modal && !modal.hidden) closeModal();
    });
    return modal;
  }

  function closeModal() {
    if (!modal || modal.hidden) return;
    modal.hidden = true;
    clearFrame(modal.querySelector('iframe'));
    if (modalOpener && modalOpener.isConnected) modalOpener.focus({ preventScroll: true });
    modalOpener = null;
  }

  function showFullscreen(view, button) {
    const html = pageCache.get(view.cacheKey);
    if (!html) return;
    const root = ensureModal();
    modalOpener = button;
    root.querySelector('iframe').srcdoc = html;
    root.querySelector('.visual-answer-copy').onclick = () => {
      copyOriginal(root.querySelector('.visual-answer-copy'), view.markdown);
    };
    root.querySelector('.visual-answer-copy').textContent = '複製原文';
    root.hidden = false;
    root.querySelector('.visual-answer-back').focus({ preventScroll: true });
  }

  function attachVisualAnswerAction(messageNode, rawMarkdown, options = {}) {
    if (!messageNode || !visualAnswerEligible(rawMarkdown) || options.failed) return;
    const article = messageNode.querySelector('.assistant-article');
    if (!article || article.querySelector('.visual-answer-launch')) return;

    const scope = visualContextKey(options);
    const signature = fingerprint(rawMarkdown);
    const cacheKey = scope + ':' + signature;
    const actions = document.createElement('div');
    actions.className = 'visual-answer-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'visual-answer-launch';
    button.textContent = '◇ 視覺化閱讀  ↓';
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', '在回覆下方展開視覺化閱讀');
    actions.appendChild(button);

    const panel = document.createElement('section');
    panel.className = 'visual-answer-inline';
    panel.hidden = true;
    const panelId = 'visual-answer-' + Math.random().toString(36).slice(2, 10);
    panel.id = panelId;
    button.setAttribute('aria-controls', panelId);
    panel.innerHTML = [
      '<div class="visual-answer-inline-toolbar">',
      '<span class="visual-answer-inline-title">閱讀版面</span>',
      '<button type="button" class="visual-answer-inline-copy">複製原文</button>',
      '<button type="button" class="visual-answer-inline-fullscreen" disabled>全螢幕</button>',
      '</div>',
      '<div class="visual-answer-inline-body">',
      '<div class="visual-answer-inline-status" role="status" aria-live="polite">正在整理閱讀版面…</div>',
      '<iframe title="AI 視覺化閱讀內容" sandbox="" referrerpolicy="no-referrer" hidden></iframe>',
      '</div>'
    ].join('');

    article.appendChild(actions);
    article.appendChild(panel);
    const view = {
      markdown: rawMarkdown,
      scope,
      signature,
      cacheKey,
      button,
      panel,
      frame: panel.querySelector('iframe'),
      status: panel.querySelector('.visual-answer-inline-status'),
      controller: null
    };
    const fullscreenButton = panel.querySelector('.visual-answer-inline-fullscreen');

    // The full-screen affordance only activates after the page is rendered.
    const existingDisplayInline = displayInline;
    // Enable it when cached HTML is already available or when an iframe loads.
    view.frame.addEventListener('load', () => {
      if (!view.panel.hidden && view.frame.hasAttribute('srcdoc')) fullscreenButton.disabled = false;
    });
    button.addEventListener('click', () => showInline(view));
    panel.querySelector('.visual-answer-inline-copy').addEventListener('click', event => {
      copyOriginal(event.currentTarget, rawMarkdown);
    });
    fullscreenButton.addEventListener('click', () => showFullscreen(view, fullscreenButton));

    // Each Role's last open response can be restored after navigation rebuilds
    // message DOM. No page is produced unless that exact answer was opened.
    if (openByConversation.get(scope) === signature) {
      showInline(view, { restore: true });
    }
  }

  window.attachVisualAnswerAction = attachVisualAnswerAction;
  window.visualAnswerEligible = visualAnswerEligible;
})();
