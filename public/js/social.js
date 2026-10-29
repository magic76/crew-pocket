(() => {
  const state = {
    status: null,
    activePlatform: 'facebook',
    facebookPages: [],
    facebookPosts: [],
    facebookComments: [],
    facebookReplies: {},
    facebookCommentsPostId: '',
    threadsPosts: [],
    threadsReplies: [],
    threadsRepliesThreadId: '',
    busy: new Set(),
    confirmation: null,
    pagination: {
      facebookPages: { after: '', hasMore: false },
      facebookPosts: { after: '', hasMore: false },
      facebookComments: { after: '', hasMore: false },
      threadsPosts: { after: '', hasMore: false },
      threadsReplies: { after: '', hasMore: false }
    },
    compose: {
      facebook: { mode: '', targetId: '', targetType: '', targetText: '', targetLabel: '' },
      threads: { mode: '', targetId: '', targetType: '', targetText: '', targetLabel: '' }
    }
  };

  const byId = id => document.getElementById(id);
  const platformLabel = platform => platform === 'facebook' ? 'Facebook 粉絲專頁' : 'Threads';

  async function request(path, options = {}) {
    const response = await fetch(path, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    let data = {};
    try { data = await response.json(); } catch (_) {}
    if (!response.ok || data.success === false) throw new Error(data.error || '社群 API 請求失敗');
    return data;
  }

  function post(path, body) {
    return request(path, { method: 'POST', body: JSON.stringify(body || {}) });
  }

  function showStatus(message, isError = false) {
    const box = byId('social-operation-status');
    if (!box) return;
    box.textContent = String(message || '');
    box.classList.remove('hidden', 'border-rose-500/40', 'text-rose-200', 'border-slate-800', 'text-slate-300');
    box.classList.add(isError ? 'border-rose-500/40' : 'border-slate-800', isError ? 'text-rose-200' : 'text-slate-300');
  }

  function clearStatus() {
    const box = byId('social-operation-status');
    if (box) box.classList.add('hidden');
  }

  function setBusy(key, value) {
    if (value) state.busy.add(key);
    else state.busy.delete(key);
    updateControls();
  }

  function providerStatus(platform) {
    return state.status?.providers?.[platform] || null;
  }

  function updateMoreButton(id, page, busyKey) {
    const button = byId(id);
    if (!button) return;
    const busy = state.busy.has(busyKey);
    button.classList.toggle('hidden', !page.hasMore);
    button.disabled = busy;
    button.textContent = busy ? '載入中…' : (button.dataset.moreLabel || '載入更多');
    button.classList.toggle('opacity-50', busy);
  }

  function updateControls() {
    for (const platform of ['facebook', 'threads']) {
      const info = providerStatus(platform);
      const compose = state.compose[platform];
      const prefix = 'social-' + platform;
      const connected = Boolean(info?.connected && !info?.expired);
      const saveButton = byId(prefix + '-save-config');
      const connectButton = byId(prefix + '-connect');
      const disconnectButton = byId(prefix + '-disconnect');
      const newPostButton = byId(prefix + '-new-post');
      const loadPostsButton = byId(prefix + '-load-posts');
      const loadPagesButton = platform === 'facebook' ? byId('social-facebook-load-pages') : null;
      const draftButton = byId(prefix + '-draft');
      const publishButton = byId(prefix + '-publish');
      const pageSelect = platform === 'facebook' ? byId('social-facebook-page') : null;
      const pageReady = platform !== 'facebook' || Boolean(info?.selectedPage?.id);
      const tasks = new Set((info?.selectedPage?.tasks || []).map(task => String(task).toUpperCase()));
      const requiredTasks = compose.mode === 'reply' ? ['MODERATE', 'MANAGE'] : ['CREATE_CONTENT', 'MANAGE'];
      const pageTaskReady = platform !== 'facebook' || !tasks.size || requiredTasks.some(task => tasks.has(task));
      const busy = state.busy.has(platform + ':draft') || state.busy.has(platform + ':publish');

      if (saveButton) saveButton.disabled = state.busy.has(platform + ':config');
      if (connectButton) connectButton.disabled = !info?.configured || Boolean(info.configurationError) || state.busy.has(platform + ':connect');
      if (disconnectButton) disconnectButton.classList.toggle('hidden', !info?.connected);
      if (newPostButton) newPostButton.disabled = !connected || !pageReady;
      if (loadPostsButton) loadPostsButton.disabled = !connected || !pageReady || state.busy.has(platform + ':load');
      if (loadPagesButton) loadPagesButton.disabled = !connected || state.busy.has('facebook:pages');
      if (draftButton) draftButton.disabled = !connected || !compose.mode || (compose.mode === 'reply' && !compose.targetId) || busy;
      if (publishButton) publishButton.disabled = !connected || !pageReady || !pageTaskReady || !compose.mode || (compose.mode === 'reply' && !compose.targetId) || busy;
      if (pageSelect) pageSelect.disabled = !connected || state.busy.has('facebook:pages');
      for (const button of [saveButton, connectButton, newPostButton, loadPostsButton, loadPagesButton, draftButton, publishButton, pageSelect]) {
        if (button) button.classList.toggle('opacity-50', Boolean(button.disabled));
      }
    }
    updateMoreButton('social-facebook-more-posts', state.pagination.facebookPosts, 'facebook:load');
    updateMoreButton('social-facebook-more-pages', state.pagination.facebookPages, 'facebook:pages');
    updateMoreButton('social-facebook-more-comments', state.pagination.facebookComments, 'facebook:comments');
    updateMoreButton('social-threads-more-posts', state.pagination.threadsPosts, 'threads:load');
    updateMoreButton('social-threads-more-replies', state.pagination.threadsReplies, 'threads:replies');
  }

  function displayProviderStatus(platform, info) {
    const label = byId('social-' + platform + '-status');
    const connectButton = byId('social-' + platform + '-connect');
    const badge = byId('social-workbench-status');
    const suffix = info?.oauth?.message ? ' · ' + info.oauth.message : '';
    if (label) {
      if (info?.configurationError) label.textContent = 'OAuth 回呼設定錯誤：' + info.configurationError;
      else if (!info?.configured) label.textContent = info?.appId
        ? '請在 Termux 執行 node scripts/configure-social-secret.cjs ' + platform
        : '先儲存 Meta App ID';
      else if (info.expired) label.textContent = '登入已過期，請重新連接' + suffix;
      else if (info.connected && platform === 'facebook') {
        label.textContent = '登入帳號：' + (info.identity || 'Meta 帳號') + ' · 操作粉專：' + (info.selectedPage?.name || '尚未選擇') + suffix;
      }
      else if (info.connected) label.textContent = '已連線：' + (info.identity || 'Threads 帳號') + suffix;
      else label.textContent = info.oauth?.status === 'pending' ? '等待瀏覽器完成授權…' : '尚未連線' + suffix;
    }
    if (connectButton) connectButton.textContent = info?.connected ? '重新連接' : '連接 ' + (platform === 'facebook' ? 'Facebook' : 'Threads');
    if (platform === 'facebook') {
      const select = byId('social-facebook-page');
      if (select && info?.selectedPage?.id && !select.value) select.value = info.selectedPage.id;
    }
    if (badge) {
      const anyConnected = ['facebook', 'threads'].some(id => {
        const provider = state.status?.providers?.[id];
        return provider?.connected && !provider.expired;
      });
      badge.textContent = anyConnected ? '已連線' : '待設定';
      badge.classList.toggle('text-emerald-300', anyConnected);
      badge.classList.toggle('text-slate-400', !anyConnected);
    }
  }

  async function refreshStatus() {
    try {
      state.status = await request('/api/social/status');
      for (const platform of ['facebook', 'threads']) {
        const info = providerStatus(platform);
        displayProviderStatus(platform, info);
        const appId = byId('social-' + platform + '-app-id');
        const callback = byId('social-' + platform + '-callback');
        if (appId && !appId.value) appId.value = info?.appId || '';
        if (callback) callback.textContent = info?.callbackUrl || '';
      }
      updateControls();
      return state.status;
    } catch (error) {
      showStatus('無法讀取社群連線狀態：' + error.message, true);
      return null;
    }
  }

  async function saveConfig(platform) {
    const appId = byId('social-' + platform + '-app-id')?.value.trim() || '';
    setBusy(platform + ':config', true);
    try {
      const payload = { platform, appId };
      const result = await post('/api/social/config', payload);
      await refreshStatus();
      showStatus(platformLabel(platform) + ' 設定已儲存。' + (result.provider?.hasSecret
        ? '可以開始連線。'
        : '請在 Termux 執行 node scripts/configure-social-secret.cjs ' + platform + ' 設定 App Secret。'));
    } catch (error) {
      showStatus(error.message, true);
    } finally {
      setBusy(platform + ':config', false);
    }
  }

  async function connect(platform) {
    setBusy(platform + ':connect', true);
    try {
      const result = await post('/api/social/connect', { platform });
      if (!result.authorizationUrl) throw new Error('Meta 沒有提供授權網址');
      showStatus('正在開啟外部瀏覽器。完成 Meta 授權後，切回 Crew Pocket。');
      setBusy(platform + ':connect', false);
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      showStatus(error.message, true);
      setBusy(platform + ':connect', false);
    }
  }

  async function disconnect(platform) {
    const confirmed = await confirmInWorkbench({
      title: '移除 ' + platformLabel(platform) + ' 連線？',
      note: '只會刪除這台手機上的登入憑證，不會撤銷 Meta App 裡的授權。',
      confirmLabel: '移除連線',
      danger: true
    });
    if (!confirmed) return;
    try {
      await post('/api/social/disconnect', { platform });
      if (platform === 'facebook') {
        state.facebookPages = [];
        state.facebookPosts = [];
        state.facebookComments = [];
        state.facebookReplies = {};
        state.facebookCommentsPostId = '';
        state.pagination.facebookPages = { after: '', hasMore: false };
        state.pagination.facebookPosts = { after: '', hasMore: false };
        state.pagination.facebookComments = { after: '', hasMore: false };
        renderList('social-facebook-posts', []);
        renderList('social-facebook-comments', []);
      } else {
        state.threadsPosts = [];
        state.threadsReplies = [];
        state.threadsRepliesThreadId = '';
        state.pagination.threadsPosts = { after: '', hasMore: false };
        state.pagination.threadsReplies = { after: '', hasMore: false };
        renderList('social-threads-posts', []);
        renderList('social-threads-replies', []);
      }
      await refreshStatus();
      showStatus('已移除此裝置上的登入憑證。');
    } catch (error) {
      showStatus(error.message, true);
    }
  }

  function switchPlatform(platform) {
    state.activePlatform = platform;
    for (const tab of document.querySelectorAll('[data-social-tab]')) {
      const active = tab.dataset.socialTab === platform;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      tab.classList.toggle('bg-blue-600', active && platform === 'facebook');
      tab.classList.toggle('bg-purple-600', active && platform === 'threads');
      tab.classList.toggle('text-white', active);
      tab.classList.toggle('bg-slate-800', !active);
      tab.classList.toggle('text-slate-300', !active);
    }
    byId('social-panel-facebook')?.classList.toggle('hidden', platform !== 'facebook');
    byId('social-panel-threads')?.classList.toggle('hidden', platform !== 'threads');
    clearStatus();
  }

  function renderList(id, items, emptyText = '') {
    const container = byId(id);
    if (!container) return;
    container.replaceChildren();
    if (!items.length && emptyText) {
      const empty = document.createElement('div');
      empty.className = 'rounded-lg border border-slate-800 bg-slate-900/50 px-2.5 py-2 text-[10px] text-slate-500';
      empty.textContent = emptyText;
      container.append(empty);
    }
  }

  function safeDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString();
  }

  function setCompose(platform, mode, target = {}) {
    const composer = state.compose[platform];
    composer.mode = mode;
    composer.targetId = target.id || '';
    composer.targetType = target.type || '';
    composer.targetText = target.text || '';
    composer.targetLabel = target.label || '';
    const modeEl = byId('social-' + platform + '-compose-mode');
    const contextEl = byId('social-' + platform + '-compose-context');
    const input = byId('social-' + platform + '-compose');
    if (modeEl) modeEl.textContent = mode === 'post'
      ? (platform === 'facebook' ? '新 Facebook 粉專貼文' : '新 Threads 串文')
      : mode === 'reply' ? '回覆：' + (composer.targetLabel || '選取的留言') : '先選「新貼文」或一則留言';
    if (contextEl) {
      contextEl.textContent = composer.targetText;
      contextEl.classList.toggle('hidden', !composer.targetText);
    }
    if (input) {
      input.value = '';
      input.focus({ preventScroll: true });
    }
    updateControls();
  }

  function confirmInWorkbench({ title, destination = '', target = '', context = '', note = '', text = '', confirmLabel = '確認', danger = false }) {
    if (state.confirmation) return Promise.resolve(false);
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-[110] flex items-center justify-center bg-black/85 p-3';
    const dialog = document.createElement('section');
    dialog.className = 'flex max-h-[88dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-slate-600 bg-slate-900 shadow-2xl';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'social-confirm-title');
    dialog.tabIndex = -1;

    const heading = document.createElement('h2');
    heading.id = 'social-confirm-title';
    heading.className = 'border-b border-slate-700 px-4 py-3 text-sm font-bold text-white';
    heading.textContent = title;
    dialog.append(heading);

    const content = document.createElement('div');
    content.className = 'space-y-2 overflow-y-auto p-4 text-xs leading-relaxed text-slate-300';
    for (const line of [destination && '發布位置：' + destination, target && '回覆對象：' + target, note]) {
      if (!line) continue;
      const paragraph = document.createElement('p');
      paragraph.textContent = line;
      content.append(paragraph);
    }
    if (context) {
      const contextLabel = document.createElement('p');
      contextLabel.className = 'font-semibold text-slate-200';
      contextLabel.textContent = '原始貼文或留言';
      const contextPreview = document.createElement('pre');
      contextPreview.className = 'max-h-[22dvh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-700 bg-slate-950/70 p-3 font-sans text-xs text-slate-300';
      contextPreview.textContent = context;
      content.append(contextLabel, contextPreview);
    }
    if (text) {
      const previewLabel = document.createElement('p');
      previewLabel.className = 'font-semibold text-slate-200';
      previewLabel.textContent = '即將發布的完整內容';
      const preview = document.createElement('pre');
      preview.className = 'max-h-[38dvh] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-slate-700 bg-slate-950 p-3 font-sans text-xs text-slate-100';
      preview.textContent = text;
      content.append(previewLabel, preview);
    }
    dialog.append(content);

    const actions = document.createElement('div');
    actions.className = 'grid grid-cols-2 gap-2 border-t border-slate-700 bg-slate-950/70 p-3';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'min-h-11 rounded-xl bg-slate-800 px-3 text-xs font-semibold text-slate-200';
    cancel.textContent = '返回編輯';
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'min-h-11 rounded-xl px-3 text-xs font-bold text-white ' + (danger ? 'bg-rose-600' : 'bg-blue-600');
    accept.textContent = confirmLabel;
    actions.append(cancel, accept);
    dialog.append(actions);
    overlay.append(dialog);

    return new Promise(resolve => {
      let settled = false;
      const finish = confirmed => {
        if (settled) return;
        settled = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.remove();
        state.confirmation = null;
        resolve(confirmed);
        if (previousFocus && typeof previousFocus.focus === 'function') previousFocus.focus({ preventScroll: true });
      };
      const onKeyDown = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          finish(false);
        } else if (event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          if (!dialog.contains(document.activeElement)) (event.shiftKey ? accept : cancel).focus();
          else if (event.shiftKey) (document.activeElement === cancel ? accept : cancel).focus();
          else (document.activeElement === accept ? cancel : accept).focus();
        }
      };
      state.confirmation = { finish };
      cancel.addEventListener('click', () => finish(false));
      accept.addEventListener('click', () => finish(true));
      overlay.addEventListener('click', event => {
        if (event.target === overlay) finish(false);
      });
      document.addEventListener('keydown', onKeyDown, true);
      document.body.append(overlay);
      cancel.focus({ preventScroll: true });
    });
  }

  function makeCard() {
    const card = document.createElement('div');
    card.className = 'rounded-xl border border-slate-800 bg-slate-900/70 p-2.5 space-y-1.5';
    return card;
  }

  function makeActionButton(label, className, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  function renderFacebookPosts(posts) {
    renderList('social-facebook-posts', posts, '粉專貼文會顯示在這裡。');
    const container = byId('social-facebook-posts');
    for (const item of posts) {
      const card = makeCard();
      const meta = document.createElement('div');
      meta.className = 'text-[9px] text-slate-500';
      meta.textContent = safeDate(item.createdAt);
      const text = document.createElement('div');
      text.className = 'whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-200';
      text.textContent = item.text || '（沒有文字內容）';
      const actions = document.createElement('div');
      actions.className = 'grid grid-cols-2 gap-1.5';
      actions.append(
        makeActionButton('讀取留言串', 'min-h-9 rounded-lg bg-slate-800 text-[9px] text-slate-200', () => loadFacebookComments(item)),
        makeActionButton('在此貼文留言', 'min-h-9 rounded-lg bg-slate-800 text-[9px] text-slate-200', () => setCompose('facebook', 'reply', {
          id: item.id, type: 'post', label: 'Facebook 貼文', text: item.text
        }))
      );
      card.append(meta, text, actions);
      container.append(card);
    }
  }

  function renderFacebookComments(post) {
    const container = byId('social-facebook-comments');
    if (!container) return;
    container.replaceChildren();
    if (!state.facebookComments.length) {
      renderList('social-facebook-comments', [], '這則貼文目前沒有可讀取的留言。');
      return;
    }
    for (const comment of state.facebookComments) {
      const replyState = state.facebookReplies[comment.id];
      const card = makeCard();
      const meta = document.createElement('div');
      meta.className = 'text-[9px] text-slate-500';
      meta.textContent = comment.author + (comment.createdAt ? ' · ' + safeDate(comment.createdAt) : '');
      const text = document.createElement('div');
      text.className = 'whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-200';
      text.textContent = comment.text;
      card.append(meta, text, makeActionButton('回覆此留言', 'min-h-9 w-full rounded-lg bg-slate-800 text-[9px] text-slate-200', () => setCompose('facebook', 'reply', {
        id: comment.id, type: 'comment', label: comment.author + ' 的留言', text: comment.text + (post.text ? '\n\n原貼文：' + post.text : '')
      })));
      if (!replyState || replyState.paging?.hasMore) {
        card.append(makeActionButton(replyState?.loaded ? '載入更多回覆' : '讀取回覆', 'min-h-8 w-full rounded-lg bg-slate-800 text-[9px] text-slate-300', () => loadFacebookCommentReplies(comment, { append: Boolean(replyState?.loaded) })));
      }
      if (replyState?.loaded && !replyState.replies.length) {
        const empty = document.createElement('div');
        empty.className = 'ml-2 text-[9px] text-slate-500';
        empty.textContent = '目前沒有回覆';
        card.append(empty);
      }
      for (const reply of replyState?.replies || []) {
        const replyText = document.createElement('div');
        replyText.className = 'ml-2 border-l-2 border-slate-700 pl-2 text-[9px] text-slate-400';
        replyText.textContent = reply.author + '：' + reply.text;
        card.append(replyText, makeActionButton('回覆此留言', 'ml-2 min-h-8 rounded-lg bg-slate-800 px-2 text-[9px] text-slate-300', () => setCompose('facebook', 'reply', {
          id: reply.id, type: 'comment', label: reply.author + ' 的回覆', text: reply.text + (post.text ? '\n\n原貼文：' + post.text : '')
        })));
      }
      container.append(card);
    }
  }

  async function loadFacebookComments(post, { append = false } = {}) {
    if (state.busy.has('facebook:comments')) return;
    if (!append || state.facebookCommentsPostId !== post.id) {
      state.facebookCommentsPostId = post.id;
      state.facebookComments = [];
      state.facebookReplies = {};
      state.pagination.facebookComments = { after: '', hasMore: false };
    }
    const after = append ? state.pagination.facebookComments.after : '';
    setBusy('facebook:comments', true);
    try {
      const query = new URLSearchParams({ postId: post.id, ...(after ? { after } : {}) });
      const data = await request('/api/social/facebook/comments?' + query.toString());
      state.facebookComments = append
        ? state.facebookComments.concat(data.comments || [])
        : (data.comments || []);
      state.pagination.facebookComments = data.paging || { after: '', hasMore: false };
      renderFacebookComments(post);
      showStatus('已載入 ' + state.facebookComments.length + ' 則留言。');
    } catch (error) {
      showStatus('讀取 Facebook 留言失敗：' + error.message, true);
    } finally {
      setBusy('facebook:comments', false);
    }
  }

  async function loadMoreFacebookComments() {
    const post = state.facebookPosts.find(item => item.id === state.facebookCommentsPostId);
    if (post && state.pagination.facebookComments.hasMore) await loadFacebookComments(post, { append: true });
  }

  async function loadFacebookCommentReplies(comment, { append = false } = {}) {
    const key = 'facebook:comment-replies:' + comment.id;
    if (state.busy.has(key)) return;
    const current = state.facebookReplies[comment.id] || { replies: [], paging: { after: '', hasMore: false }, loaded: false };
    const after = append ? current.paging.after : '';
    setBusy(key, true);
    try {
      const query = new URLSearchParams({ commentId: comment.id, ...(after ? { after } : {}) });
      const data = await request('/api/social/facebook/comment-replies?' + query.toString());
      state.facebookReplies[comment.id] = {
        replies: append ? current.replies.concat(data.replies || []) : (data.replies || []),
        paging: data.paging || { after: '', hasMore: false },
        loaded: true
      };
      const post = state.facebookPosts.find(item => item.id === state.facebookCommentsPostId);
      if (post) renderFacebookComments(post);
      showStatus('已載入 ' + state.facebookReplies[comment.id].replies.length + ' 則回覆。');
    } catch (error) {
      showStatus('讀取 Facebook 回覆失敗：' + error.message, true);
    } finally {
      setBusy(key, false);
    }
  }

  function renderThreadsPosts(posts) {
    renderList('social-threads-posts', posts, '自己的 Threads 串文會顯示在這裡。');
    const container = byId('social-threads-posts');
    for (const item of posts) {
      const card = makeCard();
      const meta = document.createElement('div');
      meta.className = 'text-[9px] text-slate-500';
      meta.textContent = (item.username ? '@' + item.username + ' · ' : '') + safeDate(item.timestamp);
      const text = document.createElement('div');
      text.className = 'whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-200';
      text.textContent = item.text || '（沒有文字內容）';
      const actions = document.createElement('div');
      actions.className = 'grid grid-cols-2 gap-1.5';
      actions.append(
        makeActionButton('讀取回覆', 'min-h-9 rounded-lg bg-slate-800 text-[9px] text-slate-200', () => loadThreadsReplies(item)),
        makeActionButton('回覆此串文', 'min-h-9 rounded-lg bg-slate-800 text-[9px] text-slate-200', () => setCompose('threads', 'reply', {
          id: item.id, type: 'post', label: 'Threads 串文', text: item.text
        }))
      );
      card.append(meta, text, actions);
      container.append(card);
    }
  }

  async function loadThreadsReplies(thread) {
    if (state.busy.has('threads:replies')) return;
    if (state.threadsRepliesThreadId !== thread.id) {
      state.threadsRepliesThreadId = thread.id;
      state.threadsReplies = [];
      state.pagination.threadsReplies = { after: '', hasMore: false };
    }
    const append = state.pagination.threadsReplies.hasMore;
    const after = append ? state.pagination.threadsReplies.after : '';
    setBusy('threads:replies', true);
    try {
      const query = new URLSearchParams({ threadId: thread.id, ...(after ? { after } : {}) });
      const data = await request('/api/social/threads/replies?' + query.toString());
      const container = byId('social-threads-replies');
      container.replaceChildren();
      state.threadsReplies = append
        ? state.threadsReplies.concat(data.replies || [])
        : (data.replies || []);
      state.pagination.threadsReplies = data.paging || { after: '', hasMore: false };
      if (!state.threadsReplies.length) {
        renderList('social-threads-replies', [], '這則串文目前沒有可讀取的回覆。');
        return;
      }
      for (const reply of state.threadsReplies) {
        const card = makeCard();
        const meta = document.createElement('div');
        meta.className = 'text-[9px] text-slate-500';
        meta.textContent = (reply.username ? '@' + reply.username + ' · ' : '') + safeDate(reply.timestamp);
        const text = document.createElement('div');
        text.className = 'whitespace-pre-wrap break-words text-[10px] leading-relaxed text-slate-200';
        text.textContent = reply.text;
        card.append(meta, text, makeActionButton('回覆此留言', 'min-h-9 w-full rounded-lg bg-slate-800 text-[9px] text-slate-200', () => setCompose('threads', 'reply', {
          id: reply.id, type: 'reply', label: (reply.username ? '@' + reply.username : 'Threads 使用者') + ' 的回覆', text: reply.text + (thread.text ? '\n\n原串文：' + thread.text : '')
        })));
        container.append(card);
      }
    } catch (error) {
      showStatus('讀取 Threads 回覆失敗：' + error.message, true);
    } finally {
      setBusy('threads:replies', false);
    }
  }

  async function loadMoreThreadsReplies() {
    const thread = state.threadsPosts.find(item => item.id === state.threadsRepliesThreadId);
    if (thread && state.pagination.threadsReplies.hasMore) await loadThreadsReplies(thread);
  }

  async function loadFacebookPages({ append = false } = {}) {
    setBusy('facebook:pages', true);
    try {
      const after = append ? state.pagination.facebookPages.after : '';
      const query = new URLSearchParams(after ? { after } : {});
      const data = await request('/api/social/facebook/pages' + (after ? '?' + query.toString() : ''));
      state.facebookPages = data.pages || [];
      state.pagination.facebookPages = data.paging || { after: '', hasMore: false };
      const select = byId('social-facebook-page');
      const selectedId = providerStatus('facebook')?.selectedPage?.id || '';
      select.replaceChildren();
      const placeholder = document.createElement('option');
      placeholder.value = '';
      placeholder.textContent = state.facebookPages.length ? '選擇 Facebook 粉絲專頁' : '這個帳號沒有可管理的粉專';
      select.append(placeholder);
      for (const page of state.facebookPages) {
        const option = document.createElement('option');
        option.value = page.id;
        option.textContent = page.name + (page.tasks?.length ? ' · ' + page.tasks.join(', ') : '');
        select.append(option);
      }
      if (selectedId) select.value = selectedId;
      showStatus('已載入 ' + state.facebookPages.length + ' 個可管理粉絲專頁。請選擇要操作的粉專。');
    } catch (error) {
      showStatus('載入 Facebook 粉專失敗：' + error.message, true);
    } finally {
      setBusy('facebook:pages', false);
    }
  }

  async function loadMoreFacebookPages() {
    if (state.pagination.facebookPages.hasMore) await loadFacebookPages({ append: true });
  }

  async function loadFacebookPosts({ append = false } = {}) {
    if (!append) {
      state.facebookPosts = [];
      state.facebookComments = [];
      state.facebookReplies = {};
      state.facebookCommentsPostId = '';
      state.pagination.facebookPosts = { after: '', hasMore: false };
      state.pagination.facebookComments = { after: '', hasMore: false };
      renderFacebookPosts([]);
      renderList('social-facebook-comments', []);
    }
    const after = append ? state.pagination.facebookPosts.after : '';
    setBusy('facebook:load', true);
    try {
      const query = new URLSearchParams(after ? { after } : {});
      const data = await request('/api/social/facebook/posts' + (after ? '?' + query.toString() : ''));
      state.facebookPosts = append ? state.facebookPosts.concat(data.posts || []) : (data.posts || []);
      state.pagination.facebookPosts = data.paging || { after: '', hasMore: false };
      renderFacebookPosts(state.facebookPosts);
      showStatus('已載入 ' + state.facebookPosts.length + ' 則粉專貼文。');
    } catch (error) {
      showStatus('載入 Facebook 貼文失敗：' + error.message, true);
    } finally {
      setBusy('facebook:load', false);
    }
  }

  async function loadMoreFacebookPosts() {
    if (state.pagination.facebookPosts.hasMore) await loadFacebookPosts({ append: true });
  }

  async function loadThreadsPosts({ append = false } = {}) {
    if (!append) {
      state.threadsPosts = [];
      state.threadsReplies = [];
      state.threadsRepliesThreadId = '';
      state.pagination.threadsPosts = { after: '', hasMore: false };
      state.pagination.threadsReplies = { after: '', hasMore: false };
      renderThreadsPosts([]);
      renderList('social-threads-replies', []);
    }
    const after = append ? state.pagination.threadsPosts.after : '';
    setBusy('threads:load', true);
    try {
      const query = new URLSearchParams(after ? { after } : {});
      const data = await request('/api/social/threads/posts' + (after ? '?' + query.toString() : ''));
      state.threadsPosts = append ? state.threadsPosts.concat(data.posts || []) : (data.posts || []);
      state.pagination.threadsPosts = data.paging || { after: '', hasMore: false };
      renderThreadsPosts(state.threadsPosts);
      showStatus('已載入 ' + state.threadsPosts.length + ' 則自己的 Threads 串文。');
    } catch (error) {
      showStatus('載入 Threads 串文失敗：' + error.message, true);
    } finally {
      setBusy('threads:load', false);
    }
  }

  async function loadMoreThreadsPosts() {
    if (state.pagination.threadsPosts.hasMore) await loadThreadsPosts({ append: true });
  }

  async function draft(platform) {
    const compose = state.compose[platform];
    if (!compose.mode) return showStatus('先選擇新貼文或回覆目標。', true);
    const input = byId('social-' + platform + '-compose');
    const sourceText = input.value.trim();
    if (!sourceText && !compose.targetText) return showStatus('先輸入貼文重點，或選擇一則留言讓 AI 擬稿。', true);
    setBusy(platform + ':draft', true);
    showStatus('AI 正在產生草稿；此步驟不會發布內容。');
    try {
      const data = await post('/api/social/draft', {
        platform,
        mode: compose.mode,
        sourceText,
        targetText: compose.targetText,
        provider: byId('social-draft-provider')?.value || 'auto',
        tone: '自然、清楚、符合繁體中文語境'
      });
      input.value = data.draft || '';
      input.focus({ preventScroll: true });
      const providerLabel = data.provider === 'antigravity' ? 'AGY' : data.provider === 'codex' ? 'Codex' : '';
      const fallbackLabel = data.fallbackFrom === 'codex' ? 'Codex 失敗後改由 AGY 產生' : data.fallbackFrom === 'antigravity' ? 'AGY 失敗後改由 Codex 產生' : '';
      showStatus('草稿已產生。請先檢查並編輯內容，再按「確認後發布」。' + (providerLabel ? '（' + providerLabel + (fallbackLabel ? '；' + fallbackLabel : '') + '）' : ''));
    } catch (error) {
      showStatus('產生草稿失敗：' + error.message, true);
    } finally {
      setBusy(platform + ':draft', false);
    }
  }

  async function publish(platform) {
    const compose = state.compose[platform];
    const input = byId('social-' + platform + '-compose');
    const text = input.value.trim();
    if (!compose.mode || (compose.mode === 'reply' && !compose.targetId)) return showStatus('先選擇發布類型或回覆目標。', true);
    if (platform === 'facebook') {
      const tasks = new Set((providerStatus('facebook')?.selectedPage?.tasks || []).map(task => String(task).toUpperCase()));
      const requiredTasks = compose.mode === 'reply' ? ['MODERATE', 'MANAGE'] : ['CREATE_CONTENT', 'MANAGE'];
      if (tasks.size && !requiredTasks.some(task => tasks.has(task))) {
        return showStatus(compose.mode === 'reply'
          ? '此粉絲專頁帳號缺少管理留言的 Page 任務（MODERATE 或 MANAGE）。'
          : '此粉絲專頁帳號缺少發佈內容的 Page 任務（CREATE_CONTENT 或 MANAGE）。', true);
      }
    }
    if (!text) return showStatus('先輸入要發布的文字。', true);
    if (platform === 'threads' && text.length > 500) return showStatus('Threads 文字最多 500 字元。', true);
    const destination = platform === 'facebook'
      ? (providerStatus('facebook')?.selectedPage?.name || '所選粉絲專頁')
      : (providerStatus('threads')?.identity || 'Threads 帳號');
    const confirmed = await confirmInWorkbench({
      title: compose.mode === 'post' ? '確認發布新貼文？' : '確認發布回覆？',
      destination,
      target: compose.mode === 'reply' ? compose.targetLabel : '',
      context: compose.mode === 'reply' ? compose.targetText : '',
      text,
      confirmLabel: '確認並發布'
    });
    if (!confirmed) return;
    setBusy(platform + ':publish', true);
    showStatus('正在向 ' + platformLabel(platform) + ' 發送已確認的內容…');
    try {
      const result = await post('/api/social/publish', {
        platform,
        mode: compose.mode,
        targetId: compose.targetId,
        targetType: compose.targetType,
        text,
        confirmed: true
      });
      input.value = '';
      setCompose(platform, '', {});
      showStatus('Meta 已接受發布請求。內容 ID：' + (result.id || '未提供'));
      if (platform === 'facebook') await loadFacebookPosts();
      else await loadThreadsPosts();
    } catch (error) {
      showStatus('發布結果：' + error.message, true);
    } finally {
      setBusy(platform + ':publish', false);
    }
  }

  async function copyCallback(platform) {
    const value = byId('social-' + platform + '-callback')?.textContent || '';
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      showStatus('已複製 ' + platformLabel(platform) + ' OAuth 回呼網址。');
    } catch (_) {
      const input = document.createElement('textarea');
      input.value = value;
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
      showStatus('已複製 OAuth 回呼網址。');
    }
  }

  function initialize() {
    for (const tab of document.querySelectorAll('[data-social-tab]')) {
      tab.addEventListener('click', () => switchPlatform(tab.dataset.socialTab));
    }
    for (const platform of ['facebook', 'threads']) {
      byId('social-' + platform + '-save-config')?.addEventListener('click', () => saveConfig(platform));
      byId('social-' + platform + '-connect')?.addEventListener('click', () => connect(platform));
      byId('social-' + platform + '-disconnect')?.addEventListener('click', () => disconnect(platform));
      byId('social-' + platform + '-new-post')?.addEventListener('click', () => setCompose(platform, 'post'));
      byId('social-' + platform + '-draft')?.addEventListener('click', () => draft(platform));
      byId('social-' + platform + '-publish')?.addEventListener('click', () => publish(platform));
    }
    document.querySelectorAll('[data-social-copy]').forEach(button => {
      button.addEventListener('click', () => copyCallback(button.dataset.socialCopy));
    });
    byId('social-facebook-load-pages')?.addEventListener('click', loadFacebookPages);
    byId('social-facebook-more-pages')?.addEventListener('click', loadMoreFacebookPages);
    byId('social-facebook-load-posts')?.addEventListener('click', loadFacebookPosts);
    byId('social-facebook-more-posts')?.addEventListener('click', loadMoreFacebookPosts);
    byId('social-facebook-more-comments')?.addEventListener('click', loadMoreFacebookComments);
    byId('social-threads-load-posts')?.addEventListener('click', loadThreadsPosts);
    byId('social-threads-more-posts')?.addEventListener('click', loadMoreThreadsPosts);
    byId('social-threads-more-replies')?.addEventListener('click', loadMoreThreadsReplies);
    byId('social-facebook-page')?.addEventListener('change', async event => {
      const pageId = event.target.value;
      if (!pageId) return;
      try {
        await post('/api/social/facebook/page', { pageId });
        await refreshStatus();
        state.facebookPosts = [];
        state.facebookComments = [];
        state.facebookReplies = {};
        state.facebookCommentsPostId = '';
        state.pagination.facebookPosts = { after: '', hasMore: false };
        state.pagination.facebookComments = { after: '', hasMore: false };
        renderList('social-facebook-posts', []);
        renderList('social-facebook-comments', []);
        updateControls();
        showStatus('已選擇粉絲專頁。');
      } catch (error) {
        showStatus('選擇粉專失敗：' + error.message, true);
      }
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) refreshStatus();
    });
    window.addEventListener('focus', refreshStatus);
    switchPlatform('facebook');
    refreshStatus();
  }

  window.refreshSocialStatus = refreshStatus;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
})();
