// Antigravity Web UI - Chat Messaging, SSE Streaming, and History Management

// Transform local image paths into proxy URL and sanitize with DOMPurify
function formatMessageContent(content) {
  if (!content) return '';
  
  let formatted = content;

  // 🛡️ Streaming Markdown Guard: Auto-close open code blocks if odd number of triple backticks
  const tripleBackticks = formatted.match(/```/g);
  if (tripleBackticks && tripleBackticks.length % 2 !== 0) {
    formatted += '\n```';
  }

  const codeBlocks = [];
  let currentContent = formatted.replace(/```[\s\S]*?```/g, (match) => {
    codeBlocks.push(match);
    return `__CODE_BLOCK_${codeBlocks.length - 1}__`;
  });
  
  currentContent = currentContent.replace(/((\/data\/data\/|\/storage\/|\/sdcard\/)[^\s\)\"\'\<\>]+\.(png|jpg|jpeg|webp|svg|gif))/gi, (match) => {
    return `/api/image?path=${encodeURIComponent(match)}`;
  });
  
  formatted = currentContent.replace(/__CODE_BLOCK_(\d+)__/g, (match, index) => {
    return codeBlocks[index];
  });

  const rawHtml = marked.parse(formatted);
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ['target', 'class', 'style', 'data-enhanced', 'data-cmd', 'data-desc', 'data-fill'],
      ADD_TAGS: ['iframe', 'canvas', 'details', 'summary', 'svg', 'path', 'g', 'rect', 'circle', 'line'],
      USE_PROFILES: { html: true, svg: true }
    });
  }
  return rawHtml;
}

// Helper: format tool info with rich metadata, category badges & icons
function getToolDetails(tool) {
  const name = tool.name || tool.tool_name || 'action';
  const args = tool.args || (tool.tool_info && tool.tool_info.parameters) || {};
  let icon = '⚙️';
  let label = '系統動作';
  let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
  let desc = name;

  if (name === 'run_command') {
    icon = '💻';
    label = '終端指令';
    badgeColor = 'bg-amber-950/40 text-amber-300 border-amber-800/60';
    const cmd = args.CommandLine || '';
    desc = cmd ? `$ ${cmd.slice(0, 45)}${cmd.length > 45 ? '...' : ''}` : '執行終端命令';
  } else if (name === 'view_file') {
    icon = '📄';
    label = '檢視檔案';
    badgeColor = 'bg-blue-950/40 text-blue-300 border-blue-800/60';
    const p = (args.AbsolutePath || '').split('/').pop();
    desc = p ? `讀取 ${p}` : '檢視檔案內容';
  } else if (name === 'replace_file_content') {
    icon = '📝';
    label = '編輯修改';
    badgeColor = 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60';
    const p = (args.TargetFile || '').split('/').pop();
    desc = p ? `修改 ${p}` : '替換檔案內容';
  } else if (name === 'write_to_file') {
    icon = '💾';
    label = '寫入建立';
    badgeColor = 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60';
    const p = (args.TargetFile || '').split('/').pop();
    desc = p ? `建立 ${p}` : '寫入檔案';
  } else if (name === 'grep_search') {
    icon = '🔍';
    label = '代碼搜尋';
    badgeColor = 'bg-purple-950/40 text-purple-300 border-purple-800/60';
    desc = args.Query ? `搜尋 "${args.Query}"` : '搜尋代碼庫';
  } else if (name === 'find_by_name') {
    icon = '📁';
    label = '搜尋檔案';
    badgeColor = 'bg-purple-950/40 text-purple-300 border-purple-800/60';
    desc = args.Pattern ? `查找 "${args.Pattern}"` : '依名稱查找檔案';
  } else if (name === 'search_web') {
    icon = '🌐';
    label = '網路檢索';
    badgeColor = 'bg-sky-950/40 text-sky-300 border-sky-800/60';
    desc = args.query ? `搜尋 "${args.query}"` : '搜尋網路公開資料';
  } else if (name === 'generate_image') {
    icon = '🎨';
    label = '生成圖片';
    badgeColor = 'bg-pink-950/40 text-pink-300 border-pink-800/60';
    desc = args.Prompt ? `繪製 "${args.Prompt.slice(0, 30)}..."` : 'AI 圖片生成';
  } else if (name === 'list_dir') {
    icon = '📂';
    label = '目錄清單';
    badgeColor = 'bg-slate-800/60 text-slate-300 border-slate-700/60';
    desc = '列出檔案目錄';
  } else if (name === 'invoke_subagent') {
    icon = '🤖';
    label = '調度代理';
    badgeColor = 'bg-indigo-950/40 text-indigo-300 border-indigo-800/60';
    desc = '調派子代理協同工作';
  }

  const durationStr = (tool.duration_seconds && Number(tool.duration_seconds) > 0)
    ? `${Number(tool.duration_seconds).toFixed(1)}s`
    : '';
  return { icon, label, badgeColor, desc, durationStr };
}

function formatToolSummary(tool) {
  const d = getToolDetails(tool);
  return `${d.icon} ${d.label}: ${d.desc}`;
}

// Render tools accordion HTML with rich cards
function buildToolsAccordionHtml(tools) {
  if (!tools || tools.length === 0) return '';
  
  const itemsHtml = tools.map((t, idx) => {
    const d = getToolDetails(t);
    return `
      <div class="py-1.5 border-b border-slate-800/60 last:border-b-0 flex items-center justify-between gap-2 text-xs">
        <div class="flex items-center gap-2 min-w-0">
          <span class="px-1.5 py-0.5 rounded-md border text-[10px] font-mono font-medium shrink-0 ${d.badgeColor}">
            ${d.icon} ${d.label}
          </span>
          <span class="text-slate-300 font-mono text-[11px] truncate">${escapeHtml(d.desc)}</span>
        </div>
        ${d.durationStr ? `<span class="text-[10px] text-slate-500 font-mono shrink-0">${d.durationStr}</span>` : ''}
      </div>
    `;
  }).join('');

  return `
    <details class="my-2 bg-slate-950/70 border border-slate-800/90 rounded-xl overflow-hidden text-xs">
      <summary class="px-3 py-1.5 cursor-pointer flex items-center justify-between text-slate-400 hover:text-slate-200 font-mono select-none bg-slate-900/60">
        <div class="flex items-center gap-1.5">
          <span>⚙️ 執行了 ${tools.length} 個操作動作</span>
        </div>
        <span class="text-[10px] text-slate-500">展開 ▼</span>
      </summary>
      <div class="px-3 py-2 border-t border-slate-800/60 bg-slate-950/90 space-y-1">
        ${itemsHtml}
      </div>
    </details>
  `;
}

// Render collapsible thinking block with Aurora flowing glow (Idea 5)
function buildThinkingBlockHtml(thinking, isStreamingThinking = false) {
  if (!thinking || !thinking.trim()) return '';
  const glowClass = isStreamingThinking ? 'thinking-active-glow border-purple-500/80 shadow-lg shadow-purple-950/40' : 'border-purple-900/40';
  const headerIcon = isStreamingThinking
    ? '<span class="w-2 h-2 rounded-full bg-purple-400 animate-ping shrink-0"></span><span class="text-purple-300 font-bold">💡 深度思考推理中...</span>'
    : '<span class="text-purple-300">💡 深度思考推理過程</span>';

  return `
    <details class="my-2 bg-slate-950/70 border ${glowClass} rounded-xl overflow-hidden text-xs transition-all duration-300" ${isStreamingThinking ? 'open' : ''}>
      <summary class="px-3 py-1.5 bg-purple-950/30 text-purple-300 font-mono text-[11px] cursor-pointer flex items-center justify-between select-none">
        <span class="flex items-center gap-1.5">${headerIcon}</span>
        <span class="text-[10px] text-purple-400 font-mono">${isStreamingThinking ? '即時' : '展開 ▼'}</span>
      </summary>
      <div class="p-3 text-slate-300 font-mono text-[11px] leading-relaxed whitespace-pre-wrap border-t border-purple-900/30 bg-slate-950/90">
        ${escapeHtml(thinking.trim())}
      </div>
    </details>
  `;
}

// Append Message to UI
function appendMessage(role, content, timestamp, tools = [], thinking = '', isBtw = false) {
  const isUser = role === 'user';
  const msgDiv = document.createElement('div');
  msgDiv.className = `flex gap-2.5 w-full max-w-2xl mx-auto min-w-0 ${isUser ? 'justify-end' : 'justify-start'}`;

  const isUserBtw = isUser && (isBtw || /^\s*\/btw\b/i.test(content || ''));

  const avatar = isUser
    ? `<div class="w-7 h-7 rounded-full ${isUserBtw ? 'bg-teal-600 text-white' : 'bg-slate-700 text-slate-300'} flex items-center justify-center shrink-0 text-xs font-bold order-2 mt-0.5 shadow-sm">我</div>`
    : `<div class="w-7 h-7 rounded-full ${isBtw ? 'bg-teal-600/30 border-teal-500/50 text-teal-300' : 'bg-indigo-600/30 border-indigo-500/50 text-indigo-400'} border flex items-center justify-center shrink-0 text-xs font-bold mt-0.5">CP</div>`;

  const thinkingHtml = (!isUser && thinking) ? buildThinkingBlockHtml(thinking) : '';
  const toolsHtml = (!isUser && tools && tools.length > 0) ? buildToolsAccordionHtml(tools) : '';

  let bubbleClass = '';
  if (isUser) {
    bubbleClass = isUserBtw
      ? 'bg-gradient-to-r from-teal-700 to-indigo-600 text-white rounded-2xl rounded-tr-none p-3 text-xs sm:text-sm shadow-md order-1 max-w-[85%] break-words border border-teal-400/30'
      : 'bg-indigo-600 text-white rounded-2xl rounded-tr-none p-3 text-xs sm:text-sm shadow-md order-1 max-w-[85%] break-words';
  } else {
    bubbleClass = isBtw
      ? 'btw-card bg-gradient-to-b from-slate-900 via-slate-900 to-teal-950/40 border border-teal-500/50 text-slate-200 rounded-2xl rounded-tl-none p-3.5 text-xs sm:text-sm shadow-lg shadow-teal-950/30 flex-1 min-w-0 prose'
      : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-2xl rounded-tl-none p-3.5 text-xs sm:text-sm shadow-md flex-1 min-w-0 prose';
  }

  let bodyHtml = '';
  if (isUser) {
    const userTurnIndex = document.querySelectorAll('#messages-container > div[data-role="user"]').length;
    msgDiv.setAttribute('data-role', 'user');
    msgDiv.setAttribute('data-turn-index', userTurnIndex);

    let userText = content;
    let imgHtml = '';
    const match = userText.match(/\[Uploaded Image:\s*([^\]]+)\]/);
    if (match) {
      const imgP = match[1].trim();
      imgHtml = `<img src="/api/image?path=${encodeURIComponent(imgP)}" class="max-h-48 sm:max-h-56 max-w-full rounded-xl object-contain border border-indigo-400/40 cursor-pointer shadow-md mb-2 bg-black/20 block" alt="Uploaded Photo">`;
      userText = userText.replace(/\[Uploaded Image:\s*([^\]]+)\]/, '').trim();
    }
    msgDiv.setAttribute('data-raw-text', userText);

    const btwBadge = isUserBtw ? `<div class="mb-1 flex items-center gap-1"><span class="px-1.5 py-0.2 rounded bg-teal-500/30 border border-teal-400/50 text-[10px] font-mono font-semibold text-teal-200">💬 順帶一提</span></div>` : '';

    const editRewindBtn = `
      <button type="button" class="edit-rewind-btn opacity-70 hover:opacity-100 hover:text-white bg-indigo-700/50 hover:bg-indigo-700 px-1.5 py-0.5 rounded transition active:scale-95 flex items-center gap-1 font-sans cursor-pointer text-[10px]" title="編輯此問題並回溯對話">
        <svg class="w-2.5 h-2.5 text-indigo-200" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        <span>編輯回溯</span>
      </button>
    `;

    const userFooter = `
      <div class="flex items-center justify-between gap-2 mt-1.5 pt-1 border-t border-indigo-400/30 text-[10px] text-indigo-200/80 select-none">
        <span class="font-mono text-[9px] opacity-70">#${userTurnIndex + 1}</span>
        ${editRewindBtn}
      </div>
    `;

    bodyHtml = `${imgHtml}${btwBadge}<div class="whitespace-pre-wrap leading-relaxed break-words">${escapeHtml(userText)}</div>${userFooter}`;
  } else {
    const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    const btwHeader = isBtw ? `
      <div class="flex items-center justify-between border-b border-teal-800/60 pb-1.5 mb-2 select-none">
        <span class="px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/40 text-[10px] font-mono font-semibold flex items-center gap-1">
          <span class="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span>
          💬 順帶一提 · 支線解答
        </span>
        <button type="button" class="btw-toggle-btn text-[10px] text-teal-400 hover:text-teal-200 font-mono transition px-1.5 py-0.5 rounded hover:bg-teal-900/40">收合 ▲</button>
      </div>
    ` : '';

    bodyHtml = `
      ${btwHeader}
      <div class="thinking-container">${thinkingHtml}</div>
      <div class="tools-container">${toolsHtml}</div>
      <div class="btw-content msg-content leading-relaxed min-w-0">${formatMessageContent(content)}</div>
      <div class="msg-footer mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 select-none">
        <div class="flex items-center gap-2">
          <button type="button" class="tts-btn px-2 py-0.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition flex items-center gap-1 active:scale-95">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
            </svg>
            <span class="text-[10px]">朗讀</span>
          </button>
        </div>
        <span class="text-[10px] text-slate-500 font-mono">${timeStr}</span>
      </div>
    `;
  }

  msgDiv.innerHTML = `${avatar}<div class="${bubbleClass}">${bodyHtml}</div>`;
  messagesContainer.appendChild(msgDiv);

  if (isBtw && !isUser) {
    const toggleBtn = msgDiv.querySelector('.btw-toggle-btn');
    const btwCard = msgDiv.querySelector('.btw-card');
    if (toggleBtn && btwCard) {
      toggleBtn.addEventListener('click', () => {
        const isCollapsed = btwCard.classList.toggle('collapsed');
        toggleBtn.textContent = isCollapsed ? '展開 ▼' : '收合 ▲';
      });
    }
  }

  // ⏪ Edit & Rewind Action for User Message (Idea A)
  const editBtn = msgDiv.querySelector('.edit-rewind-btn');
  if (editBtn) {
    editBtn.addEventListener('click', async () => {
      if (isStreaming) {
        alert('請先等待當前回覆完成或點擊中斷生成！');
        return;
      }
      const rawText = msgDiv.getAttribute('data-raw-text') || '';
      const turnIndex = parseInt(msgDiv.getAttribute('data-turn-index'), 10);

      // Populate input with original user question
      if (promptInput) {
        promptInput.value = rawText;
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
        promptInput.focus();
      }

      if (navigator.vibrate) navigator.vibrate([20, 30]);

      // Collect all sibling message elements starting from this msgDiv to the end
      const allMsgs = Array.from(messagesContainer.children);
      const startIdx = allMsgs.indexOf(msgDiv);
      if (startIdx !== -1) {
        const toRemove = allMsgs.slice(startIdx);
        toRemove.forEach(el => {
          el.style.transition = 'all 0.2s ease-out';
          el.style.opacity = '0';
          el.style.transform = 'translateY(10px) scale(0.98)';
        });
        setTimeout(() => {
          toRemove.forEach(el => el.remove());
        }, 220);
      }

      // If persistent conversation, call /api/rewind
      if (currentConversationId && !isNaN(turnIndex)) {
        try {
          await fetch('/api/rewind', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              conversation_id: currentConversationId,
              user_turn_index: turnIndex
            })
          });
        } catch (e) {
          console.error('[Rewind error]', e);
        }
      }
    });
  }

  msgDiv.querySelectorAll('img').forEach(img => {
    img.addEventListener('click', () => showLightbox(img.src));
  });

  const ttsBtn = msgDiv.querySelector('.tts-btn');
  if (ttsBtn) {
    ttsBtn.addEventListener('click', () => toggleSpeech(content, ttsBtn));
  }

  if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(msgDiv);
  scrollToBottom();
  return msgDiv;
}

// Delete Conversation Action (Instant Silent Deletion with Animation)
async function deleteConversationDirect(convId, wrapperElement) {
  if (navigator.vibrate) navigator.vibrate([30, 20]);

  // Animate slide out to the left and vertical collapse
  if (wrapperElement) {
    const contentEl = wrapperElement.querySelector('.swipe-item-content');
    if (contentEl) {
      contentEl.style.transition = 'transform 0.22s ease-out';
      contentEl.style.transform = 'translateX(-105%)';
    }
    setTimeout(() => {
      wrapperElement.style.transition = 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
      wrapperElement.style.maxHeight = '0px';
      wrapperElement.style.opacity = '0';
      wrapperElement.style.marginBottom = '0px';
      wrapperElement.style.paddingTop = '0px';
      wrapperElement.style.paddingBottom = '0px';
    }, 120);
  }

  try {
    const res = await fetch(`/api/conversation?id=${convId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      if (currentConversationId === convId) {
        currentConversationId = null;
        if (headerTitle) headerTitle.textContent = '新對話';
        messagesContainer.innerHTML = '';
        appendMessage('assistant', '你好！已為你開啟新對話。有什麼可以幫你的？');
      }
      setTimeout(() => {
        if (wrapperElement && wrapperElement.parentNode) {
          wrapperElement.remove();
        }
        if (convList && convList.children.length === 0) {
          convList.innerHTML = '<div class="p-4 text-center text-xs text-slate-500">尚無歷史對話</div>';
        }
      }, 380);
    }
  } catch (err) {
    console.error('Delete failed:', err);
  }
}

// ✏️ Rename Conversation Action
async function renameConversationDirect(convId, currentTitle) {
  const defaultVal = currentTitle && !currentTitle.startsWith('對話 ') ? currentTitle : '';
  const newTitle = window.prompt('請輸入自定義對話標題：', defaultVal);
  if (newTitle === null) return; // User canceled
  const cleanTitle = newTitle.trim();
  if (!cleanTitle) {
    alert('標題不能為空白');
    return;
  }

  try {
    const res = await fetch('/api/rename-conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversation_id: convId, title: cleanTitle })
    });
    const data = await res.json();
    if (data.success) {
      if (currentConversationId === convId && headerTitle) {
        headerTitle.textContent = cleanTitle;
      }
      loadConversations();
      if (navigator.vibrate) navigator.vibrate(25);
    } else {
      alert('重新命名失敗：' + (data.error || '未知錯誤'));
    }
  } catch (err) {
    alert('重新命名失敗：' + err.message);
  }
}

// Load History for a Conversation
async function loadConversationHistory(convId) {
  // 🛡️ Abort any ongoing stream from previous session to prevent cross-session state pollution
  if (currentAbortController) {
    try { currentAbortController.abort(); } catch(e) {}
    currentAbortController = null;
  }

  currentConversationId = convId;
  localStorage.setItem('agy_active_conv_id', convId);
  revokeAllBlobUrls();
  messagesContainer.innerHTML = '';
  toggleDrawer(false);

  // 🔄 Reset input box and Send/Stop button to initial idle state
  if (promptInput) {
    promptInput.value = '';
    promptInput.style.height = 'auto';
  }
  uploadedImagePath = null;
  if (cameraInput) cameraInput.value = '';
  if (typeof attachInput !== 'undefined' && attachInput) attachInput.value = '';
  if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
  setStreamingState(false);

  try {
    const res = await fetch(`/api/history?id=${convId}`);
    const data = await res.json();
    
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach((msg, idx) => {
        const isBtw = msg.role === 'assistant' && idx > 0 && /^\s*\/btw\b/i.test(data.messages[idx - 1].content || '');
        appendMessage(msg.role, msg.content, msg.timestamp, msg.tools || [], msg.thinking || '', isBtw);
      });
      const firstUserMsg = data.messages.find(m => m.role === 'user');
      if (headerTitle) {
        if (data.title) {
          headerTitle.textContent = data.title;
        } else {
          headerTitle.textContent = (firstUserMsg && firstUserMsg.content) ? firstUserMsg.content.slice(0, 18) : '對話紀錄';
        }
      }
    } else {
      if (headerTitle) headerTitle.textContent = data.title || '新對話';
      appendMessage('assistant', '你好！已為你開啟此對話。有什麼可以幫你的？');
    }

    // ⚡ Check if this conversation is actively generating in background and auto-resume loading UI
    try {
      const statusRes = await fetch(`/api/session-status?id=${convId}`);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (statusData.isBusy) {
          setStreamingState(true);
          const existingLive = document.getElementById('resumed-live-card');
          if (!existingLive) {
            const liveCard = document.createElement('div');
            liveCard.id = 'resumed-live-card';
            liveCard.className = 'flex gap-2.5 w-full max-w-2xl mx-auto justify-start min-w-0';
            liveCard.innerHTML = `
              <div class="w-7 h-7 rounded-full bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-400 shrink-0 text-xs font-bold mt-0.5">CP</div>
              <div class="bg-slate-900 border border-indigo-500/50 text-slate-200 rounded-2xl rounded-tl-none p-3.5 text-xs sm:text-sm shadow-md flex-1 min-w-0 aurora-glow-box">
                <div class="flex items-center gap-2 text-indigo-300 font-medium">
                  <span class="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
                  <span>⚡ AI 正在背景持續生成回覆中...</span>
                </div>
              </div>
            `;
            messagesContainer.appendChild(liveCard);
            scrollToBottom(true);

            // Poll until generation completes
            const pollInterval = setInterval(async () => {
              if (currentConversationId !== convId) {
                clearInterval(pollInterval);
                return;
              }
              try {
                const checkRes = await fetch(`/api/session-status?id=${convId}`);
                if (checkRes.ok) {
                  const checkData = await checkRes.json();
                  if (!checkData.isBusy) {
                    clearInterval(pollInterval);
                    setStreamingState(false);
                    const card = document.getElementById('resumed-live-card');
                    if (card) card.remove();

                    // Reload latest history to smoothly display the completed assistant response
                    const freshRes = await fetch(`/api/history?id=${convId}`);
                    if (freshRes.ok) {
                      const freshData = await freshRes.json();
                      if (freshData.messages && freshData.messages.length > 0) {
                        const lastMsg = freshData.messages[freshData.messages.length - 1];
                        if (lastMsg.role === 'assistant') {
                          appendMessage('assistant', lastMsg.content, lastMsg.timestamp, lastMsg.tools || [], lastMsg.thinking || '', false);
                        }
                      }
                    }
                  }
                }
              } catch (e) {}
            }, 1200);
          }
        } else {
          setStreamingState(false);
        }
      }
    } catch (e) {}

  } catch (err) {
    console.error(err);
    messagesContainer.innerHTML = `<div class="p-4 text-center text-xs text-rose-400">載入歷史對話失敗：${err.message}</div>`;
  }
}

// Load Conversations List in Drawer (with Smooth Swipe-to-Delete)
async function loadConversations() {
  if (!convList) return;
  try {
    const res = await fetch('/api/conversations');
    const data = await res.json();
    convList.innerHTML = '';

    if (!data.conversations || data.conversations.length === 0) {
      convList.innerHTML = '<div class="p-4 text-center text-xs text-slate-500">尚無歷史對話</div>';
      return;
    }

    data.conversations.forEach(conv => {
      const isCurrent = conv.id === currentConversationId;
      const wrapper = document.createElement('div');
      wrapper.className = 'swipe-item-wrapper relative overflow-hidden rounded-xl mb-1.5 select-none transition-all duration-200';
      wrapper.style.maxHeight = '80px';

      wrapper.innerHTML = `
        <!-- Delete background revealed when swiping left -->
        <div class="swipe-delete-bg absolute inset-0 bg-rose-600 text-white flex items-center justify-end px-3.5 text-xs font-semibold rounded-xl select-none">
          <div class="flex items-center gap-1 text-white font-mono">
            <svg class="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span class="text-[11px]">刪除中...</span>
          </div>
        </div>

        <!-- Foreground content card (slides horizontally) -->
        <div class="swipe-item-content relative z-10 p-2.5 rounded-xl cursor-pointer flex items-center justify-between text-xs transition-transform duration-75 touch-pan-y ${
          isCurrent ? 'bg-indigo-950 text-indigo-200 border border-indigo-500/60 shadow-md' : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
        }">
          <div class="flex items-center gap-2 truncate min-w-0 flex-1 pointer-events-none">
            <svg class="w-3.5 h-3.5 shrink-0 ${isCurrent ? 'text-indigo-400' : 'text-slate-400'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
            </svg>
            <span class="truncate font-medium">${escapeHtml(conv.title)}</span>
          </div>
          <div class="flex items-center gap-1 shrink-0 ml-1.5">
            ${isCurrent ? '<span class="text-[9px] px-1.5 py-0.2 rounded-full bg-indigo-900 text-indigo-200 border border-indigo-500/60 font-mono shrink-0">目前</span>' : ''}
            <button type="button" class="rename-conv-btn p-1 rounded-lg hover:bg-slate-700/80 text-slate-400 hover:text-indigo-300 transition active:scale-95 shrink-0" title="修改對話標題">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          </div>
        </div>
      `;

      const contentEl = wrapper.querySelector('.swipe-item-content');
      const renameBtn = wrapper.querySelector('.rename-conv-btn');

      if (renameBtn) {
        renameBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          renameConversationDirect(conv.id, conv.title);
        });
        renameBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
        renameBtn.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
      }

      // Swipe Gesture Handling
      let startX = 0;
      let startY = 0;
      let currentDiffX = 0;
      let isSwiping = false;
      let isVerticalScroll = false;
      let isDeleted = false;

      const onTouchStart = (clientX, clientY) => {
        if (isDeleted) return;
        startX = clientX;
        startY = clientY;
        currentDiffX = 0;
        isSwiping = false;
        isVerticalScroll = false;
        contentEl.style.transition = 'none';
      };

      const onTouchMove = (clientX, clientY) => {
        if (isDeleted) return;
        const diffX = clientX - startX;
        const diffY = clientY - startY;

        if (!isSwiping && !isVerticalScroll) {
          if (Math.abs(diffY) > Math.abs(diffX) + 4) {
            isVerticalScroll = true;
            return;
          } else if (Math.abs(diffX) > 8) {
            isSwiping = true;
          }
        }

        if (isVerticalScroll) return;

        // Only allow swiping left
        if (diffX < 0) {
          currentDiffX = diffX;
          const visualX = diffX < -120 ? -120 + (diffX + 120) * 0.35 : diffX;
          contentEl.style.transform = `translateX(${visualX}px)`;
        } else {
          currentDiffX = 0;
          contentEl.style.transform = 'translateX(0px)';
        }
      };

      const onTouchEnd = () => {
        if (isDeleted || isVerticalScroll) return;

        // Threshold for triggering direct delete: swiped left more than 75px
        if (currentDiffX < -75) {
          isDeleted = true;
          deleteConversationDirect(conv.id, wrapper);
        } else {
          // Snap back smoothly
          contentEl.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
          contentEl.style.transform = 'translateX(0px)';
        }
      };

      // Touch Events (Mobile)
      contentEl.addEventListener('touchstart', (e) => {
        onTouchStart(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: true });

      contentEl.addEventListener('touchmove', (e) => {
        onTouchMove(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: true });

      contentEl.addEventListener('touchend', onTouchEnd, { passive: true });
      contentEl.addEventListener('touchcancel', onTouchEnd, { passive: true });

      // Pointer / Mouse Events (Desktop testing or mouse users)
      contentEl.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return;
        onTouchStart(e.clientX, e.clientY);
        const onPointerMove = (moveEvent) => onTouchMove(moveEvent.clientX, moveEvent.clientY);
        const onPointerUp = () => {
          window.removeEventListener('pointermove', onPointerMove);
          window.removeEventListener('pointerup', onPointerUp);
          onTouchEnd();
        };
        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
      });

      // Click to open conversation history (only when not swiping)
      contentEl.addEventListener('click', (e) => {
        if (e.target.closest('.rename-conv-btn')) return;
        if (!isDeleted && Math.abs(currentDiffX) < 10) {
          loadConversationHistory(conv.id);
        }
      });

      convList.appendChild(wrapper);
    });
  } catch (err) {
    convList.innerHTML = '<div class="p-4 text-center text-xs text-red-400">載入失敗</div>';
  }
}

// Toggle Send / Stop button appearance & state
function setStreamingState(streaming) {
  isStreaming = streaming;
  if (!sendBtn || !sendIcon || !stopIcon) return;
  if (streaming) {
    sendBtn.classList.remove('bg-indigo-600', 'hover:bg-indigo-500', 'active:bg-indigo-700', 'shadow-indigo-600/30');
    sendBtn.classList.add('bg-rose-600', 'hover:bg-rose-500', 'active:bg-rose-700', 'shadow-rose-600/30');
    sendIcon.classList.add('hidden');
    stopIcon.classList.remove('hidden');
    sendBtn.title = '中斷生成';
  } else {
    sendBtn.classList.remove('bg-rose-600', 'hover:bg-rose-500', 'active:bg-rose-700', 'shadow-rose-600/30');
    sendBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-500', 'active:bg-indigo-700', 'shadow-indigo-600/30');
    sendIcon.classList.remove('hidden');
    stopIcon.classList.add('hidden');
    sendBtn.title = '送出';
  }
}

// Stop active generation
async function stopGeneration() {
  if (typeof streamingTTS !== 'undefined') {
    streamingTTS.stop();
  }
  if (currentAbortController) {
    try {
      currentAbortController.abort();
    } catch (e) {}
    currentAbortController = null;
  }
  try {
    await fetch('/api/stop', { method: 'POST' });
  } catch (e) {}
  if (navigator.vibrate) {
    navigator.vibrate([40, 40, 40]);
  }
  setStreamingState(false);
}

// Send Message with Live Streaming, Tools Logging, and Abort Support
async function sendMessage() {
  const text = promptInput.value.trim();
  const imgPath = uploadedImagePath;

  if (!text && !imgPath) return;
  if (isStreaming) return;

  if (text.toLowerCase() === '/clear') {
    promptInput.value = '';
    promptInput.style.height = 'auto';
    uploadedImagePath = null;
    if (cameraInput) cameraInput.value = '';
    if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
    if (newChatBtn) newChatBtn.click();
    if (navigator.vibrate) navigator.vibrate([20, 20]);
    return;
  }

  // 📦 /compact - Memory Compaction & Context Pruning
  if (/^\/compact\b/i.test(text)) {
    promptInput.value = '';
    promptInput.style.height = 'auto';
    uploadedImagePath = null;
    if (cameraInput) cameraInput.value = '';
    if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');

    if (!currentConversationId) {
      appendMessage('assistant', '⚠️ 當前為新對話，尚未有歷史紀錄可供壓縮。請在對話累積後再執行 `/compact` 進行精簡！');
      return;
    }

    const focusText = text.replace(/^\/compact\s*/i, '').trim();
    appendMessage('user', text, undefined, [], '', false);

    const compactingMsgDiv = document.createElement('div');
    compactingMsgDiv.className = 'flex gap-2.5 w-full max-w-2xl mx-auto justify-start min-w-0';
    compactingMsgDiv.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-cyan-600/30 border border-cyan-500/50 flex items-center justify-center text-cyan-300 shrink-0 text-xs font-bold mt-0.5">📦</div>
      <div class="bg-slate-900/90 border border-cyan-500/50 text-slate-200 rounded-2xl rounded-tl-none p-3.5 text-xs sm:text-sm shadow-xl flex-1 min-w-0 prose thinking-active-glow">
        <div class="flex items-center gap-2 text-cyan-300 font-bold mb-1.5">
          <span class="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
          <span>📦 正在深度提煉並精簡壓縮對話記憶...</span>
        </div>
        <p class="text-slate-400 text-xs leading-relaxed">
          AI 正在梳理核心目標、已完成模組、關鍵檔案與當前脈絡，為您釋放 Token 並精簡上下文...
        </p>
      </div>
    `;
    messagesContainer.appendChild(compactingMsgDiv);
    scrollToBottom(true);

    try {
      const res = await fetch('/api/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: currentConversationId,
          focus: focusText
        })
      });
      const data = await res.json();
      compactingMsgDiv.remove();

      if (data.success && data.summary) {
        messagesContainer.innerHTML = '';
        
        const cardDiv = document.createElement('div');
        cardDiv.className = 'flex gap-2.5 w-full max-w-2xl mx-auto justify-start min-w-0 my-2';
        cardDiv.innerHTML = `
          <div class="w-7 h-7 rounded-full bg-cyan-600/30 border border-cyan-500/50 flex items-center justify-center text-cyan-300 shrink-0 text-xs font-bold mt-0.5">📦</div>
          <div class="bg-gradient-to-b from-slate-900 via-slate-900 to-cyan-950/30 border border-cyan-500/60 text-slate-200 rounded-2xl rounded-tl-none p-4 text-xs sm:text-sm shadow-2xl flex-1 min-w-0 prose">
            <div class="flex items-center justify-between border-b border-cyan-800/60 pb-2 mb-3 select-none">
              <span class="px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 text-[11px] font-mono font-bold flex items-center gap-1.5">
                <span>📦</span>
                <span>對話記憶已精簡壓縮 (Compacted Memory)</span>
              </span>
              <span class="text-[10px] text-emerald-400 font-mono font-semibold">✓ 釋放 ~85% Tokens</span>
            </div>
            <div class="text-slate-300 leading-relaxed space-y-2">
              ${formatMessageContent(data.summary)}
            </div>
            <div class="mt-3 pt-2 border-t border-slate-800 text-[11px] text-slate-400 flex items-center justify-between">
              <span>💡 後續提問將自動繼承這份精華記憶繼續展開</span>
              <span class="text-[10px] text-slate-500 font-mono">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        `;
        messagesContainer.appendChild(cardDiv);
        if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(cardDiv);
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
        scrollToBottom(true);
      } else {
        appendMessage('assistant', `⚠️ 壓縮失敗：${data.error || '未知錯誤'}`);
      }
    } catch (e) {
      compactingMsgDiv.remove();
      appendMessage('assistant', `⚠️ 壓縮請求失敗：${e.message}`);
    }
    return;
  }

  if (!isOnline && !navigator.onLine) {
    alert('⚠️ 手機目前處於離線狀態，請檢查 Wi-Fi 或行動數據連線！');
    if (navigator.vibrate) navigator.vibrate([40, 80, 40]);
    return;
  }

  currentAbortController = new AbortController();
  setStreamingState(true);

  const activeStreamConvId = currentConversationId;
  const isNewConversation = !activeStreamConvId;
  const isBtwQuery = /^\s*\/btw\b/i.test(text);

  let userDisplay = text;
  if (imgPath) userDisplay = `[Uploaded Image: ${imgPath}]\n${userDisplay}`;
  appendMessage('user', userDisplay, undefined, [], '', isBtwQuery);

  promptInput.value = '';
  promptInput.style.height = 'auto';
  uploadedImagePath = null;
  if (cameraInput) cameraInput.value = '';
  if (typeof attachInput !== 'undefined' && attachInput) attachInput.value = '';
  if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');

  const liveTools = [];
  let liveThinking = '';
  const startTs = performance.now();

  const modelObj = availableModels.find(m => m.id === currentModel);
  const modelLabel = modelObj ? modelObj.name : 'AI';

  const assistantMsgDiv = document.createElement('div');
  assistantMsgDiv.className = 'flex gap-2.5 w-full max-w-2xl mx-auto justify-start min-w-0';

  const avatarHtml = isBtwQuery
    ? `<div class="w-7 h-7 rounded-full bg-teal-600/30 border border-teal-500/50 flex items-center justify-center text-teal-300 shrink-0 text-xs font-bold mt-0.5">CP</div>`
    : `<div class="w-7 h-7 rounded-full bg-indigo-600/30 border border-indigo-500/50 flex items-center justify-center text-indigo-400 shrink-0 text-xs font-bold mt-0.5">CP</div>`;

  const bubbleClass = isBtwQuery
    ? 'btw-card bg-gradient-to-b from-slate-900 via-slate-900 to-teal-950/40 border border-teal-500/50 text-slate-200 rounded-2xl rounded-tl-none p-3.5 text-xs sm:text-sm shadow-lg shadow-teal-950/30 flex-1 min-w-0 prose'
    : 'bg-slate-900 border border-slate-800 text-slate-200 rounded-2xl rounded-tl-none p-3.5 text-xs sm:text-sm shadow-md flex-1 min-w-0 prose';

  const shimmerClass = isBtwQuery ? 'shimmer-bar-teal' : 'shimmer-bar';
  const statusBorderClass = isBtwQuery ? 'border-teal-500/40 from-slate-900 to-teal-950/40' : 'border-indigo-500/30 from-slate-900 to-indigo-950/40';
  const statusBadgeClass = isBtwQuery ? 'bg-teal-500/20 text-teal-300 border-teal-500/40' : 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
  const statusInitText = isBtwQuery ? '💬 順帶一提解答中...' : '🧠 思考分析中...';

  assistantMsgDiv.innerHTML = `
    ${avatarHtml}
    <div class="${bubbleClass}">
      
      <!-- Live Cyberpunk Status Bar with Universal Aurora Glow (All Models) -->
      <div class="live-status mb-2.5 rounded-2xl bg-gradient-to-b ${statusBorderClass} ${isBtwQuery ? 'aurora-glow-box-teal' : 'aurora-glow-box'} border overflow-hidden shadow-lg select-none">
        <div class="${shimmerClass} h-[2px] w-full"></div>
        <div class="p-2.5 flex flex-col gap-2">
          <!-- Top Row: Phase + Counters -->
          <div class="flex items-center justify-between gap-2 flex-wrap">
            <div class="flex items-center gap-1.5 min-w-0">
              <span class="inline-block w-2 h-2 rounded-full ${isBtwQuery ? 'bg-teal-400' : 'bg-indigo-400'} animate-ping shrink-0"></span>
              <span class="text-[9px] px-1.5 py-0.5 rounded border font-mono font-semibold ${statusBadgeClass} shrink-0">${escapeHtml(modelLabel)}</span>
              <span class="status-text truncate font-medium text-[11px] text-slate-200">${statusInitText}</span>
            </div>
            <!-- Counters: Tokens + Speed + Timer (Idea 3) -->
            <div class="flex items-center gap-1.5 shrink-0 text-[10px] font-mono">
              <span class="live-tokens text-emerald-300 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-800/60 hidden">🪙 0 tok</span>
              <span class="live-speed text-indigo-300 bg-indigo-900/40 px-1.5 py-0.5 rounded border border-indigo-700/50 hidden">⚡ 0 t/s</span>
              <span class="live-timer font-bold text-slate-200 bg-slate-800/90 px-1.5 py-0.5 rounded border border-slate-700">0.0s</span>
            </div>
          </div>
          
          <!-- Step-by-Step Pipeline Pills (Idea 4) -->
          <div class="live-pipeline flex flex-wrap items-center gap-1 text-[10px] font-mono border-t border-slate-800/80 pt-1.5">
            <span class="pipeline-pill pill-init px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-700/60 text-indigo-300 flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
              <span>🧠 思考分析</span>
            </span>
          </div>
        </div>
      </div>

      <div class="thinking-container"></div>
      <div class="tools-container"></div>
      <div class="btw-content msg-content leading-relaxed min-w-0"><span class="inline-block w-2 h-4 ${isBtwQuery ? 'bg-teal-400' : 'bg-indigo-400'} animate-pulse"></span></div>
    </div>
  `;
  messagesContainer.appendChild(assistantMsgDiv);
  const contentElem = assistantMsgDiv.querySelector('.msg-content');
  const liveStatusElem = assistantMsgDiv.querySelector('.live-status');
  const statusTextElem = assistantMsgDiv.querySelector('.status-text');
  const liveTimerElem = assistantMsgDiv.querySelector('.live-timer');
  const liveTokensElem = assistantMsgDiv.querySelector('.live-tokens');
  const liveSpeedElem = assistantMsgDiv.querySelector('.live-speed');
  const livePipelineElem = assistantMsgDiv.querySelector('.live-pipeline');
  const thinkingContainerElem = assistantMsgDiv.querySelector('.thinking-container');
  const toolsContainerElem = assistantMsgDiv.querySelector('.tools-container');
  scrollToBottom();

  // Pipeline State Tracker
  const pipelineSteps = new Map();
  pipelineSteps.set('init', { label: '🧠 思考分析', status: 'running' });

  function renderPipeline() {
    if (!livePipelineElem) return;
    const html = Array.from(pipelineSteps.values()).map(step => {
      const isDone = step.status === 'done';
      const isRunning = step.status === 'running';
      const badgeClass = isDone
        ? 'bg-slate-900 border-slate-700/80 text-slate-400'
        : isRunning
        ? 'bg-indigo-950/90 border-indigo-500/70 text-indigo-300 shadow-sm'
        : 'bg-slate-950/50 border-slate-800 text-slate-500';
      const icon = isDone
        ? '<span class="text-emerald-400 font-bold">✓</span>'
        : isRunning
        ? '<span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping"></span>'
        : '<span class="w-1.5 h-1.5 rounded-full bg-slate-600"></span>';
      return `<span class="px-2 py-0.5 rounded-full border text-[10px] flex items-center gap-1 font-mono ${badgeClass}">${icon}<span>${escapeHtml(step.label)}</span></span>`;
    }).join('');
    livePipelineElem.innerHTML = html;
  }

  const liveTimerInterval = setInterval(() => {
    const elapsedSec = (performance.now() - startTs) / 1000;
    if (liveTimerElem) liveTimerElem.textContent = `${elapsedSec.toFixed(1)}s`;
    if (accumulatedText.length > 0) {
      const estTokens = Math.round(accumulatedText.length / 2);
      if (liveTokensElem) {
        liveTokensElem.textContent = `🪙 ${estTokens} tok`;
        liveTokensElem.classList.remove('hidden');
      }
      if (liveSpeedElem) {
        const speed = Math.round(estTokens / Math.max(0.2, elapsedSec));
        if (speed > 0) {
          liveSpeedElem.textContent = `⚡ ${speed} t/s`;
          liveSpeedElem.classList.remove('hidden');
        }
      }
    }
  }, 100);

  let accumulatedText = '';
  let abortedHandled = false;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: text,
        conversation_id: activeStreamConvId,
        image_path: imgPath,
        model: currentModel,
        effort: (typeof currentEffort !== 'undefined') ? currentEffort : 'low'
      }),
      signal: currentAbortController.signal
    });

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = 'message';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line === '') {
          currentEvent = 'message';
        } else if (line.startsWith('event:')) {
          currentEvent = line.replace('event:', '').trim();
        } else if (line.startsWith('data:')) {
          const rawData = line.replace('data:', '').trim();
          if (!rawData) continue;
          try {
            const data = JSON.parse(rawData);
            if (currentEvent === 'init' && data.conversation_id) {
              // 🛡️ Only update global currentConversationId if user hasn't switched to another conversation
              if (currentConversationId === activeStreamConvId || currentConversationId === null) {
                currentConversationId = data.conversation_id;
                localStorage.setItem('agy_active_conv_id', currentConversationId);
              }
            } else if (currentEvent === 'thought') {
              const initStep = pipelineSteps.get('init');
              if (initStep) initStep.status = 'done';
              pipelineSteps.set('thought', { label: '💡 深度推理', status: 'running' });
              renderPipeline();

              liveThinking += (data.delta || data.thinking || data.fullThinking || '');
              thinkingContainerElem.innerHTML = buildThinkingBlockHtml(liveThinking, true);
              statusTextElem.textContent = '💡 深度推理思考中...';
              if (userScrolledUp) {
                const scrollBadge = document.getElementById('scroll-bottom-badge');
                if (scrollBadge) scrollBadge.classList.remove('hidden');
              }
              scrollToBottom();
            } else if (currentEvent === 'tool') {
              const initStep = pipelineSteps.get('init');
              if (initStep) initStep.status = 'done';
              const thoughtStep = pipelineSteps.get('thought');
              if (thoughtStep) thoughtStep.status = 'done';

              liveTools.push(data);
              const d = getToolDetails(data);
              pipelineSteps.set(`tool_${liveTools.length}`, { label: `${d.icon} ${d.label}`, status: 'done' });
              renderPipeline();

              statusTextElem.textContent = `${d.icon} ${d.label}: ${d.desc}`;
              toolsContainerElem.innerHTML = buildToolsAccordionHtml(liveTools);
              if (userScrolledUp) {
                const scrollBadge = document.getElementById('scroll-bottom-badge');
                if (scrollBadge) scrollBadge.classList.remove('hidden');
              }
              scrollToBottom();
            } else if (currentEvent === 'chunk' && data.accumulated) {
              const initStep = pipelineSteps.get('init');
              if (initStep) initStep.status = 'done';
              const thoughtStep = pipelineSteps.get('thought');
              if (thoughtStep) thoughtStep.status = 'done';
              pipelineSteps.set('writing', { label: '✍️ 組織撰寫', status: 'running' });
              renderPipeline();

              statusTextElem.textContent = '✍️ 回覆組織撰寫中...';
              accumulatedText = data.accumulated;
              contentElem.innerHTML = formatMessageContent(accumulatedText);

              if (liveThinking) thinkingContainerElem.innerHTML = buildThinkingBlockHtml(liveThinking, false);
              if (userScrolledUp) {
                const scrollBadge = document.getElementById('scroll-bottom-badge');
                if (scrollBadge) scrollBadge.classList.remove('hidden');
              }
              scrollToBottom();
            } else if (currentEvent === 'done') {
              clearInterval(liveTimerInterval);
              liveStatusElem.style.display = 'none';

              const targetDoneConvId = data.conversation_id || activeStreamConvId;
              if (targetDoneConvId && (currentConversationId === activeStreamConvId || currentConversationId === null)) {
                currentConversationId = targetDoneConvId;
                localStorage.setItem('agy_active_conv_id', currentConversationId);
              }
              if (data.response) accumulatedText = data.response;
              contentElem.innerHTML = formatMessageContent(accumulatedText);
              toolsContainerElem.innerHTML = buildToolsAccordionHtml(liveTools);
              if (liveThinking) {
                thinkingContainerElem.innerHTML = buildThinkingBlockHtml(liveThinking);
              }

              const totalSec = ((performance.now() - startTs) / 1000).toFixed(1);
              const estTokens = Math.round(accumulatedText.length / 2);
              const avgSpeed = Math.round(estTokens / Math.max(0.5, totalSec));

              if (isBtwQuery) {
                let btwHeader = assistantMsgDiv.querySelector('.btw-header');
                const cardEl = assistantMsgDiv.querySelector('.btw-card');
                if (!btwHeader && cardEl) {
                  btwHeader = document.createElement('div');
                  btwHeader.className = 'btw-header flex items-center justify-between border-b border-teal-800/60 pb-1.5 mb-2 select-none';
                  btwHeader.innerHTML = `
                    <span class="px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/40 text-[10px] font-mono font-semibold flex items-center gap-1">
                      <span class="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span>
                      💬 順帶一提 · 支線解答
                    </span>
                    <button type="button" class="btw-toggle-btn text-[10px] text-teal-400 hover:text-teal-200 font-mono transition px-1.5 py-0.5 rounded hover:bg-teal-900/40">收合 ▲</button>
                  `;
                  cardEl.insertBefore(btwHeader, cardEl.firstChild);
                  const toggleBtn = btwHeader.querySelector('.btw-toggle-btn');
                  toggleBtn.addEventListener('click', () => {
                    const isCollapsed = cardEl.classList.toggle('collapsed');
                    toggleBtn.textContent = isCollapsed ? '展開 ▼' : '收合 ▲';
                  });
                }
              }

              // Append Action Footer with Stats, TTS and Copy All
              let footer = assistantMsgDiv.querySelector('.msg-footer');
              if (!footer) {
                footer = document.createElement('div');
                footer.className = 'msg-footer mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-400 select-none';
                const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                footer.innerHTML = `
                  <div class="flex items-center gap-2">
                    <button type="button" class="tts-btn px-2 py-0.5 rounded-md hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition flex items-center gap-1 active:scale-95">
                      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"/>
                      </svg>
                      <span class="text-[10px]">朗讀</span>
                    </button>
                  </div>
                  <div class="flex items-center gap-1.5 text-[10px] text-slate-500 font-mono">
                    <span class="text-slate-400">⏱️ ${totalSec}s</span>
                    ${avgSpeed > 0 ? `<span class="text-indigo-400/80">· ⚡ ${avgSpeed} t/s</span>` : ''}
                    <span>· ${timeStr}</span>
                  </div>
                `;
                const bubbleEl = assistantMsgDiv.querySelector('.btw-card') || assistantMsgDiv.querySelector('.bg-slate-900');
                if (bubbleEl) bubbleEl.appendChild(footer);
                const ttsBtn = footer.querySelector('.tts-btn');
                ttsBtn.addEventListener('click', () => toggleSpeech(accumulatedText, ttsBtn));
              }

              if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(assistantMsgDiv);
              assistantMsgDiv.querySelectorAll('img').forEach(img => {
                img.addEventListener('click', () => showLightbox(img.src));
              });

              if (document.hidden) {
                triggerDoneNotification(accumulatedText);
              }

              if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

              // 🏷️ Auto-generate AI conversation title for new conversations
              if (isNewConversation && targetDoneConvId && text) {
                generateConversationTitle(targetDoneConvId, text, accumulatedText);
              }
            }
          } catch (e) {}
        }
      }
    }
  } catch (err) {
    clearInterval(liveTimerInterval);
    liveStatusElem.style.display = 'none';
    if (err.name === 'AbortError') {
      abortedHandled = true;
      const abortBadge = document.createElement('div');
      abortBadge.className = 'mt-2 pt-1.5 border-t border-slate-800 text-[11px] text-amber-400 font-mono flex items-center gap-1';
      abortBadge.innerHTML = `<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg><span>[已手動中斷生成]</span>`;
      assistantMsgDiv.querySelector('.bg-slate-900').appendChild(abortBadge);
      if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(assistantMsgDiv);
    } else {
      // Graceful Disconnection Recovery
      console.warn('[SSE Disconnect] Stream interrupted:', err);
      
      if (accumulatedText && accumulatedText.trim()) {
        contentElem.innerHTML = formatMessageContent(accumulatedText);
        
        const recoveryBadge = document.createElement('div');
        recoveryBadge.className = 'recovery-badge mt-2 p-1.5 rounded-lg bg-indigo-950/60 border border-indigo-500/40 text-[10px] text-indigo-300 font-mono flex items-center justify-between gap-2';
        recoveryBadge.innerHTML = `
          <span class="flex items-center gap-1.5">
            <span class="inline-block w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
            <span>連線暫時重置，正在自動補齊完整回覆...</span>
          </span>
        `;
        assistantMsgDiv.querySelector('.bg-slate-900').appendChild(recoveryBadge);

        if (currentConversationId) {
          let attempts = 0;
          const checkHistory = async () => {
            attempts++;
            try {
              const hRes = await fetch(`/api/history?id=${currentConversationId}`);
              if (hRes.ok) {
                const hData = await hRes.json();
                if (hData.messages && hData.messages.length > 0) {
                  const lastAssistant = [...hData.messages].reverse().find(m => m.role === 'assistant');
                  if (lastAssistant && lastAssistant.content && lastAssistant.content.length >= accumulatedText.length) {
                    accumulatedText = lastAssistant.content;
                    contentElem.innerHTML = formatMessageContent(accumulatedText);
                    if (lastAssistant.tools && lastAssistant.tools.length > 0) {
                      toolsContainerElem.innerHTML = buildToolsAccordionHtml(lastAssistant.tools);
                    }
                    if (lastAssistant.thinking) {
                      thinkingContainerElem.innerHTML = buildThinkingBlockHtml(lastAssistant.thinking);
                    }
                    recoveryBadge.innerHTML = `
                      <span class="flex items-center gap-1.5 text-emerald-300">
                        <span class="text-emerald-400 font-bold">✓</span>
                        <span>已成功同步並補齊完整回覆</span>
                      </span>
                    `;
                    setTimeout(() => recoveryBadge.remove(), 4000);
                    if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(assistantMsgDiv);
                    return;
                  }
                }
              }
            } catch (e) {}

            if (attempts < 4) {
              setTimeout(checkHistory, attempts * 1500);
            } else {
              recoveryBadge.innerHTML = `
                <span class="flex items-center gap-1 text-slate-400">
                  <span>⚠️ 已保留現有回覆內容</span>
                </span>
                <button type="button" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px]" onclick="loadConversationHistory('${currentConversationId}')">🔄 重整</button>
              `;
            }
          };
          setTimeout(checkHistory, 1200);
        }
      } else {
        contentElem.innerHTML = `
          <div class="p-2 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center justify-between">
            <span>連線中斷（${escapeHtml(err.message)}）</span>
            <button type="button" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px]" onclick="sendMessage()">重試</button>
          </div>
        `;
      }

      if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(assistantMsgDiv);
    }
  } finally {
    clearInterval(liveTimerInterval);
    liveStatusElem.style.display = 'none';
    setStreamingState(false);
    currentAbortController = null;
    scrollToBottom();
  }
}

function handleSendClick(e) {
  if (e) {
    if (e.cancelable) e.preventDefault();
    e.stopPropagation();
  }

  if (isStreaming) {
    if (Date.now() - streamingStartedAt > 800) {
      if (navigator.vibrate) navigator.vibrate([40, 40, 40]);
      stopGeneration();
    }
  } else {
    streamingStartedAt = Date.now();
    if (navigator.vibrate) navigator.vibrate(25);
    if (slashMenu) slashMenu.classList.add('hidden');
    sendMessage();
  }
}

// 🏷️ Auto-generate AI conversation title (fires in background, non-blocking)
async function generateConversationTitle(convId, userMessage, assistantResponse) {
  try {
    // Show a temporary shimmer on the header title
    if (headerTitle) {
      headerTitle.innerHTML = `<span class="inline-flex items-center gap-1 text-slate-400"><span class="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span> 標題生成中...</span>`;
    }

    const res = await fetch('/api/generate-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: convId,
        user_message: userMessage,
        assistant_response: assistantResponse
      })
    });

    const data = await res.json();
    if (data.success && data.title) {
      // Update header title
      if (headerTitle) {
        headerTitle.textContent = data.title;
      }

      // Update sidebar entry if visible
      if (convList) {
        const sidebarEntries = convList.querySelectorAll('div');
        sidebarEntries.forEach(entry => {
          const titleSpan = entry.querySelector('.truncate');
          if (titleSpan && entry.textContent.includes(convId.slice(0, 8))) {
            titleSpan.textContent = data.title;
          }
        });
      }

      // Also refresh sidebar to ensure consistency
      if (typeof loadConversations === 'function') {
        loadConversations();
      }

      console.log(`[AutoTitle] Generated: "${data.title}" (cached: ${data.cached})`);
    } else {
      // Fallback: use first 18 chars of user message
      if (headerTitle) {
        headerTitle.textContent = userMessage.slice(0, 18) + (userMessage.length > 18 ? '...' : '');
      }
    }
  } catch (err) {
    console.warn('[AutoTitle] Failed:', err.message);
    // Fallback
    if (headerTitle) {
      headerTitle.textContent = userMessage.slice(0, 18) + (userMessage.length > 18 ? '...' : '');
    }
  }
}
