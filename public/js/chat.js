// Antigravity Web UI - Chat Messaging, SSE Streaming, and History Management

// Configure marked.js to render all Markdown links with target="_blank" and rel="noopener noreferrer"
if (typeof marked !== 'undefined' && marked.use) {
  marked.use({
    renderer: {
      link(arg1, arg2, arg3) {
        let href, title, text;
        if (typeof arg1 === 'object' && arg1 !== null) {
          href = arg1.href || '';
          title = arg1.title || '';
          text = arg1.text || '';
        } else {
          href = arg1 || '';
          title = arg2 || '';
          text = arg3 || '';
        }
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${titleAttr} class="text-indigo-400 hover:text-indigo-300 underline underline-offset-2 transition">${text}</a>`;
      }
    }
  });
}

// 🛡️ Auto-Wrap Unfenced HTML/SVG into standalone ```html code blocks
function autoFenceHtmlDocuments(text) {
  if (!text) return '';

  // 1. Temporarily replace all existing properly fenced code blocks
  const existingFences = [];
  let masked = text.replace(/```[\s\S]*?```/g, (match) => {
    existingFences.push(match);
    return `___EXISTING_FENCE_${existingFences.length - 1}___`;
  });

  // 2. Wrap standalone unfenced <!DOCTYPE ...> ... </html> or <html ... </html>
  masked = masked.replace(/(<!DOCTYPE\b[\s\S]*?(?:<\/html>|$)|<html\b[^>]*>[\s\S]*?(?:<\/html>|$))/gi, (match) => {
    const trimmed = match.trim();
    if (!trimmed) return match;
    return `\n\`\`\`html\n${trimmed}\n\`\`\`\n`;
  });

  // 3. Wrap standalone unfenced <svg ... </svg>
  masked = masked.replace(/(<svg\b[^>]*>[\s\S]*?(?:<\/svg>|$))/gi, (match) => {
    const trimmed = match.trim();
    if (!trimmed) return match;
    return `\n\`\`\`svg\n${trimmed}\n\`\`\`\n`;
  });

  // 4. Restore existing fenced code blocks
  masked = masked.replace(/___EXISTING_FENCE_(\d+)___/g, (match, index) => {
    return existingFences[index];
  });

  return masked;
}

// Transform local image paths into proxy URL and sanitize with DOMPurify
function formatMessageContent(content) {
  if (!content) return '';
  
  let formatted = content;

  // 🛡️ Auto-detect and separate unfenced HTML / SVG into their own ```html blocks
  formatted = autoFenceHtmlDocuments(formatted);

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

  const rawHtml = typeof marked !== 'undefined' && typeof marked.parse === 'function' ? marked.parse(formatted) : formatted;
  if (typeof DOMPurify !== 'undefined') {
    return DOMPurify.sanitize(rawHtml, {
      ADD_ATTR: ['target', 'rel', 'class', 'style', 'data-enhanced', 'data-cmd', 'data-desc', 'data-fill'],
      ADD_TAGS: ['iframe', 'canvas', 'details', 'summary', 'svg', 'path', 'g', 'rect', 'circle', 'line'],
      USE_PROFILES: { html: true, svg: true }
    });
  }
  return rawHtml;
}

function imageProxyUrl(imagePath, thumbnail = false) {
  const url = new URL('/api/image', window.location.origin);
  url.searchParams.set('path', imagePath);
  if (thumbnail) url.searchParams.set('thumbnail', '1');
  return `${url.pathname}${url.search}`;
}

function prepareDeferredImages(root) {
  if (!root) return;
  root.querySelectorAll('img').forEach(img => {
    img.loading = 'lazy';
    img.decoding = 'async';
    img.fetchPriority = 'low';

    const fullSrc = img.dataset.fullSrc || img.getAttribute('src') || '';
    if (!img.dataset.fullSrc && fullSrc) {
      try {
        const sourceUrl = new URL(fullSrc, window.location.origin);
        if (sourceUrl.pathname === '/api/image' && sourceUrl.searchParams.get('path')) {
          sourceUrl.searchParams.set('thumbnail', '1');
          img.dataset.fullSrc = fullSrc;
          img.src = `${sourceUrl.pathname}${sourceUrl.search}`;
        }
      } catch (err) {
        // External or malformed image URLs retain their original source.
      }
    }

    if (img.dataset.lightboxBound) return;
    img.dataset.lightboxBound = 'true';
    img.addEventListener('click', () => showLightbox(img.dataset.fullSrc || img.currentSrc || img.src));
  });
}

// Helper: format tool info with rich metadata, category badges & icons
function getToolDetails(tool) {
  const name = tool.name || tool.tool_name || 'action';
  const normalizedName = String(name).toLowerCase();
  const args = tool.args || (tool.tool_info && tool.tool_info.parameters) || {};
  let icon = '⚙️';
  let label = '系統動作';
  let badgeColor = 'bg-slate-800 text-slate-300 border-slate-700';
  let desc = name;

  if (name === 'run_command' || /commandexecution|exec_command|shell_command|shellcommand/.test(normalizedName)) {
    icon = '💻';
    label = '終端指令';
    badgeColor = 'bg-amber-950/40 text-amber-300 border-amber-800/60';
    const rawCommand = args.CommandLine || args.command || args.cmd || '';
    const cmd = Array.isArray(rawCommand) ? rawCommand.join(' ') : String(rawCommand || '');
    desc = cmd ? `$ ${compactCommandText(cmd, 54)}` : '執行終端命令';
  } else if (name === 'view_file' || /read_file|readfile|file_read|imageview/.test(normalizedName)) {
    icon = '📄';
    label = '檢視檔案';
    badgeColor = 'bg-blue-950/40 text-blue-300 border-blue-800/60';
    const p = (args.AbsolutePath || '').split('/').pop();
    desc = p ? `讀取 ${p}` : '檢視檔案內容';
  } else if (name === 'replace_file_content' || /filechange|apply_patch|applypatch|edit_file|editfile/.test(normalizedName)) {
    icon = '📝';
    label = '編輯修改';
    badgeColor = 'bg-emerald-950/40 text-emerald-300 border-emerald-800/60';
    const change = Array.isArray(args.changes) ? args.changes[0] : null;
    const changePath = change && typeof change === 'object'
      ? (change.path || change.file || change.file_path || change.target)
      : '';
    const p = String(args.TargetFile || args.path || args.file || changePath || '').split('/').pop();
    desc = p ? `修改 ${p}` : '修改檔案';
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
  } else if (name === 'search_web' || /websearch|web_search/.test(normalizedName)) {
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


function compactProgressText(value, maxLength = 64) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function compactCommandText(value, maxLength = 64) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.length > maxLength ? `…${text.slice(-(maxLength - 1))}` : text;
}

function firstToolPath(args) {
  if (!args || typeof args !== 'object') return '';
  const direct = args.TargetFile || args.AbsolutePath || args.path || args.file_path || args.file || args.target;
  if (direct) return String(direct).split('/').pop();

  const changes = args.changes;
  if (Array.isArray(changes) && changes.length > 0) {
    const first = changes[0];
    if (typeof first === 'string') return first.split('/').pop();
    if (first && typeof first === 'object') {
      const path = first.path || first.file || first.file_path || first.target;
      if (path) return String(path).split('/').pop();
    }
  } else if (changes && typeof changes === 'object') {
    const firstKey = Object.keys(changes)[0];
    if (firstKey) return firstKey.split('/').pop();
  }
  return '';
}

function getPassiveToolProgress(tool) {
  const name = String(tool?.name || tool?.tool_name || 'action');
  const normalizedName = name.toLowerCase();
  const args = getToolGroupingArgs(tool || {});
  const path = firstToolPath(args);
  const query = compactProgressText(args.Query || args.query || args.Pattern || args.pattern || '', 46);
  const rawCommand = args.CommandLine || args.command || args.cmd || '';
  const command = compactCommandText(Array.isArray(rawCommand) ? rawCommand.join(' ') : rawCommand, 54);

  if (/run_command|commandexecution|exec_command|shell_command|shellcommand/.test(normalizedName)) {
    return { icon: '💻', text: command ? `執行指令 · ${command}` : '執行終端指令' };
  }
  if (/view_file|read_file|readfile|file_read|imageview/.test(normalizedName)) {
    return { icon: '📄', text: path ? `讀取檔案 · ${path}` : '讀取檔案內容' };
  }
  if (/replace_file_content|filechange|apply_patch|applypatch|edit_file|editfile/.test(normalizedName)) {
    return { icon: '📝', text: path ? `修改檔案 · ${path}` : '修改檔案內容' };
  }
  if (/write_to_file|writefile|create_file|createfile/.test(normalizedName)) {
    return { icon: '💾', text: path ? `寫入檔案 · ${path}` : '寫入檔案' };
  }
  if (/grep_search|code_search|codesearch|find_by_name|search_files|searchfiles/.test(normalizedName)) {
    return { icon: '🔍', text: query ? `搜尋程式碼 · ${query}` : '搜尋相關程式碼' };
  }
  if (/search_web|websearch|web_search/.test(normalizedName)) {
    return { icon: '🌐', text: query ? `搜尋網路 · ${query}` : '搜尋網路資料' };
  }
  if (/list_dir|listdir|directory/.test(normalizedName)) {
    return { icon: '📂', text: path ? `查看目錄 · ${path}` : '查看檔案目錄' };
  }
  if (/subagent|collabagent|agenttool/.test(normalizedName)) {
    return { icon: '🤖', text: '執行子代理工作' };
  }
  if (/mcp|dynamictool/.test(normalizedName)) {
    return { icon: '🔌', text: `執行外部工具 · ${compactProgressText(name, 42)}` };
  }

  const details = getToolDetails(tool || {});
  return {
    icon: details.icon || '⚙️',
    text: compactProgressText(details.desc || details.label || name, 64) || '執行系統操作'
  };
}

function toolProgressState(tool) {
  const state = getToolState(tool);
  if (['failed', 'error', 'cancelled', 'canceled', 'interrupted'].includes(state)) return 'failed';
  if (isTerminalToolState(state)) return 'done';
  return 'running';
}

// Progress UI is deliberately passive: it never sends prompts, requests, or extra
// tool calls. It only translates SSE events that the current turn already emits.

function formatToolSummary(tool) {
  const d = getToolDetails(tool);
  return `${d.icon} ${d.label}: ${d.desc}`;
}

function getToolGroupingArgs(tool) {
  return tool.args || (tool.tool_info && tool.tool_info.parameters) || {};
}

function serializeToolGroupingArgs(value) {
  if (typeof value === 'string') return value.slice(0, 1600);
  try { return JSON.stringify(value).slice(0, 1600); }
  catch (_) { return String(value).slice(0, 1600); }
}

function getToolGroupKey(tool, fallbackIndex = 0) {
  const explicit = tool.tool_group_id || tool.toolGroupId || tool.tool_id || tool.toolId || tool.id;
  if (explicit) return `tool:${explicit}`;

  const name = tool.name || tool.tool_name || 'action';
  const args = serializeToolGroupingArgs(getToolGroupingArgs(tool));
  if (!args || args === '{}' || args === 'null') return `anonymous:${name}:${fallbackIndex}`;
  return `fallback:${name}:${args}`;
}

function getToolState(tool) {
  return String(tool && tool.state || '').toLowerCase();
}

function isTerminalToolState(state) {
  return ['completed', 'complete', 'success', 'succeeded', 'failed', 'error', 'cancelled', 'canceled', 'interrupted'].includes(state);
}

function isPollingTool(tool) {
  const name = String(tool.name || tool.tool_name || '').toLowerCase();
  const args = serializeToolGroupingArgs(getToolGroupingArgs(tool)).toLowerCase();
  return /write_stdin|poll|yield_time_ms|session_id/.test(`${name} ${args}`);
}

function mergeToolEventIntoMap(toolMap, orderedTools, rawTool, fallbackIndex = orderedTools.length) {
  if (!rawTool || typeof rawTool !== 'object') return null;

  const key = getToolGroupKey(rawTool, fallbackIndex);
  let current = toolMap.get(key);
  if (!current) {
    current = {
      ...rawTool,
      tool_group_id: rawTool.tool_group_id || key,
      attempts: Math.max(1, Number(rawTool.attempts) || 1),
      poll_count: Math.max(0, Number(rawTool.poll_count) || 0)
    };
    toolMap.set(key, current);
    orderedTools.push(current);
    return current;
  }

  const previousState = getToolState(current);
  const incomingState = getToolState(rawTool);
  if (incomingState === 'running' && isTerminalToolState(previousState)) {
    if (isPollingTool(rawTool)) current.poll_count += 1;
    else current.attempts += 1;
  }

  const previousGroupId = current.tool_group_id;
  Object.assign(current, rawTool);
  current.tool_group_id = rawTool.tool_group_id || previousGroupId || key;
  current.attempts = Math.max(1, Number(current.attempts) || 1);
  current.poll_count = Math.max(0, Number(current.poll_count) || 0);
  return current;
}

function coalesceToolEvents(tools) {
  const toolMap = new Map();
  const orderedTools = [];
  (Array.isArray(tools) ? tools : []).forEach((tool, index) => {
    mergeToolEventIntoMap(toolMap, orderedTools, tool, index);
  });
  return orderedTools;
}

function buildToolItemsHtml(tools) {
  return tools.map((t) => {
    const d = getToolDetails(t);
    const attempts = Number(t.attempts) || 1;
    const polls = Number(t.poll_count) || 0;
    const eventMeta = [];
    if (attempts > 1) eventMeta.push(`執行 ×${attempts}`);
    if (polls > 0) eventMeta.push(`等待 ${polls} 次`);
    return `
      <div class="py-1.5 border-b border-slate-800/60 last:border-b-0 flex items-center justify-between gap-2 text-xs">
        <div class="flex items-center gap-2 min-w-0">
          <span class="px-1.5 py-0.5 rounded-md border text-[10px] font-mono font-medium shrink-0 ${d.badgeColor}">
            ${d.icon} ${d.label}
          </span>
          <span class="text-slate-300 font-mono text-[11px] truncate">${escapeHtml(d.desc)}</span>
        </div>
        <span class="text-[10px] text-slate-500 font-mono shrink-0 flex items-center gap-1">
          ${eventMeta.length ? `<span>${escapeHtml(eventMeta.join(' · '))}</span>` : ''}
          ${d.durationStr ? `<span>${d.durationStr}</span>` : ''}
        </span>
      </div>
    `;
  }).join('');
}


function buildExecutionStepRowsHtml(tools, hasThinking = false) {
  const groupedTools = coalesceToolEvents(tools);
  const rows = [];

  groupedTools.forEach(tool => {
    const detail = getToolDetails(tool);
    const state = toolProgressState(tool);
    const icon = state === 'failed' ? '!' : state === 'done' ? '✓' : '•';
    const color = state === 'failed' ? 'text-rose-400' : state === 'done' ? 'text-emerald-400' : 'text-slate-500';
    const attempts = Math.max(1, Number(tool.attempts) || 1);
    const polls = Math.max(0, Number(tool.poll_count) || 0);
    const meta = [];
    if (attempts > 1) meta.push(`×${attempts}`);
    if (polls > 0) meta.push(`等待 ${polls}`);
    if (detail.durationStr) meta.push(detail.durationStr);
    rows.push(`
      <div class="execution-step-row">
        <span class="execution-step-state ${color}">${icon}</span>
        <span class="execution-step-icon">${escapeHtml(detail.icon || '⚙️')}</span>
        <span class="execution-step-text">${escapeHtml(detail.desc || detail.label || '執行操作')}</span>
        ${meta.length ? `<span class="execution-step-meta">${escapeHtml(meta.join(' · '))}</span>` : ''}
      </div>
    `);
  });

  return rows.join('');
}

function buildExecutionDetailsHtml(tools, thinking = '', { lazy = false } = {}) {
  const groupedTools = coalesceToolEvents(tools);
  const hasExecution = groupedTools.length > 0;
  if (!hasExecution) return '';

  const stepCount = groupedTools.length;
  const bodyHtml = lazy ? '' : buildExecutionStepRowsHtml(groupedTools, Boolean(String(thinking || '').trim()));
  return `
    <details class="agent-execution-details history-execution-details ${lazy ? 'lazy-execution' : ''}" data-step-count="${stepCount}">
      <summary class="execution-summary">
        <span class="execution-summary-main">
          <span class="execution-status-icon text-emerald-400">✓</span>
          <span>執行紀錄 · ${stepCount} 項</span>
        </span>
        <span class="execution-summary-side">
          <span class="text-slate-500">執行詳情</span>
          <span class="execution-chevron">›</span>
        </span>
      </summary>
      <div class="execution-detail-body">${bodyHtml}</div>
    </details>
  `;
}

function formatExecutionDuration(durationMs) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms < 0) return '';
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function executionFileName(filePath) {
  const value = String(filePath || '').replace(/\\/g, '/');
  return value.split('/').filter(Boolean).pop() || value;
}

function isStructuredExecutionResult(turnResult) {
  return Boolean(turnResult && turnResult.kind === 'execution');
}

function isExecutionHistoryTools(tools = []) {
  const grouped = coalesceToolEvents(tools);
  if (grouped.length >= 2) return true;
  return grouped.some(tool => {
    const name = String(tool?.name || tool?.tool_name || '').toLowerCase();
    return /run_command|commandexecution|exec_command|shell_command|shellcommand|replace_file_content|filechange|apply_patch|applypatch|edit_file|editfile|write_to_file|writefile|create_file|createfile/.test(name);
  });
}

function executionModeLabel(mode) {
  const labels = {
    INSPECT: '檢查',
    SURGICAL_EDIT: '修改',
    DEBUG: '除錯',
    BUILD: '建置'
  };
  return labels[String(mode || '').toUpperCase()] || '執行';
}

function buildExecutionResultHeadline(turnResult = null, tools = []) {
  const state = String(turnResult?.status || '').toLowerCase();
  if (['failed', 'error'].includes(state)) return '執行未完成';
  if (['interrupted', 'cancelled', 'canceled', 'aborted'].includes(state)) return '執行已中斷';

  const changedFiles = Array.isArray(turnResult?.changed_files) ? turnResult.changed_files.filter(Boolean) : [];
  if (changedFiles.length === 1) return `完成修改 · ${executionFileName(changedFiles[0])}`;
  if (changedFiles.length > 1) return `完成修改 · ${changedFiles.length} files`;

  const mode = turnResult?.execution_mode;
  if (mode) return `完成${executionModeLabel(mode)}`;

  const grouped = coalesceToolEvents(tools);
  return grouped.length > 0 ? '完成執行' : '完成';
}

function executionResultPreviewText(content) {
  return String(content || '').split(/\r?\n/)
    .map(line => line.trim()
      .replace(/^#{1,6}\s+/, '')
      .replace(/^[-*+]\s+/, '')
      .replace(/^>\s*/, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_]/g, '').trim())
    .filter(line => line && !line.startsWith('```') && !/^(完整回覆|執行結果|執行紀錄|摘要)[:：]?$/.test(line));
}
function buildExecutionResultBodyHtml(content, tools = [], thinking = '', turnResult = null) {
  const changedFiles = Array.isArray(turnResult?.changed_files) ? turnResult.changed_files.filter(Boolean) : [];
  const checks = Array.isArray(turnResult?.checks) ? turnResult.checks.filter(Boolean) : [];
  const structuredCommit = turnResult?.commit && typeof turnResult.commit === 'object'
    ? (turnResult.commit.short_hash || turnResult.commit.hash || '')
    : '';
  const groupedTools = coalesceToolEvents(tools);
  const summaryBits = [];
  if (turnResult?.execution_mode) summaryBits.push(executionModeLabel(turnResult.execution_mode));
  if (Number(turnResult?.executions) > 0) summaryBits.push(`${Number(turnResult.executions)} 次操作`);

  const changedFilesHtml = changedFiles.length ? `
    <section class="execution-result-section">
      <div class="execution-result-section-title">修改檔案</div>
      <div class="execution-result-file-list">
        ${changedFiles.map(file => `<div class="execution-result-file"><span>↳</span><span class="truncate">${escapeHtml(file)}</span></div>`).join('')}
      </div>
    </section>
  ` : '';

  const checksHtml = checks.length ? `
    <section class="execution-result-section">
      <div class="execution-result-section-title">驗證結果</div>
      <div class="execution-result-check-list">
        ${checks.map(check => {
          const state = String(check.status || check.state || '').toLowerCase();
          const icon = ['passed', 'success', 'succeeded', 'completed'].includes(state) ? '✓' : ['failed', 'error'].includes(state) ? '!' : '•';
          const label = check.label || check.name || check.type || 'Check';
          return `<div class="execution-result-check"><span>${escapeHtml(icon)}</span><span class="truncate">${escapeHtml(label)}</span></div>`;
        }).join('')}
      </div>
    </section>
  ` : '';

  const executionHtml = groupedTools.length ? `
    <section class="execution-result-section">
      <div class="execution-result-section-title">執行紀錄</div>
      <div class="execution-detail-body execution-result-steps">${buildExecutionStepRowsHtml(groupedTools, Boolean(String(thinking || '').trim()))}</div>
    </section>
  ` : '';

  const responseHtml = !content || !String(content).trim()
    ? buildEmptyTurnFallbackHtml()
    : formatMessageContent(content);

  return `
    <div class="execution-result-overview">
      <span>${['failed', 'error'].includes(String(turnResult?.status || '').toLowerCase()) ? '未完成' : ['interrupted', 'cancelled', 'canceled', 'aborted'].includes(String(turnResult?.status || '').toLowerCase()) ? '已中斷' : '已完成'}</span>
      ${summaryBits.length ? `<span>· ${escapeHtml(summaryBits.join(' · '))}</span>` : ''}
      ${structuredCommit ? `<span class="font-mono">· ${escapeHtml(String(structuredCommit).slice(0, 12))}</span>` : ''}
    </div>
    ${changedFilesHtml}
    ${checksHtml}
    ${executionHtml}
    <section class="execution-result-section execution-result-response">
      <div class="execution-result-section-title">詳細回覆</div>
      <div class="msg-content min-w-0">${responseHtml}</div>
    </section>
  `;
}

function buildExecutionResultCardHtml(content, tools = [], thinking = '', turnResult = null, { lazy = false } = {}) {
  const failed = ['failed', 'error', 'interrupted', 'cancelled', 'canceled', 'aborted'].includes(String(turnResult?.status || '').toLowerCase());
  const duration = formatExecutionDuration(turnResult?.duration_ms);
  const structuredCommit = turnResult?.commit && typeof turnResult.commit === 'object'
    ? (turnResult.commit.short_hash || turnResult.commit.hash || '')
    : '';
  const meta = [];
  if (structuredCommit) meta.push(String(structuredCommit).slice(0, 8));
  if (duration) meta.push(duration);
  const bodyHtml = lazy ? '' : buildExecutionResultBodyHtml(content, tools, thinking, turnResult);
  const preview = executionResultPreviewText(content).slice(0, 220);

  return `
    <details class="execution-result-card ${lazy ? 'lazy-result-card' : ''}" data-result-kind="execution">
      <summary class="execution-result-summary">
        <span class="execution-result-summary-main">
          <span class="execution-result-status ${failed ? 'is-failed' : 'is-complete'}">${failed ? '!' : '✓'}</span>
          <span class="execution-result-title truncate">${escapeHtml(buildExecutionResultHeadline(turnResult, tools))}</span>
        </span>
        <span class="execution-result-summary-side">
          ${meta.length ? `<span class="execution-result-meta">${escapeHtml(meta.join(' · '))}</span>` : ''}
          <span class="execution-result-chevron">›</span>
        </span>
      </summary>
      ${preview ? `<div class="execution-result-peek">${escapeHtml(preview)}</div>` : ''}
      <div class="execution-result-body">${bodyHtml}</div>
    </details>
  `;
}

let activeExecutionStickyController = null;

function createExecutionStickyController(anchor, isActive = () => true) {
  if (!anchor || !messagesContainer?.parentElement) return null;
  if (activeExecutionStickyController?.dispose) activeExecutionStickyController.dispose();

  const host = messagesContainer.parentElement;
  const capsule = document.createElement('button');
  capsule.type = 'button';
  capsule.className = 'sticky-execution-capsule hidden';
  capsule.setAttribute('aria-label', '回到目前執行進度');
  host.appendChild(capsule);

  let enabled = false;
  let anchorVisible = true;
  let disposed = false;
  let lastLabel = '執行中';
  let lastElapsedMs = 0;
  let completionTimer = null;

  const roleName = () => compactProgressText(document.getElementById('workspace-label')?.textContent || 'Crew', 24);

  const render = (prefix = '●') => {
    if (disposed) return;
    const duration = formatExecutionDuration(lastElapsedMs);
    capsule.textContent = `${prefix} ${roleName()} · ${compactProgressText(lastLabel, 44)}${duration ? ` · ${duration}` : ''}`;
  };

  const syncVisibility = () => {
    if (disposed) return;
    const visible = enabled && anchor.isConnected && isActive() && !anchorVisible;
    capsule.classList.toggle('hidden', !visible);
    if (visible) render();
  };

  const observer = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
        const entry = entries.find(item => item.target === anchor);
        if (!entry) return;
        anchorVisible = Boolean(entry.isIntersecting && entry.intersectionRatio > 0);
        syncVisibility();
      }, { root: messagesContainer, threshold: [0, 0.12] })
    : null;

  if (observer) observer.observe(anchor);

  capsule.addEventListener('click', () => {
    if (!anchor.isConnected) return;
    anchor.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  const controller = {
    enable(label = '執行中') {
      if (disposed) return;
      enabled = true;
      lastLabel = label || lastLabel;
      render();
      syncVisibility();
    },
    update(label, elapsedMs) {
      if (disposed) return;
      if (label) lastLabel = label;
      if (Number.isFinite(Number(elapsedMs))) lastElapsedMs = Number(elapsedMs);
      if (!capsule.classList.contains('hidden')) render();
    },
    complete(durationMs, failed = false) {
      if (disposed) return;
      enabled = false;
      if (Number.isFinite(Number(durationMs))) lastElapsedMs = Number(durationMs);
      observer?.disconnect();
      if (!anchorVisible && anchor.isConnected && isActive()) {
        lastLabel = failed ? '未完成' : '完成';
        capsule.classList.toggle('is-failed', failed);
        capsule.classList.add('is-complete');
        capsule.classList.remove('hidden');
        render(failed ? '!' : '✓');
        completionTimer = window.setTimeout(() => controller.dispose(), 1900);
      } else {
        controller.dispose();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      observer?.disconnect();
      if (completionTimer) window.clearTimeout(completionTimer);
      capsule.remove();
      if (activeExecutionStickyController === controller) activeExecutionStickyController = null;
    }
  };

  activeExecutionStickyController = controller;
  return controller;
}

// Render tools accordion HTML with rich cards
function buildToolsAccordionHtml(tools) {
  const groupedTools = coalesceToolEvents(tools);
  if (groupedTools.length === 0) return '';
  const itemsHtml = buildToolItemsHtml(groupedTools);
  const totalAttempts = groupedTools.reduce((sum, tool) => sum + Math.max(1, Number(tool.attempts) || 1), 0);
  const repeatedLabel = totalAttempts > groupedTools.length ? `（實際 ${totalAttempts} 次執行）` : '';

  return `
    <details class="my-2 bg-slate-950/70 border border-slate-800/90 rounded-xl overflow-hidden text-xs">
      <summary class="px-3 py-1.5 cursor-pointer flex items-center justify-between text-slate-400 hover:text-slate-200 font-mono select-none bg-slate-900/60">
        <div class="flex items-center gap-1.5">
          <span>⚙️ 執行了 ${groupedTools.length} 個操作${repeatedLabel}</span>
        </div>
        <span class="text-[10px] text-slate-500">展開 ▼</span>
      </summary>
      <div class="px-3 py-2 border-t border-slate-800/60 bg-slate-950/90 space-y-1">
        ${itemsHtml}
      </div>
    </details>
  `;
}

// Historical tool output can be enormous. Keep the collapsed summary instant and
// only construct individual cards when the user explicitly opens it.
function buildLazyToolsAccordionHtml(tools) {
  const groupedTools = coalesceToolEvents(tools);
  if (groupedTools.length === 0) return '';
  const totalAttempts = groupedTools.reduce((sum, tool) => sum + Math.max(1, Number(tool.attempts) || 1), 0);
  const repeatedLabel = totalAttempts > groupedTools.length ? `（實際 ${totalAttempts} 次執行）` : '';
  return `
    <details class="lazy-tools my-2 bg-slate-950/70 border border-slate-800/90 rounded-xl overflow-hidden text-xs">
      <summary class="px-3 py-1.5 cursor-pointer flex items-center justify-between text-slate-400 hover:text-slate-200 font-mono select-none bg-slate-900/60">
        <div class="flex items-center gap-1.5"><span>⚙️ 執行了 ${groupedTools.length} 個操作${repeatedLabel}</span></div>
        <span class="text-[10px] text-slate-500">展開 ▼</span>
      </summary>
      <div class="lazy-tools-body px-3 py-2 border-t border-slate-800/60 bg-slate-950/90 space-y-1"></div>
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

// Build Collapsible Memory Compact Checkpoint Divider
function buildCheckpointDividerHtml(summaryText, timestamp) {
  const container = document.createElement('div');
  container.className = 'my-5 not-prose flex flex-col items-center gap-2 select-none w-full max-w-2xl mx-auto px-1';
  
  const timeStr = timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const cleanedSummary = (summaryText || '')
    .replace(/^\{\{\s*CHECKPOINT\s*\d+\s*\}\}/i, '')
    .replace(/\*\*The prior conversation has been compacted via \/compact\.\*\*/i, '')
    .replace(/# Compacted Conversation Context/i, '')
    .trim();

  container.innerHTML = `
    <!-- Glowing Divider Capsule -->
    <div class="w-full flex items-center gap-3">
      <div class="flex-1 h-[1px] bg-gradient-to-r from-transparent via-cyan-700/50 to-cyan-500/80"></div>
      <div class="px-3.5 py-1.5 rounded-full bg-gradient-to-r from-slate-950 via-cyan-950/80 to-slate-950 border border-cyan-500/60 shadow-lg shadow-cyan-950/60 flex items-center gap-2 text-cyan-300 font-mono text-[11px] font-bold shrink-0">
        <span class="w-2 h-2 rounded-full bg-cyan-400 animate-pulse shrink-0"></span>
        <span>📦 記憶提煉分界線 (Memory Checkpoint)</span>
      </div>
      <div class="flex-1 h-[1px] bg-gradient-to-l from-transparent via-cyan-700/50 to-cyan-500/80"></div>
    </div>

    <!-- Collapsible Summary Card -->
    <details class="w-full bg-slate-950/90 border border-cyan-800/50 rounded-2xl overflow-hidden text-xs shadow-xl transition-all duration-300 group">
      <summary class="px-3.5 py-2.5 cursor-pointer flex items-center justify-between text-cyan-300 hover:text-cyan-200 font-mono select-none bg-gradient-to-r from-cyan-950/60 via-slate-900 to-slate-900">
        <div class="flex items-center gap-2 min-w-0">
          <span class="text-sm">📋</span>
          <span class="font-semibold text-slate-200 truncate">查看本次提煉的核心記憶摘要</span>
          <span class="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono shrink-0">✓ 已完成精簡</span>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <span class="text-[10px] text-slate-500 font-mono">${timeStr}</span>
          <span class="text-[10px] text-slate-400 font-mono group-open:rotate-180 transition-transform">▼</span>
        </div>
      </summary>
      <div class="p-4 border-t border-cyan-900/40 bg-slate-950 text-slate-200 leading-relaxed text-xs space-y-2 prose prose-invert max-w-none">
        ${formatMessageContent(cleanedSummary)}
      </div>
    </details>

    <div class="text-[10px] text-slate-500 font-mono text-center">
      💡 以上歷史對話已封存，後續提問將基於此份核心記憶極速展開
    </div>
  `;

  return container;
}

// 🧠 Context Health UI: provider total is authoritative when exact; Crew breakdown is heuristic.
let currentContextStats = null;
let currentContextHealth = null;
let currentContextPlan = null;
let contextToastTimer = null;
const criticalContextToastSeen = new Set();

const CONTEXT_UI_LABELS = {
  conversation: 'Conversation',
  tool: 'Tools',
  code: 'Code',
  memory: 'Memory',
  role: 'Role',
  project: 'Project',
  task: 'Task',
  document: 'Documents',
  system: 'System',
  other: 'Other'
};

function formatContextTokens(value, approximate = false) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) return '—';
  const prefix = approximate ? '~' : '';
  if (numeric >= 1000000) return `${prefix}${(numeric / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
  if (numeric >= 1000) return `${prefix}${Math.round(numeric / 1000)}k`;
  return `${prefix}${Math.round(numeric)}`;
}

function deriveContextHealthFromStats(stats = {}) {
  const activeTokens = Number(stats.active_tokens);
  const contextWindow = Number(stats.context_window);
  const hasUsage = Number.isFinite(activeTokens) && activeTokens >= 0;
  const hasWindow = Number.isFinite(contextWindow) && contextWindow > 0;
  const usageRatio = hasUsage && hasWindow ? activeTokens / contextWindow : null;
  const status = usageRatio === null
    ? 'unknown'
    : usageRatio >= 0.90
      ? 'critical'
      : usageRatio >= 0.70
        ? 'warning'
        : 'healthy';

  return {
    status,
    ...(usageRatio === null ? {} : { usageRatio }),
    contributions: [],
    breakdown: {},
    warnings: [],
    unattributedTokens: 0,
    overAttributedTokens: 0,
    totalUsage: {
      value: hasUsage ? activeTokens : 0,
      exact: stats.active_tokens_exact === true,
      source: stats.active_tokens_source || (stats.active_tokens_exact === true ? 'provider' : 'heuristic')
    },
    breakdownEstimate: {
      exact: false,
      source: 'heuristic',
      attributedTokens: 0,
      unattributedTokens: 0,
      overAttributedTokens: 0
    },
    budget: {
      maxTokens: hasWindow ? contextWindow : null,
      availableInputTokens: hasWindow ? contextWindow : null
    },
    largestCompactableContribution: null
  };
}

function mergeLiveContextHealth(stats) {
  const live = deriveContextHealthFromStats(stats);
  if (!currentContextHealth) return live;
  return {
    ...currentContextHealth,
    status: live.status,
    ...(Object.prototype.hasOwnProperty.call(live, 'usageRatio') ? { usageRatio: live.usageRatio } : {}),
    totalUsage: live.totalUsage,
    budget: {
      ...currentContextHealth.budget,
      ...(live.budget?.maxTokens ? { maxTokens: live.budget.maxTokens, availableInputTokens: live.budget.maxTokens } : {})
    }
  };
}

function contextStatusMeta(status) {
  if (status === 'critical') return { label: 'Critical', dot: 'bg-rose-400', text: 'text-rose-300', progress: 'bg-rose-400' };
  if (status === 'warning') return { label: 'Warning', dot: 'bg-amber-400', text: 'text-amber-300', progress: 'bg-amber-400' };
  if (status === 'healthy') return { label: 'Healthy', dot: 'bg-emerald-400', text: 'text-emerald-300', progress: 'bg-emerald-400' };
  return { label: 'Usage available · limit unknown', dot: 'bg-slate-500', text: 'text-slate-400', progress: 'bg-slate-500' };
}

function showContextToast(message, { critical = false } = {}) {
  const toast = document.getElementById('context-health-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = `fixed bottom-20 left-1/2 z-[90] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-2xl border px-3 py-2.5 text-[11px] shadow-2xl backdrop-blur ${critical ? 'border-rose-500/30 bg-rose-950/95 text-rose-100' : 'border-slate-700 bg-slate-900/95 text-slate-200'}`;
  clearTimeout(contextToastTimer);
  contextToastTimer = setTimeout(() => toast.classList.add('hidden'), 4200);
}

function updateHeaderCompactAction(health) {
  const button = document.getElementById('header-compact-btn');
  if (!button) return;
  const status = health?.status || 'unknown';
  const show = Boolean(currentConversationId) &&
    Boolean(providerConfig().capabilities?.compact) &&
    (status === 'warning' || status === 'critical');
  button.classList.toggle('hidden', !show);
  if (!show) return;

  const critical = status === 'critical';
  button.textContent = critical ? 'Compact now' : 'Compact';
  button.className = `shrink-0 rounded-md border px-1.5 py-0.5 text-[9px] font-bold transition active:scale-95 ${critical
    ? 'border-rose-500/40 bg-rose-500/10 text-rose-300'
    : 'border-amber-500/30 bg-amber-500/10 text-amber-300'}`;
}

function maybeNotifyCriticalContext(health) {
  if (health?.status !== 'critical' || !currentConversationId) return;
  const key = `${currentProvider}:${currentConversationId}`;
  if (criticalContextToastSeen.has(key)) return;
  criticalContextToastSeen.add(key);
  showContextToast('Context is getting full. You can compact safely without losing Role memory.', { critical: true });
}

function updateContextPill(stats, health = null) {
  currentContextStats = stats || currentContextStats || null;
  if (health) currentContextHealth = health;
  else if (stats) currentContextHealth = mergeLiveContextHealth(stats);
  else currentContextHealth = null;

  const resolved = currentContextHealth || deriveContextHealthFromStats(currentContextStats || {});
  const pill = document.getElementById('context-pill');
  const indicator = document.getElementById('context-indicator');
  const textEl = document.getElementById('context-tokens-text');
  const progressTrack = document.getElementById('context-progress-track');
  const progressBar = document.getElementById('context-progress-bar');
  const total = resolved.totalUsage || { value: 0, exact: false, source: 'heuristic' };
  const meta = contextStatusMeta(resolved.status);
  const display = formatContextTokens(total.value, total.exact !== true);
  const maxTokens = Number(resolved.budget?.maxTokens);
  const hasBudget = Number.isFinite(maxTokens) && maxTokens > 0;
  const percent = hasBudget
    ? Math.max(0, Math.min(100, Math.round((Number(total.value) || 0) / maxTokens * 100)))
    : null;
  const progressClass = resolved.status === 'critical'
    ? 'bg-rose-400'
    : resolved.status === 'warning'
      ? 'bg-amber-400'
      : resolved.status === 'healthy'
        ? 'bg-emerald-400'
        : 'bg-slate-500';

  if (textEl) {
    textEl.textContent = percent === null
      ? display
      : `${total.exact === true ? '' : '~'}${percent}%`;
    textEl.className = `shrink-0 font-mono text-[8px] font-bold ${meta.text}`;
  }
  if (indicator) indicator.className = `h-1.5 w-1.5 shrink-0 rounded-full ${meta.dot}`;
  if (progressTrack) progressTrack.classList.toggle('hidden', percent === null);
  if (progressBar) {
    progressBar.style.width = percent === null ? '0%' : `${percent}%`;
    progressBar.className = `block h-full rounded-full transition-[width] duration-200 ${progressClass}`;
  }

  if (pill) {
    pill.dataset.contextLoad = resolved.status || 'unknown';
    pill.title = hasBudget
      ? `${meta.label} Context · ${display} / ${formatContextTokens(maxTokens)} · ${percent}%`
      : `${total.exact ? 'Context' : 'Estimated Context'} · ${display} · Context limit unknown`;
  }

  updateHeaderCompactAction(resolved);
  maybeNotifyCriticalContext(resolved);
}

function contributionDisplayName(contribution = {}) {
  if (contribution.id === 'role-core') return 'Role identity';
  if (contribution.id === 'project-core') return 'Project context';
  if (contribution.id === 'task-current') return 'Current task';
  if (contribution.id === 'conversation-recent') return 'Recent conversation';
  if (contribution.id === 'tools-recent') return 'Recent tool output';
  if (contribution.id === 'code-recent') return 'Recent code';
  return contribution.label || CONTEXT_UI_LABELS[contribution.type] || contribution.type || 'Context';
}

function warningDisplayText(code) {
  const map = {
    NEAR_CONTEXT_LIMIT: 'Context 已接近模型可用上限。',
    CONVERSATION_LARGE: '對話歷史開始變大。',
    TOOL_OUTPUT_LARGE: '舊的工具輸出佔用較多空間，可以安全精簡。',
    MEMORY_OVERFETCH: '這輪載入的長期記憶偏多，需要時可以重新擷取。',
    LOW_PRIORITY_CONTEXT_LARGE: '可精簡的低優先內容偏多。',
    UNKNOWN_MODEL_BUDGET: '目前可看到 Context 用量，但 Provider 沒有提供 Context 上限。'
  };
  return map[code] || 'Context 有可改善的空間。';
}

function renderContextBreakdown(health) {
  const container = document.getElementById('context-breakdown');
  if (!container) return;
  const grouped = health?.breakdown || {};
  const rows = [];
  const add = (type, label) => {
    const value = Number(grouped[type]?.estimatedTokens) || 0;
    if (value > 0) rows.push({ type, label, value });
  };
  add('conversation', 'Conversation');
  add('tool', 'Tools');
  add('code', 'Code');
  add('memory', 'Memory');
  add('role', 'Role');
  add('project', 'Project');
  add('task', 'Task');
  add('document', 'Documents');

  const otherSystem = (Number(grouped.system?.estimatedTokens) || 0) +
    (Number(grouped.other?.estimatedTokens) || 0) +
    (Number(health?.unattributedTokens) || 0);
  if (otherSystem > 0) rows.push({ type: 'other-system', label: 'Other / system', value: otherSystem });

  rows.sort((a, b) => b.value - a.value);
  if (!rows.length) {
    container.innerHTML = '<div class="text-[10px] text-slate-600">尚無 attribution 資料。</div>';
    return;
  }

  const total = Math.max(1, Number(health?.totalUsage?.value) || rows.reduce((sum, row) => sum + row.value, 0));
  const maxValue = Math.max(...rows.map(row => row.value), 1);
  container.innerHTML = rows.map(row => {
    const share = Math.round((row.value / total) * 100);
    const width = Math.max(4, Math.min(100, (row.value / maxValue) * 100));
    return `<div>
      <div class="mb-1 flex items-center gap-2 text-[10px]">
        <span class="min-w-0 flex-1 truncate text-slate-400">${row.label}</span>
        <span class="font-mono text-slate-300">~${formatContextTokens(row.value)}</span>
        <span class="w-8 text-right font-mono text-slate-600">${share}%</span>
      </div>
      <div class="h-1 overflow-hidden rounded-full bg-slate-800"><div class="h-full rounded-full bg-slate-500" style="width:${width}%"></div></div>
    </div>`;
  }).join('');
}

function renderContextContributionLists(health) {
  const pinned = document.getElementById('context-pinned-list');
  const compactable = document.getElementById('context-compactable-list');
  const contributions = Array.isArray(health?.contributions) ? health.contributions : [];
  const keep = contributions.filter(item => item.pinned || item.compactable === false || item.priority === 'required');
  const canCompact = contributions.filter(item => item.compactable && !item.pinned && item.priority !== 'required');

  const render = (items, prefix) => {
    if (!items.length) return '<div>—</div>';
    const seen = new Set();
    return items.filter(item => {
      const name = contributionDisplayName(item);
      if (seen.has(name)) return false;
      seen.add(name);
      return true;
    }).map(item => `<div>${prefix} ${escapeHtml(contributionDisplayName(item))}</div>`).join('');
  };
  if (pinned) pinned.innerHTML = render(keep, '✓');
  if (compactable) compactable.innerHTML = render(canCompact, '·');
}

function renderContextWarnings(health) {
  const section = document.getElementById('context-warnings-section');
  const container = document.getElementById('context-warnings');
  if (!section || !container) return;
  const warnings = (health?.warnings || []).filter(item => item?.code);
  section.classList.toggle('hidden', warnings.length === 0);
  container.innerHTML = warnings.map(item => `<div>• ${escapeHtml(warningDisplayText(item.code))}</div>`).join('');
}

function renderContextAdvanced(health) {
  const source = document.getElementById('context-advanced-source');
  const unattributed = document.getElementById('context-advanced-unattributed');
  const largest = document.getElementById('context-advanced-largest');
  const warningCodes = document.getElementById('context-advanced-warning-codes');
  if (source) source.textContent = `total: ${health?.totalUsage?.exact ? 'exact' : 'estimated'} · ${health?.totalUsage?.source || 'unknown'}; breakdown: estimated · heuristic`;
  if (unattributed) unattributed.textContent = `other/system: ~${formatContextTokens(health?.unattributedTokens || 0)} · over-attributed: ~${formatContextTokens(health?.overAttributedTokens || 0)}`;
  if (largest) largest.textContent = `largest compactable: ${health?.largestCompactableContribution ? contributionDisplayName(health.largestCompactableContribution) : '—'}`;
  if (warningCodes) warningCodes.textContent = `warnings: ${(health?.warnings || []).map(item => item.code).join(', ') || '—'}`;
}

function renderContextModal() {
  const health = currentContextHealth || deriveContextHealthFromStats(currentContextStats || {});
  const meta = contextStatusMeta(health.status);
  const total = health.totalUsage || { value: 0, exact: false };
  const maxTokens = Number(health.budget?.maxTokens);
  const usage = document.getElementById('context-modal-usage');
  const limit = document.getElementById('context-modal-limit');
  const status = document.getElementById('context-modal-status');
  const percent = document.getElementById('context-modal-percent');
  const progressWrap = document.getElementById('context-modal-progress-wrap');
  const progress = document.getElementById('context-modal-progress');
  const compactBtn = document.getElementById('modal-trigger-compact-btn');

  if (status) {
    status.textContent = meta.label;
    status.className = `text-xs font-bold ${meta.text}`;
  }
  if (usage) usage.textContent = formatContextTokens(total.value, total.exact !== true);
  const hasBudget = Number.isFinite(maxTokens) && maxTokens > 0;
  if (limit) limit.textContent = hasBudget ? `/ ${formatContextTokens(maxTokens)}` : 'Context limit unknown';
  if (percent) percent.textContent = hasBudget && Number.isFinite(Number(health.usageRatio))
    ? `${Math.round(Number(health.usageRatio) * 100)}%`
    : '—';
  if (progressWrap) progressWrap.classList.toggle('hidden', !hasBudget);
  if (progress && hasBudget) {
    progress.style.width = `${Math.max(0, Math.min(100, Math.round(Number(health.usageRatio || 0) * 100)))}%`;
    progress.className = `h-full rounded-full transition-all duration-300 ${meta.progress}`;
  }

  renderContextBreakdown(health);
  renderContextContributionLists(health);
  renderContextWarnings(health);
  renderContextAdvanced(health);

  const canOfferCompact = Boolean(currentConversationId) &&
    Boolean(providerConfig().capabilities?.compact) &&
    ['warning', 'critical'].includes(health.status);
  if (compactBtn) compactBtn.classList.toggle('hidden', !canOfferCompact);
}

function showContextModal() {
  const modal = document.getElementById('context-modal');
  if (!modal) return;
  renderContextModal();
  modal.classList.remove('pointer-events-none');
  modal.classList.add('opacity-100');
}

function hideContextModal() {
  const modal = document.getElementById('context-modal');
  if (!modal) return;
  modal.classList.remove('opacity-100');
  modal.classList.add('pointer-events-none');
}

function setContextPreviewOpen(open) {
  const modal = document.getElementById('context-compact-preview-modal');
  if (!modal) return;
  modal.classList.toggle('pointer-events-none', !open);
  modal.classList.toggle('opacity-100', open);
}

function renderCompactionPlan(plan) {
  const keep = document.getElementById('context-preview-keep');
  const compact = document.getElementById('context-preview-compact');
  const reretrieve = document.getElementById('context-preview-reretrieve');
  const before = document.getElementById('context-preview-before');
  const after = document.getElementById('context-preview-after');
  const savings = document.getElementById('context-preview-savings');

  const item = (entry, prefix = '✓') => `<div class="flex items-center justify-between gap-3"><span class="min-w-0 truncate">${prefix} ${escapeHtml(contributionDisplayName(entry))}</span><span class="shrink-0 font-mono text-[10px] text-slate-500">~${formatContextTokens(entry.estimatedBeforeTokens)}</span></div>`;
  if (keep) keep.innerHTML = plan.keep?.length ? plan.keep.map(entry => item(entry, '✓')).join('') : '<div class="text-slate-600">—</div>';
  const compactItems = [...(plan.summarize || []), ...(plan.drop || [])];
  if (compact) compact.innerHTML = compactItems.length
    ? compactItems.map(entry => item(entry, entry.action === 'drop' ? '−' : '↘')).join('')
    : '<div class="text-slate-600">—</div>';
  if (reretrieve) reretrieve.innerHTML = plan.reretrieve?.length
    ? plan.reretrieve.map(entry => item(entry, '↻')).join('')
    : '<div class="text-slate-600">—</div>';

  if (before) before.textContent = formatContextTokens(plan.estimatedBeforeTokens, !plan.beforeExact);
  if (after) after.textContent = formatContextTokens(plan.estimatedAfterTokens, true);
  if (savings) savings.textContent = `~${formatContextTokens(plan.estimatedSavingsTokens)}`;
}

async function openSafeContextCompactionPreview() {
  if (!currentConversationId || isStreaming) return;
  try {
    const query = new URLSearchParams({
      provider: currentProvider,
      id: currentConversationId
    });
    const response = await fetch(`/api/context/compaction-plan?${query.toString()}`, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '無法建立 compaction plan');
    currentContextPlan = data.plan;
    currentContextHealth = data.health || currentContextHealth;
    updateContextPill(currentContextStats, currentContextHealth);

    if (!data.can_compact) throw new Error('目前 Provider 不支援 Context compaction');
    if (!data.plan?.hasActionableWork) {
      showContextToast('目前沒有可安全精簡的舊 Context；最近工作內容會保留。');
      return;
    }

    renderCompactionPlan(data.plan);
    hideContextModal();
    setContextPreviewOpen(true);
  } catch (error) {
    showContextToast(error.message || '無法建立 compaction preview');
  }
}

async function executeSafeContextCompaction() {
  if (!currentConversationId || !currentContextPlan || isStreaming) return;
  const button = document.getElementById('confirm-context-compact-btn');
  const targetConversationId = currentConversationId;
  const targetProvider = currentProvider;
  const originalText = button?.textContent || 'Compact';
  if (button) {
    button.disabled = true;
    button.textContent = 'Compacting…';
    button.classList.add('opacity-60');
  }

  try {
    const response = await fetch('/api/context/compact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: targetProvider,
        conversation_id: targetConversationId,
        confirmed: true,
        locale: typeof getCrewLocale === 'function' ? getCrewLocale() : 'zh-TW'
      })
    });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || 'Context compaction failed');

    setContextPreviewOpen(false);
    if (currentConversationId !== targetConversationId || currentProvider !== targetProvider) return;

    const beforeHealth = data.before_health;
    const afterHealth = data.after_health;
    currentContextHealth = afterHealth || currentContextHealth;
    updateContextPill(null, currentContextHealth);

    const beforeText = formatContextTokens(beforeHealth?.totalUsage?.value || currentContextPlan.estimatedBeforeTokens, beforeHealth?.totalUsage?.exact !== true);
    const afterText = formatContextTokens(afterHealth?.totalUsage?.value ?? currentContextPlan.estimatedAfterTokens, afterHealth?.totalUsage?.exact !== true);
    const saved = Math.max(0,
      Number(beforeHealth?.totalUsage?.value || currentContextPlan.estimatedBeforeTokens) -
      Number(afterHealth?.totalUsage?.value ?? currentContextPlan.estimatedAfterTokens)
    );
    let message = `Context compacted · ${beforeText} → ${afterText}`;
    if (saved > 0) message += ` · Saved ~${formatContextTokens(saved)}`;
    if (afterHealth?.status === 'warning' || afterHealth?.status === 'critical') {
      const largest = afterHealth?.largestCompactableContribution;
      message += largest ? ` · 仍偏大：${contributionDisplayName(largest)}` : ' · Context 仍偏大';
    }
    showContextToast(message, { critical: afterHealth?.status === 'critical' });

    // Re-read provider history so both total usage and heuristic attribution
    // reflect the actual post-compaction active context.
    if (typeof loadConversationHistory === 'function') {
      await loadConversationHistory(targetConversationId, { preserveComposer: true });
    }
  } catch (error) {
    showContextToast(error.message || 'Context compaction failed', { critical: true });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
      button.classList.remove('opacity-60');
    }
  }
}

window.showContextModal = showContextModal;
window.hideContextModal = hideContextModal;
window.openSafeContextCompactionPreview = openSafeContextCompactionPreview;
window.executeSafeContextCompaction = executeSafeContextCompaction;
window.setContextPreviewOpen = setContextPreviewOpen;

// A deterministic escape hatch for very long Codex threads. It deliberately
// creates a new thread with only a compact handoff; the original stays intact
// in the drawer and can be reopened at any time.
async function startLowContextContinuation(triggerButton = null) {
  if (currentProvider !== 'codex' || !currentConversationId || isStreaming) return;
  const sourceConversationId = currentConversationId;
  const sourceTitle = headerTitle?.textContent?.trim() || '原對話';
  const button = triggerButton || document.getElementById('modal-trigger-compact-max-btn');
  const originalButtonText = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.classList.add('opacity-60');
    button.innerHTML = '<span>正在建立交接摘要…</span>';
  }
  hideContextModal();

  try {
    const response = await fetch('/api/codex/continuation-summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversation_id: sourceConversationId,
        locale: typeof getCrewLocale === 'function' ? getCrewLocale() : 'zh-TW'
      })
    });
    const data = await response.json();
    if (!response.ok || !data.success || !data.summary) throw new Error(data.error || '建立交接摘要失敗');

    if (newChatBtn) newChatBtn.click();
    const handoffPrompt = `【前一段對話續接摘要】\n來源：${sourceTitle}\n\n${data.summary}\n\n【接續規則】以上是已封存對話的必要脈絡。請直接以此接續後續工作；不要重新摘要、不要假設舊對話仍在目前 Context。`;
    promptInput.value = handoffPrompt;
    promptInput.style.height = 'auto';
    await sendMessage();

    if (currentConversationId && typeof renameConversationSilently === 'function') {
      await renameConversationSilently(currentConversationId, `續接 · ${shortenConversationTitle(sourceTitle, 18)}`);
    }
  } catch (error) {
    if (currentConversationId === sourceConversationId) {
      appendMessage('assistant', `⚠️ 無法建立低 Context 續接對話：${error.message}`);
    } else {
      alert(`⚠️ 無法建立低 Context 續接對話：${error.message}`);
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('opacity-60');
      button.innerHTML = originalButtonText;
    }
  }
}

function shortenConversationTitle(text, maxLength = 18) {
  const firstLine = String(text || '')
    .replace(/^【[^】]{1,30}】\s*/, '')
    .split(/(?:\r?\n|[。！？!?])/)[0]
    .trim();
  if (!firstLine) return '新對話';
  return firstLine.length > maxLength ? `${firstLine.slice(0, maxLength)}…` : firstLine;
}

// 💡 Empty Turn Recovery Card (For when AI completed tool calls but returned empty text)
function buildEmptyTurnFallbackHtml(promptHint = '') {
  const safeHint = typeof escapeHtml === 'function' ? escapeHtml(promptHint || '') : (promptHint || '');
  return `
    <div class="empty-turn-fallback-card p-3 rounded-2xl bg-indigo-950/40 border border-indigo-500/40 text-xs text-slate-200 space-y-2.5 my-1.5 animate-fadeIn select-none">
      <div class="flex items-center justify-between border-b border-indigo-500/20 pb-1.5">
        <div class="flex items-center gap-1.5 font-bold text-indigo-300">
          <span class="text-sm">💡</span>
          <span>已完成背景工具調研，尚未輸出文字</span>
        </div>
        <span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">狀態就緒</span>
      </div>
      <p class="text-slate-300 leading-relaxed text-[11px]">
        AI 剛才已完成程式碼與檔案調研。點擊下方按鈕可立即指示 AI 接續執行後續動作與回覆。
      </p>
      <div class="pt-0.5 flex items-center gap-2">
        <button type="button" class="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-900/40 cursor-pointer text-xs transition" onclick="triggerResumeTurn('${safeHint}', this)">
          <span>⚡</span>
          <span>一鍵讓 AI 繼續完成</span>
        </button>
      </div>
    </div>
  `;
}

function triggerResumeTurn(customPrompt, btnElement = null) {
  if (typeof window.haptic === 'function') window.haptic('light');
  const btn = btnElement || (window.event ? window.event.currentTarget : null);
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="inline-block w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin"></span><span>正在指示 AI 繼續...</span>';
  }
  const msgText = customPrompt || '請繼續根據剛才查詢的內容與進度，完成後續任務與修改。';
  if (typeof sendMessage === 'function') {
    sendMessage({ text: msgText });
  }
}
window.buildEmptyTurnFallbackHtml = buildEmptyTurnFallbackHtml;
window.triggerResumeTurn = triggerResumeTurn;

function formatMessageTimestamp(timestamp = Date.now()) {
  if (typeof timestamp === 'string' && /^\d{1,2}:\d{2}/.test(timestamp)) return timestamp;
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-TW', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

// Append Message to UI
function appendMessage(role, content, timestamp, tools = [], thinking = '', isBtw = false, renderOptions = {}) {
  const isUser = role === 'user';
  const targetContainer = renderOptions.container || messagesContainer;
  const messageTime = formatMessageTimestamp(timestamp);

  // 🌟 1. If this is a persisted Call Memo from Live Voice Session, render the full interactive Memo Card!
  if (!isUser && content && typeof content === 'string' && content.includes('<!-- CALL_MEMO_DATA:')) {
    const match = content.match(/<!-- CALL_MEMO_DATA:([\s\S]*?) -->/);
    if (match) {
      try {
        const memoData = JSON.parse(match[1]);
        if (typeof window.buildCallSummaryCardHtml === 'function') {
          const card = window.buildCallSummaryCardHtml(
            memoData.transcript || memoData.turns || [],
            memoData.duration_sec || memoData.durationSec || 0,
            memoData.voice_name || memoData.voiceName || 'Gemini',
            memoData.snapshots || [],
            `history-memo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            memoData.summary || []
          );
          const memoWrap = document.createElement('div');
          memoWrap.className = 'w-full max-w-2xl mx-auto min-w-0';
          memoWrap.appendChild(card);
          if (messageTime) {
            const timeLabel = document.createElement('div');
            timeLabel.className = 'mt-1 text-right text-[10px] text-slate-500 font-mono select-none';
            timeLabel.textContent = `🕒 ${messageTime}`;
            memoWrap.appendChild(timeLabel);
          }
          targetContainer.appendChild(memoWrap);
          if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(memoWrap);
          if (typeof scrollToBottom === 'function') scrollToBottom(true);
          return;
        }
      } catch (e) {
        console.warn('[Call Memo Parse Failed]', e);
      }
    }
  }

  // 🌟 2. Suppress raw prompt user bubble for Live Voice in history reload (already embedded in Memo Card)
  if (isUser && content && typeof content === 'string' && (content.includes('[🎙️ Live 語音]') || content.includes('<USER_REQUEST>\n[🎙️ Live 語音]'))) {
    return;
  }

  const msgDiv = document.createElement('div');
  msgDiv.className = `flex w-full max-w-2xl mx-auto min-w-0 ${isUser ? 'justify-end' : 'justify-start'}`;

  const isUserBtw = isUser && (isBtw || /^\s*\/btw\b/i.test(content || ''));

  const turnResult = renderOptions.turnResult || null;
  const shouldCollapseExecution = !isUser && !isBtw && (
    isStructuredExecutionResult(turnResult) ||
    (renderOptions.historyExecutionFallback && isExecutionHistoryTools(tools))
  );
  const executionHtml = !isUser && !shouldCollapseExecution
    ? buildExecutionDetailsHtml(tools, thinking, { lazy: Boolean(renderOptions.lazyTools) })
    : '';

  let bubbleClass = '';
  if (isUser) {
    bubbleClass = isUserBtw
      ? 'bg-gradient-to-r from-teal-700 to-indigo-600 text-white rounded-2xl px-3 py-2.5 text-xs sm:text-sm shadow-md w-fit max-w-[88%] sm:max-w-[82%] break-words border border-teal-400/30'
      : 'bg-indigo-600 text-white rounded-2xl px-3 py-2.5 text-xs sm:text-sm shadow-md w-fit max-w-[88%] sm:max-w-[82%] break-words';
  } else {
    bubbleClass = isBtw
      ? 'btw-card bg-gradient-to-b from-slate-900 via-slate-900 to-teal-950/40 border border-teal-500/50 text-slate-200 rounded-2xl p-3 sm:p-3.5 text-xs sm:text-sm shadow-lg shadow-teal-950/30 w-full min-w-0 prose'
      : 'assistant-article bg-slate-900 text-slate-200 w-full min-w-0 prose';
  }

  let bodyHtml = '';
  if (isUser) {
    const userTurnIndex = Number.isInteger(renderOptions.userTurnIndex)
      ? renderOptions.userTurnIndex
      : document.querySelectorAll('#messages-container > div[data-role="user"]').length;
    msgDiv.setAttribute('data-role', 'user');
    msgDiv.setAttribute('data-turn-index', userTurnIndex);

    let userText = (content || '')
      .replace(/^\[Crew Pocket：支援互動 HTML、Chart\.js 圖表、Google Maps、Android APK 與本機檔案；依使用者需求套用對應規則。\]\s*/u, '')
      .replace(/^\[Crew Pocket Capability Rules\]\s*[\s\S]*?\n\n/u, '')
      .replace(/^(?:\s*<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>\s*)+/iu, '')
      .replace(/(?:\s*<turn_aborted>[\s\S]*?<\/turn_aborted>\s*)+/giu, '')
      .replace(/^\s*turn_aborted\s*$/gim, '')
      .replace(/\[Context:[\s\S]*?\]/g, '')
      .replace(/<USER_REQUEST>[\s\S]*?<\/USER_REQUEST>/g, (m, g) => g || m)
      .trim();
    let imgHtml = '';
    const match = userText.match(/\[Uploaded Image:\s*([^\]]+)\]/);
    if (match) {
      const imgP = match[1].trim();
      imgHtml = `<img src="${imageProxyUrl(imgP, true)}" data-full-src="${imageProxyUrl(imgP)}" loading="lazy" decoding="async" fetchpriority="low" class="max-h-48 sm:max-h-56 max-w-full rounded-xl object-contain border border-indigo-400/40 cursor-pointer shadow-md mb-2 bg-black/20 block" alt="Uploaded Photo">`;
      userText = userText.replace(/\[Uploaded Image:\s*([^\]]+)\]/, '').trim();
    }
    // Runtime turn/steer directives are wrapped in ADDITIONAL_METADATA. Once
    // stripped, do not leave an empty user bubble in the visible transcript.
    if (!userText && !imgHtml) return;
    msgDiv.setAttribute('data-raw-text', userText);

    const editRewindBtn = providerConfig().capabilities?.rewind ? `
      <button type="button" class="edit-rewind-btn opacity-65 hover:opacity-100 hover:text-white rounded transition active:scale-95 flex items-center justify-center cursor-pointer min-w-5 min-h-5" title="編輯此問題並回溯對話" aria-label="編輯並回溯">
        <svg class="w-3 h-3 text-indigo-100" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
      </button>
    ` : '';

    const userMeta = editRewindBtn
      ? `<div class="mt-1 flex justify-end opacity-70">${editRewindBtn}</div>`
      : '';

    bodyHtml = `
      ${imgHtml}
      <div class="whitespace-pre-wrap leading-relaxed break-words">${escapeHtml(userText)}</div>
      ${userMeta}
    `;
  } else if (shouldCollapseExecution) {
    bodyHtml = buildExecutionResultCardHtml(content, tools, thinking, turnResult, {
      lazy: Boolean(renderOptions.lazyTools)
    });
  } else {
    const isBlankContent = !content || !String(content).trim();
    const formattedHtml = isBlankContent
      ? buildEmptyTurnFallbackHtml()
      : formatMessageContent(content);

    bodyHtml = `
      ${executionHtml}
      <div class="btw-content msg-content min-w-0">${formattedHtml}</div>
    `;
  }

  msgDiv.innerHTML = `<div class="${bubbleClass}">${bodyHtml}</div>`;
  targetContainer.appendChild(msgDiv);

  if (shouldCollapseExecution && renderOptions.lazyTools) {
    const lazyResult = msgDiv.querySelector('.lazy-result-card');
    if (lazyResult) {
      lazyResult.addEventListener('toggle', () => {
        if (!lazyResult.open || lazyResult.dataset.rendered) return;
        const body = lazyResult.querySelector('.execution-result-body');
        if (body) body.innerHTML = buildExecutionResultBodyHtml(content, tools, thinking, turnResult);
        lazyResult.dataset.rendered = 'true';
        prepareDeferredImages(lazyResult);
        if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(lazyResult);
      });
    }
  }

  if (renderOptions.lazyTools && !isUser && (tools?.length || String(thinking || '').trim())) {
    const lazyExecution = msgDiv.querySelector('.lazy-execution');
    if (lazyExecution) {
      lazyExecution.addEventListener('toggle', () => {
        if (!lazyExecution.open || lazyExecution.dataset.rendered) return;
        const body = lazyExecution.querySelector('.execution-detail-body');
        if (body) body.innerHTML = buildExecutionStepRowsHtml(tools, Boolean(String(thinking || '').trim()));
        lazyExecution.dataset.rendered = 'true';
      });
    }
  }

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
              provider: currentProvider,
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

  prepareDeferredImages(msgDiv);

  if (!renderOptions.deferEnhancement && typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(msgDiv);
  if (!renderOptions.deferScroll) scrollToBottom();
  return msgDiv;
}

// Delete Conversation Action (Instant Silent Deletion with Animation)
async function deleteConversationDirect(convId, wrapperElement, conversationProvider = currentProvider) {
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
    const res = await fetch(`/api/conversation?id=${convId}&provider=${encodeURIComponent(conversationProvider)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      if (currentConversationId === convId && currentProvider === conversationProvider) {
        currentConversationId = null;
        localStorage.setItem(activeConversationStorageKey(), '__new__');
        if (headerTitle) headerTitle.textContent = '新工作';
        messagesContainer.innerHTML = '';
        const activeRoleName = typeof roleMeta === 'function' ? roleMeta()?.name : '';
        appendMessage('assistant', activeRoleName
          ? `🧠 ${activeRoleName} 的這段工作紀錄已刪除。可以直接開始新的工作 Context。`
          : '這段工作紀錄已刪除。可以直接開始新的工作 Context。');
      }
      setTimeout(() => {
        if (wrapperElement && wrapperElement.parentNode) wrapperElement.remove();
        loadConversations({ force: true }).catch(() => {});
      }, 380);
    }
  } catch (err) {
    console.error('Delete failed:', err);
  }
}

// ✏️ Conversation title helpers
async function saveConversationTitle(convId, title, conversationProvider = currentProvider) {
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw new Error('標題不能為空白');

  const res = await fetch('/api/rename-conversation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: conversationProvider, conversation_id: convId, title: cleanTitle })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '重新命名失敗');

  if (currentConversationId === convId && headerTitle) headerTitle.textContent = cleanTitle;
  if (typeof loadConversations === 'function') loadConversations();
  if (navigator.vibrate) navigator.vibrate(25);
  return cleanTitle;
}

async function renameConversationDirect(convId, currentTitle, conversationProvider = currentProvider) {
  const defaultVal = currentTitle && !currentTitle.startsWith('對話 ') ? currentTitle : '';
  const newTitle = window.prompt('請輸入自定義對話標題：', defaultVal);
  if (newTitle === null) return;
  try {
    await saveConversationTitle(convId, newTitle, conversationProvider);
  } catch (err) {
    alert('重新命名失敗：' + err.message);
  }
}

window.saveConversationTitle = saveConversationTitle;

// Used by system-created conversations. Unlike manual rename it never opens a
// prompt, and updates the visible title immediately after the server accepts it.
async function renameConversationSilently(convId, title, conversationProvider = currentProvider) {
  const cleanTitle = shortenConversationTitle(title, 24);
  const res = await fetch('/api/rename-conversation', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: conversationProvider, conversation_id: convId, title: cleanTitle })
  });
  const data = await res.json();
  if (!data.success) throw new Error(data.error || '重新命名失敗');
  if (currentConversationId === convId && headerTitle) headerTitle.textContent = cleanTitle;
  if (typeof loadConversations === 'function') loadConversations();
  return cleanTitle;
}

let historyRenderVersion = 0;
let historyLoadOverlay = null;
let historyPageState = null;
let historyLoadEarlierObserver = null;
let backgroundHistoryPoll = null;

function stopBackgroundHistoryPoll() {
  if (!backgroundHistoryPoll) return;
  clearInterval(backgroundHistoryPoll.interval);
  backgroundHistoryPoll = null;
}

function showHistoryLoadOverlay() {
  if (historyLoadOverlay) historyLoadOverlay.remove();
  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/98 backdrop-blur-md opacity-0 transition-opacity duration-150';
  overlay.setAttribute('role', 'status');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div class="flex flex-col items-center gap-3 text-slate-200">
      <div class="w-9 h-9 rounded-full border-2 border-indigo-400/30 border-t-indigo-300 animate-spin"></div>
      <span class="text-sm font-medium">正在切換對話…</span>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.remove('opacity-0'));
  historyLoadOverlay = overlay;
  return overlay;
}

function hideHistoryLoadOverlay(overlay) {
  if (!overlay || overlay !== historyLoadOverlay) return;
  // Keep the cover in place through the scroll and one rendered frame so the
  // user never sees the transcript jump from its first message to the bottom.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (overlay !== historyLoadOverlay) return;
    overlay.classList.add('opacity-0');
    setTimeout(() => {
      if (overlay === historyLoadOverlay) historyLoadOverlay = null;
      overlay.remove();
    }, 160);
  }));
}

const HISTORY_INITIAL_MESSAGES = 12;

function findHistoryPageStart(messages, endIndex, count = HISTORY_INITIAL_MESSAGES) {
  let startIndex = Math.max(0, endIndex - count);
  // Prefer starting on a user turn so a reply is never shown without its question.
  while (startIndex > 0 && messages[startIndex].role !== 'user') startIndex -= 1;
  return startIndex;
}

function addLoadEarlierSentinel(state) {
  if (!state || state.startIndex <= 0 || state.renderVersion !== historyRenderVersion) return;
  if (historyLoadEarlierObserver) historyLoadEarlierObserver.disconnect();
  const sentinel = document.createElement('div');
  sentinel.className = 'history-load-earlier-sentinel w-full max-w-2xl mx-auto h-8 flex items-center justify-center text-[10px] text-slate-500';
  sentinel.textContent = '向上滑動以載入更早訊息';
  messagesContainer.prepend(sentinel);

  let loading = false;
  const loadEarlier = async () => {
    if (loading || state.renderVersion !== historyRenderVersion || currentConversationId !== state.convId) return;
    loading = true;
    sentinel.textContent = '正在載入更早訊息…';
    if (historyLoadEarlierObserver) historyLoadEarlierObserver.disconnect();

    const previousStart = state.startIndex;
    const nextStart = findHistoryPageStart(state.messages, previousStart);
    const fragment = document.createDocumentFragment();
    const rendered = await renderHistoryMessages(state.messages, state.convId, state.renderVersion, {
      startIndex: nextStart,
      endIndex: previousStart,
      container: fragment,
      scrollOnComplete: false
    });
    if (!rendered || state.renderVersion !== historyRenderVersion || currentConversationId !== state.convId) return;

    const previousHeight = messagesContainer.scrollHeight;
    const previousTop = messagesContainer.scrollTop;
    sentinel.remove();
    messagesContainer.prepend(fragment);
    messagesContainer.scrollTop = previousTop + (messagesContainer.scrollHeight - previousHeight);
    state.startIndex = nextStart;
    const heightBeforeSentinel = messagesContainer.scrollHeight;
    const topBeforeSentinel = messagesContainer.scrollTop;
    addLoadEarlierSentinel(state);
    messagesContainer.scrollTop = topBeforeSentinel + (messagesContainer.scrollHeight - heightBeforeSentinel);
  };

  if (typeof IntersectionObserver === 'undefined') return;
  historyLoadEarlierObserver = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) loadEarlier();
  }, { root: messagesContainer, rootMargin: '160px 0px 0px 0px', threshold: 0 });
  historyLoadEarlierObserver.observe(sentinel);
}

function renderHistoryMessages(messages, convId, renderVersion, options = {}) {
  const startIndex = options.startIndex || 0;
  const endIndex = options.endIndex ?? messages.length;
  const targetContainer = options.container || messagesContainer;
  const scrollOnComplete = options.scrollOnComplete !== false;
  const batchSize = 4;
  let nextUserTurn = messages.slice(0, startIndex).filter(message => message.role === 'user').length;
  const entries = messages.slice(startIndex, endIndex).map((message, index) => ({
    message,
    userTurnIndex: message.role === 'user' ? nextUserTurn++ : null,
    absoluteIndex: startIndex + index
  }));
  let index = 0;

  return new Promise(resolve => {
    const schedule = window.requestAnimationFrame || (callback => setTimeout(callback, 0));
    const renderBatch = () => {
      if (renderVersion !== historyRenderVersion || currentConversationId !== convId) {
        resolve(false);
        return;
      }

      const end = Math.min(index + batchSize, entries.length);
      for (; index < end; index += 1) {
        const { message, userTurnIndex, absoluteIndex } = entries[index];
        if (message.role === 'checkpoint') {
          const divider = buildCheckpointDividerHtml(message.content, message.timestamp);
          targetContainer.appendChild(divider);
          if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(divider);
          continue;
        }
        const isBtw = message.role === 'assistant' && absoluteIndex > 0 && /^\s*\/btw\b/i.test(messages[absoluteIndex - 1].content || '');
        appendMessage(message.role, message.content, message.timestamp, message.tools || [], message.thinking || '', isBtw, {
          lazyTools: message.role === 'assistant',
          historyExecutionFallback: message.role === 'assistant',
          turnResult: message.turn_result || null,
          deferScroll: true,
          userTurnIndex,
          container: targetContainer
        });
      }

      if (index < entries.length) {
        schedule(renderBatch);
      } else {
        if (scrollOnComplete) scrollToBottom(true);
        resolve(true);
      }
    };
    schedule(renderBatch);
  });
}

// Load History for a Conversation
async function loadConversationHistory(convId, { preserveComposer = false } = {}) {
  if (typeof window.isLiveSessionActive === 'function' && window.isLiveSessionActive()) {
    alert('🎙️ 目前仍在語音通話中，請先按紅色掛斷，完成備忘錄保存後再切換歷史對話。');
    return false;
  }
  // A previous load of this same conversation may still be polling a
  // background response. It must not append into a newer history render.
  stopBackgroundHistoryPoll();
  const renderVersion = ++historyRenderVersion;
  const historyProvider = currentProvider;
  const isCurrentHistory = () => renderVersion === historyRenderVersion
    && currentConversationId === convId && currentProvider === historyProvider;
  const historyQuery = `id=${encodeURIComponent(convId)}&provider=${encodeURIComponent(historyProvider)}`;
  const loadOverlay = showHistoryLoadOverlay();
  historyPageState = null;
  // Do not abort another conversation's stream. Its detached DOM can finish
  // safely in the background and its persisted history will be available when
  // the user returns; the guards inside sendMessage prevent cross-rendering.

  currentConversationId = convId;
  localStorage.setItem(activeConversationStorageKey(), convId);
  revokeAllBlobUrls();
  messagesContainer.innerHTML = '<div class="p-5 text-center text-xs text-slate-400 animate-pulse">正在載入對話紀錄…</div>';
  toggleDrawer(false);

  // 🎯 Instantly sync workspace & role from cachedConversations if available so there is 0ms window for cross-session pollution!
  if (Array.isArray(cachedConversations)) {
    const cached = cachedConversations.find(c => c.id === convId);
    if (cached) {
      if (cached.roleId && typeof window.setConversationRoleDirect === 'function') {
        window.setConversationRoleDirect(cached.roleId, null, cached.crewMemberId, cached.workspace);
      } else if (cached.crewMemberId && typeof window.setConversationCrewMemberDirect === 'function') {
        window.setConversationCrewMemberDirect(cached.crewMemberId, cached.workspace);
      } else if (cached.workspace && typeof window.setConversationWorkspaceDirect === 'function') {
        window.setConversationWorkspaceDirect(cached.workspace);
      }
    }
  }

  // 🔄 Reset input box and Send/Stop button to initial idle state
  if (!preserveComposer) {
    if (promptInput) {
      promptInput.value = '';
      promptInput.style.height = 'auto';
    }
    uploadedImagePath = null;
    if (cameraInput) cameraInput.value = '';
    if (typeof attachInput !== 'undefined' && attachInput) attachInput.value = '';
    if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
  }
  setStreamingState(false);

  try {
    const res = await fetch(`/api/history?${historyQuery}`);
    const data = await res.json();
    if (!isCurrentHistory()) return;

    // Conversations own their model choice. Restore it before rendering so the
    // header and the next message always agree with this thread.
    if (typeof window.applyConversationSettings === 'function') {
      window.applyConversationSettings(data.conversation_settings || { provider: currentProvider, workspace: '/data/data/com.termux/files/home' });
    }
    
    // 🧠 Provider total + Crew heuristic attribution.
    if (data.context_health || data.context_stats) {
      updateContextPill(data.context_stats || null, data.context_health || null);
    } else {
      updateContextPill(null, null);
    }

    // ⏳ Re-evaluate queue capsule visibility for this specific conversation
    renderQueuedMessageCapsule();

    if (data.messages && data.messages.length > 0) {
      const firstUserMsg = data.messages.find(m => m.role === 'user');
      if (headerTitle) {
        if (data.title) {
          headerTitle.textContent = data.title;
        } else {
          headerTitle.textContent = (firstUserMsg && firstUserMsg.content) ? firstUserMsg.content.slice(0, 18) : '對話紀錄';
        }
      }
      messagesContainer.innerHTML = '';
      const pageState = {
        messages: data.messages,
        convId,
        renderVersion,
        startIndex: findHistoryPageStart(data.messages, data.messages.length)
      };
      historyPageState = pageState;
      const rendered = await renderHistoryMessages(data.messages, convId, renderVersion, {
        startIndex: pageState.startIndex
      });
      if (!rendered) return;
      addLoadEarlierSentinel(pageState);
      scrollToBottom(true);
    } else {
      if (headerTitle) headerTitle.textContent = data.title || '新對話';
      appendMessage('assistant', '你好！已為你開啟此對話。有什麼可以幫你的？');
    }

    hideHistoryLoadOverlay(loadOverlay);

    // ⚡ Check if this conversation is actively generating in background and auto-resume loading UI
    try {
      const statusRes = await fetch(`/api/session-status?${historyQuery}`);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        if (!isCurrentHistory()) return;
        if (statusData.isBusy) {
          setStreamingState(true);
          const existingLive = document.getElementById('resumed-live-card');
          if (!existingLive) {
            const liveCard = document.createElement('div');
            liveCard.id = 'resumed-live-card';
            liveCard.className = 'w-full max-w-2xl mx-auto justify-start min-w-0';
            liveCard.innerHTML = `
              <div class="bg-slate-900 border border-indigo-500/50 text-slate-200 rounded-2xl p-3.5 text-xs sm:text-sm shadow-md w-full min-w-0 aurora-glow-box">
                <div class="flex items-center gap-2 text-indigo-300 font-medium">
                  <span class="w-2 h-2 rounded-full bg-indigo-400 animate-ping"></span>
                  <span>⚡ AI 正在背景持續生成回覆中...</span>
                </div>
              </div>
            `;
            messagesContainer.appendChild(liveCard);
            scrollToBottom(true);

            // Keep exactly one poll for the active history render. When the
            // response is persisted, reload history instead of appending its
            // final message; this guarantees one DOM card per response.
            const poll = { convId, renderVersion, interval: null };
            backgroundHistoryPoll = poll;
            poll.interval = setInterval(async () => {
              if (backgroundHistoryPoll !== poll || !isCurrentHistory()) {
                if (backgroundHistoryPoll === poll) stopBackgroundHistoryPoll();
                return;
              }
              try {
                const checkRes = await fetch(`/api/session-status?${historyQuery}`);
                if (checkRes.ok) {
                  const checkData = await checkRes.json();
                  if (backgroundHistoryPoll !== poll || !isCurrentHistory()) return;
                  if (!checkData.isBusy) {
                    stopBackgroundHistoryPoll();
                    setStreamingState(false);
                    const card = document.getElementById('resumed-live-card');
                    if (card) card.remove();
                    if (currentConversationId === convId && renderVersion === historyRenderVersion) {
                      loadConversationHistory(convId, { preserveComposer: true });
                    }
                    setTimeout(flushQueuedBtwMessage, 300);
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
    if (!isCurrentHistory()) return;
    messagesContainer.innerHTML = `<div class="p-4 text-center text-xs text-rose-400">載入歷史對話失敗：${err.message}</div>`;
  } finally {
    // Startup/provider changes can make this load stale and return early.
    // Always release its overlay so the WebView cannot stay covered forever.
    hideHistoryLoadOverlay(loadOverlay);
  }
}

// The drawer is normally closed while a turn is running. Defer its two
// provider-wide filesystem scans until the user opens it, and share concurrent
// callers so completion/title updates cannot start duplicate scans.
let conversationListRequest = null;

function isConversationDrawerVisible() {
  const drawerElement = document.getElementById('drawer');
  return !drawerElement || !drawerElement.classList.contains('-translate-x-full');
}

async function loadConversations({ force = false } = {}) {
  if (!convList) return [];
  if (!force && !isConversationDrawerVisible()) {
    return cachedConversations;
  }
  if (conversationListRequest) return conversationListRequest;

  conversationListRequest = (async () => {
    try {
      const providerIds = availableProviders.filter(provider => provider.capabilities?.history !== false).map(provider => provider.id);
      const results = await Promise.all(providerIds.map(async provider => {
        try {
          const response = await fetch('/api/conversations?provider=' + encodeURIComponent(provider));
          const data = await response.json();
          return (data.conversations || []).map(conversation => ({ ...conversation, provider }));
        } catch (_) {
          return [];
        }
      }));
      cachedConversations = results.flat().sort(compareConversationsStable);
      renderConversationItems(cachedConversations);
      window.renderRoleNavigation?.();
      return cachedConversations;
    } catch (err) {
      console.error('Failed to load conversations:', err);
      if (convList) convList.innerHTML = '<div class="p-4 text-center text-xs text-rose-400">無法載入工作紀錄</div>';
      return cachedConversations;
    } finally {
      conversationListRequest = null;
    }
  })();
  return conversationListRequest;
}

let cachedConversations = [];
const UNASSIGNED_WORKSPACE = '__crew-pocket-unassigned-workspace__';

function compareConversationsStable(a, b) {
  const updatedDiff = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
  return updatedDiff
    || (a.title || '').localeCompare(b.title || '', 'zh-TW')
    || String(a.id || '').localeCompare(String(b.id || ''));
}

function getRoleConversations(roleId, conversations = cachedConversations) {
  const targetRoleId = String(roleId || DEFAULT_ROLE_ID);
  return (conversations || [])
    .filter(conversation => String(conversation.roleId || DEFAULT_ROLE_ID) === targetRoleId)
    .slice()
    .sort(compareConversationsStable);
}

window.getLatestConversationForRole = function(roleId) {
  return getRoleConversations(roleId)[0] || null;
};

window.getCachedConversations = function() {
  return cachedConversations.slice();
};

function conversationWorkspaceLabel(workspace) {
  if (!workspace || workspace === UNASSIGNED_WORKSPACE) return '未指定';
  if (workspace === '/data/data/com.termux/files/home') return 'Home';
  return String(workspace).split('/').filter(Boolean).pop() || '未指定';
}

function renderConversationItems(conversations) {
  if (!convList) return;
  convList.innerHTML = '';

  const activeRoleId = typeof window.getCurrentRoleId === 'function'
    ? window.getCurrentRoleId()
    : DEFAULT_ROLE_ID;
  const filtered = getRoleConversations(activeRoleId, conversations);

  if (filtered.length === 0) {
    convList.innerHTML = '<div class="p-6 text-center text-xs text-slate-500">這個 Role 還沒有工作紀錄</div>';
    return;
  }

  const groupedByWorkspace = new Map();
  filtered.forEach(conv => {
    const workspace = conv.workspace || UNASSIGNED_WORKSPACE;
    if (!groupedByWorkspace.has(workspace)) groupedByWorkspace.set(workspace, []);
    groupedByWorkspace.get(workspace).push(conv);
  });
  const workspaceGroups = [...groupedByWorkspace.entries()]
    .map(([workspace, items]) => ({
      workspace,
      label: workspace === UNASSIGNED_WORKSPACE
        ? '未指定工作區'
        : (workspace === '/data/data/com.termux/files/home' ? 'Home' : workspace.split('/').filter(Boolean).pop()),
      items: items.sort(compareConversationsStable)
    }))
    .sort((a, b) => {
      const aUnassigned = a.workspace === UNASSIGNED_WORKSPACE;
      const bUnassigned = b.workspace === UNASSIGNED_WORKSPACE;
      if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
      return a.label.localeCompare(b.label, 'zh-TW')
        || String(a.workspace || '').localeCompare(String(b.workspace || ''));
    });

  const visibleWorkspaceGroups = workspaceGroups;

  if (visibleWorkspaceGroups.length === 0) {
    convList.innerHTML = '<div class="p-4 text-center text-xs text-slate-500">這個 Role 還沒有工作紀錄</div>';
    return;
  }

  visibleWorkspaceGroups.forEach(group => {
    const groupHeader = document.createElement('div');
    groupHeader.className = 'sticky top-0 z-10 flex items-center gap-2 px-1.5 py-1.5 text-[10px] font-semibold text-slate-500 bg-slate-900/95 backdrop-blur border-b border-slate-800/60';
    groupHeader.innerHTML = `<span class="text-xs">${group.workspace === UNASSIGNED_WORKSPACE ? '⚪' : (group.workspace === '/data/data/com.termux/files/home' ? '🏠' : '📁')}</span><span class="truncate">${escapeHtml(group.label)}</span><span class="ml-auto text-[9px] font-mono text-slate-600">${group.items.length}</span>`;
    convList.appendChild(groupHeader);

    group.items.forEach(conv => {
    const conversationProvider = conv.provider || 'antigravity';
    const isCurrent = conv.id === currentConversationId && conversationProvider === currentProvider;
    const conversationProviderConfig = providerConfig(conversationProvider);
    const providerLabel = conversationProviderConfig.shortLabel || conversationProviderConfig.label;
    const providerBadgeClass = conversationProviderConfig.badgeClass || 'bg-slate-500/20 text-slate-300 border-slate-500/40';
    const workspaceLabel = conv.workspace
      ? conversationWorkspaceLabel(conv.workspace)
      : '未指定';
    const wrapper = document.createElement('div');
    wrapper.className = 'swipe-item-wrapper relative overflow-hidden rounded-xl mb-1 select-none transition-all duration-200';
    wrapper.style.maxHeight = '64px';

    const displayTitle = escapeHtml(conv.title);

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
      <div class="swipe-item-content relative z-10 px-2.5 py-2 rounded-xl cursor-pointer flex items-center justify-between text-xs transition-transform duration-75 touch-pan-y ${
        isCurrent ? 'bg-indigo-950 text-indigo-200 border border-indigo-500/60 shadow-md' : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800'
      }">
        <div class="flex flex-col truncate min-w-0 flex-1 pointer-events-none pr-1 gap-0.5">
          <div class="flex items-center gap-1.5 truncate">
            <span class="truncate font-medium">${displayTitle}</span>
          </div>
          <div class="flex items-center gap-1.5 truncate text-[9px] text-slate-500">
            <span class="px-1 py-0.2 rounded border font-mono shrink-0 ${providerBadgeClass}">${providerLabel}</span>
            <span class="truncate">${isCurrent && isStreaming ? '● 回覆中' : (workspaceLabel || '未指定工作區')}</span>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0 ml-1">
          ${isCurrent ? '<span class="text-[9px] px-1.5 py-0.2 rounded-full bg-indigo-900 text-indigo-200 border border-indigo-500/60 font-mono shrink-0">目前</span>' : ''}
        </div>
      </div>
    `;

    const contentEl = wrapper.querySelector('.swipe-item-content');

    // Swipe Gesture Handling
    let startX = 0;
    let startY = 0;
    let currentDiffX = 0;
    let isSwiping = false;
    let isVerticalScroll = false;
    let isDeleted = false;
    let longPressTimer = null;
    let longPressTriggered = false;
    let suppressClickUntil = 0;

    const cancelLongPress = () => {
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = null;
    };

    const scheduleLongPressRename = () => {
      cancelLongPress();
      longPressTriggered = false;
      longPressTimer = setTimeout(() => {
        if (isDeleted || isSwiping || isVerticalScroll) return;
        longPressTriggered = true;
        suppressClickUntil = Date.now() + 900;
        if (typeof window.haptic === 'function') window.haptic('medium');
        renameConversationDirect(conv.id, conv.title, conversationProvider);
      }, 520);
    };

    const onTouchStart = (clientX, clientY) => {
      if (isDeleted) return;
      startX = clientX;
      startY = clientY;
      currentDiffX = 0;
      isSwiping = false;
      isVerticalScroll = false;
      wrapper.classList.remove('is-swiping-left');
      contentEl.style.transition = 'none';
      scheduleLongPressRename();
    };

    const onTouchMove = (clientX, clientY) => {
      if (isDeleted) return;
      const diffX = clientX - startX;
      const diffY = clientY - startY;

      if (Math.abs(diffX) > 7 || Math.abs(diffY) > 7) cancelLongPress();

      if (!isSwiping && !isVerticalScroll) {
        if (Math.abs(diffY) > Math.abs(diffX) + 4) {
          isVerticalScroll = true;
          return;
        } else if (Math.abs(diffX) > 8) {
          isSwiping = true;
        }
      }

      if (isVerticalScroll) return;

      if (diffX < 0) {
        currentDiffX = diffX;
        const visualX = diffX < -120 ? -120 + (diffX + 120) * 0.35 : diffX;
        wrapper.classList.toggle('is-swiping-left', diffX < -8);
        contentEl.style.transform = `translateX(${visualX}px)`;
      } else {
        currentDiffX = 0;
        wrapper.classList.remove('is-swiping-left');
        contentEl.style.transform = 'translateX(0px)';
      }
    };

    const onTouchEnd = () => {
      cancelLongPress();
      if (longPressTriggered) {
        longPressTriggered = false;
        currentDiffX = 0;
        contentEl.style.transform = 'translateX(0px)';
        return;
      }
      if (isDeleted || isVerticalScroll) return;

      if (currentDiffX < -75) {
        const title = String(conv.title || conv.preview || '這個對話').trim();
        const confirmed = window.confirm(`確定刪除「${title}」？\n\n此對話將永久移除，無法復原。`);
        if (!confirmed) {
          currentDiffX = 0;
          wrapper.classList.remove('is-swiping-left');
          contentEl.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
          contentEl.style.transform = 'translateX(0px)';
          return;
        }
        isDeleted = true;
        deleteConversationDirect(conv.id, wrapper, conversationProvider);
      } else {
        wrapper.classList.remove('is-swiping-left');
        contentEl.style.transition = 'transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)';
        contentEl.style.transform = 'translateX(0px)';
      }
    };

    contentEl.addEventListener('touchstart', (e) => {
      onTouchStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    contentEl.addEventListener('touchmove', (e) => {
      onTouchMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    contentEl.addEventListener('touchend', onTouchEnd, { passive: true });
    contentEl.addEventListener('touchcancel', () => {
      cancelLongPress();
      onTouchEnd();
    }, { passive: true });

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

    contentEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      renameConversationDirect(conv.id, conv.title, conversationProvider);
    });

    contentEl.title = '點擊開啟 · 長按重新命名 · 左滑刪除';

    contentEl.addEventListener('click', () => {
      if (longPressTriggered || Date.now() < suppressClickUntil) return;
      if (!isDeleted && Math.abs(currentDiffX) < 10) {
        window.applyConversationSettings({
          provider: conversationProvider,
          model: conv.model,
          effort: conv.effort,
          loadingModel: !conv.model
        });
        loadConversationHistory(conv.id);
      }
    });

      convList.appendChild(wrapper);
    });
  });
}

const BTW_QUEUE_LIMIT = 3;
const queuedBtwMessages = [];

function getPromptText() {
  return (promptInput?.value || '')
    .replace(/\[Context:[\s\S]*?(?:\](?:\n\n|\n|$)|$)/gi, '')
    .trim();
}

function isBtwPrompt(text = getPromptText()) {
  return /^\s*\/btw\b/i.test(text);
}

const activeRoleStreamRegistry = new Map();

function currentStreamRoleId() {
  const roleId = typeof window.getCurrentRoleId === 'function'
    ? window.getCurrentRoleId()
    : 'role-general';
  return String(roleId || 'role-general').trim() || 'role-general';
}

function getActiveRoleStream(roleId = currentStreamRoleId()) {
  return activeRoleStreamRegistry.get(String(roleId || 'role-general')) || null;
}

function syncActiveRoleStreamingState() {
  const roleId = currentStreamRoleId();
  const activeStream = getActiveRoleStream(roleId);
  isStreaming = Boolean(activeStream);
  currentAbortController = activeStream?.controller || null;
  document.body.classList.toggle('ai-streaming', isStreaming);
  if (typeof updateSendButtonMode === 'function') updateSendButtonMode();
  if (typeof renderQueuedMessageCapsule === 'function') renderQueuedMessageCapsule();
  window.dispatchEvent(new CustomEvent('crew:streaming-state', {
    detail: {
      streaming: isStreaming,
      roleId,
      conversationId: activeStream?.conversationId || currentConversationId || null,
      provider: activeStream?.provider || currentProvider
    }
  }));
  hydrateRoleMessageQueue(roleId).then(() => {
    renderQueuedMessageCapsule();
    updateSendButtonMode();
    if (!isStreaming && currentStreamRoleId() === roleId && !getActiveRoleStream(roleId)) {
      window.setTimeout(flushQueuedBtwMessage, 0);
    }
  }).catch(() => {});
  return activeStream;
}

function registerActiveRoleStream(stream = {}) {
  const roleId = String(stream.roleId || currentStreamRoleId());
  const previous = getActiveRoleStream(roleId) || {};
  const next = {
    ...previous,
    ...stream,
    roleId,
    controller: stream.controller === undefined ? (previous.controller || null) : stream.controller,
    source: stream.source || previous.source || 'local'
  };
  activeRoleStreamRegistry.set(roleId, next);
  if (roleId === currentStreamRoleId()) syncActiveRoleStreamingState();
  return next;
}

function updateActiveRoleStream(roleId, patch = {}) {
  const key = String(roleId || currentStreamRoleId());
  const current = getActiveRoleStream(key);
  if (!current) return null;
  const next = { ...current, ...patch, roleId: key };
  activeRoleStreamRegistry.set(key, next);
  if (key === currentStreamRoleId()) syncActiveRoleStreamingState();
  return next;
}

function clearActiveRoleStream(roleId = currentStreamRoleId(), expectedController) {
  const key = String(roleId || currentStreamRoleId());
  const current = getActiveRoleStream(key);
  if (!current) {
    if (key === currentStreamRoleId()) syncActiveRoleStreamingState();
    return false;
  }
  if (arguments.length >= 2 && current.controller !== expectedController) return false;
  activeRoleStreamRegistry.delete(key);
  if (key === currentStreamRoleId()) syncActiveRoleStreamingState();
  return true;
}

function ensureExternalActiveRoleStream({ roleId = currentStreamRoleId(), provider = currentProvider, conversationId = currentConversationId } = {}) {
  const existing = getActiveRoleStream(roleId);
  if (existing) {
    return updateActiveRoleStream(roleId, {
      provider: provider || existing.provider,
      conversationId: conversationId || existing.conversationId
    });
  }
  return registerActiveRoleStream({
    roleId,
    controller: null,
    provider,
    conversationId,
    source: 'external',
    startedAt: Date.now()
  });
}

window.getActiveRoleStream = getActiveRoleStream;
window.syncActiveRoleStreamingState = syncActiveRoleStreamingState;
window.clearActiveRoleStream = clearActiveRoleStream;

const queuedMessagesByRole = new Map();
const hydratedRoleQueues = new Set();
const roleQueueHydrationRequests = new Map();

function getQueuedMessagesForRole(roleId = currentStreamRoleId()) {
  return queuedMessagesByRole.get(String(roleId || 'role-general')) || [];
}
function getPendingQueuedMessageForRole(roleId = currentStreamRoleId()) {
  return getQueuedMessagesForRole(roleId)[0] || null;
}
async function hydrateRoleMessageQueue(roleId = currentStreamRoleId(), { force = false } = {}) {
  const key = String(roleId || 'role-general');
  if (!force && hydratedRoleQueues.has(key)) return getQueuedMessagesForRole(key);
  if (roleQueueHydrationRequests.has(key)) return roleQueueHydrationRequests.get(key);
  const request = fetch(`/api/role-queue?role_id=${encodeURIComponent(key)}`, { cache: 'no-store' })
    .then(async response => {
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || '無法讀取 Role queue');
      const messages = Array.isArray(data.messages) ? data.messages : [];
      queuedMessagesByRole.set(key, messages);
      hydratedRoleQueues.add(key);
      return messages;
    })
    .finally(() => roleQueueHydrationRequests.delete(key));
  roleQueueHydrationRequests.set(key, request);
  return request;
}
async function setPendingQueuedMessage(msg) {
  const roleId = currentStreamRoleId();
  const conversationId = currentConversationId || getActiveRoleStream(roleId)?.conversationId || null;
  const response = await fetch('/api/role-queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'enqueue',
      role_id: roleId,
      provider: currentProvider,
      conversation_id: conversationId,
      text: msg?.text || '',
      image_path: msg?.imagePath || msg?.image_path || null,
      source: msg?.source || 'chat'
    })
  });
  const data = await response.json();
  if (!response.ok || !data.success || !data.message) throw new Error(data.error || '排隊訊息保存失敗');
  const messages = getQueuedMessagesForRole(roleId).filter(item => item.id !== data.message.id);
  messages.push(data.message);
  messages.sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
  queuedMessagesByRole.set(roleId, messages);
  hydratedRoleQueues.add(roleId);
  renderQueuedMessageCapsule();
  updateSendButtonMode();
  return data.message;
}
async function removePendingQueuedMessage(message, roleId = currentStreamRoleId()) {
  const key = String(roleId || 'role-general');
  if (!message?.id) return null;
  const response = await fetch('/api/role-queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'remove', role_id: key, message_id: message.id })
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || '移除排隊訊息失敗');
  queuedMessagesByRole.set(key, getQueuedMessagesForRole(key).filter(item => item.id !== message.id));
  renderQueuedMessageCapsule();
  updateSendButtonMode();
  return data.removed || message;
}
async function clearPendingQueuedMessage(roleId = currentStreamRoleId()) {
  const key = String(roleId || 'role-general');
  const response = await fetch('/api/role-queue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clear', role_id: key })
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || '清除 Role queue 失敗');
  queuedMessagesByRole.set(key, []);
  hydratedRoleQueues.add(key);
  renderQueuedMessageCapsule();
  updateSendButtonMode();
  return Number(data.removed || 0);
}
function currentConversationQueuedMessages() {
  return getQueuedMessagesForRole().filter(message =>
    message.conversationId === currentConversationId &&
    message.providerId === currentProvider
  );
}
function renderQueuedMessageCapsule() {
  const capsule = document.getElementById('queued-msg-capsule');
  const preview = document.getElementById('queued-msg-preview');
  if (!capsule) return;
  const messages = currentConversationQueuedMessages();
  const pendingQueuedMessage = messages[0] || null;
  if (pendingQueuedMessage) {
    if (preview) preview.textContent = `${pendingQueuedMessage.text || '圖片訊息'}${messages.length > 1 ? ` · 另有 ${messages.length - 1} 則` : ''}`;
    capsule.classList.remove('hidden');
  } else {
    capsule.classList.add('hidden');
  }
}

function updateBtwQueueStatus() {
  const status = document.getElementById('btw-queue-status');
  if (status) status.classList.add('hidden');
}

// ⚡ While a main response is active, typing text turns the action into "Queue Message" (Amber)
function updateSendButtonMode() {
  if (!sendBtn || !sendIcon || !stopIcon) return;
  const queueIcon = document.getElementById('queue-icon');
  const queueCountBadge = document.getElementById('send-queue-count');
  const srLabel = document.getElementById('send-btn-sr-label');
  const hasInputText = promptInput ? promptInput.value.trim().length > 0 : false;
  const currentQueue = currentConversationQueuedMessages();
  const queuedForCurrentRole = currentQueue.length > 0;
  if (queueCountBadge) {
    queueCountBadge.classList.toggle('hidden', !queuedForCurrentRole);
    queueCountBadge.textContent = queuedForCurrentRole ? String(currentQueue.length) : '';
  }

  sendBtn.classList.remove(
    'bg-indigo-600', 'hover:bg-indigo-500', 'active:bg-indigo-700', 'shadow-indigo-600/30',
    'bg-rose-600', 'hover:bg-rose-500', 'active:bg-rose-700', 'shadow-rose-600/30',
    'bg-amber-600', 'hover:bg-amber-500', 'active:bg-amber-700', 'shadow-amber-600/30',
    'bg-teal-600', 'hover:bg-teal-500', 'active:bg-teal-700', 'shadow-teal-600/30'
  );

  if (isBtwPrompt()) {
    sendBtn.classList.add('bg-teal-600', 'hover:bg-teal-500', 'active:bg-teal-700', 'shadow-teal-600/30');
    sendIcon.classList.remove('hidden');
    stopIcon.classList.add('hidden');
    if (queueIcon) queueIcon.classList.add('hidden');
    sendBtn.title = '⚡ 即時並行快問快答 /btw';
    sendBtn.setAttribute('aria-label', '⚡ 即時並行快問快答 /btw');
    if (srLabel) srLabel.textContent = '即時並行發送';
  } else if (isStreaming && hasInputText) {
    // 📥 User is typing while AI is streaming -> Queue Mode
    sendBtn.classList.add('bg-amber-600', 'hover:bg-amber-500', 'active:bg-amber-700', 'shadow-amber-600/30');
    sendIcon.classList.add('hidden');
    stopIcon.classList.add('hidden');
    if (queueIcon) queueIcon.classList.remove('hidden');
    sendBtn.title = '📥 排隊發送（等 AI 回應完自動送出）';
    sendBtn.setAttribute('aria-label', '📥 排隊發送');
    if (srLabel) srLabel.textContent = '排隊發送';
  } else if (isStreaming) {
    // 🛑 No input text -> Stop / Interrupt active generation
    sendBtn.classList.add('bg-rose-600', 'hover:bg-rose-500', 'active:bg-rose-700', 'shadow-rose-600/30');
    sendIcon.classList.add('hidden');
    stopIcon.classList.remove('hidden');
    if (queueIcon) queueIcon.classList.add('hidden');
    sendBtn.title = '中斷生成';
    sendBtn.setAttribute('aria-label', '中斷生成');
    if (srLabel) srLabel.textContent = '中斷生成';
  } else {
    // 💬 Normal Send Mode
    sendBtn.classList.add('bg-indigo-600', 'hover:bg-indigo-500', 'active:bg-indigo-700', 'shadow-indigo-600/30');
    sendIcon.classList.remove('hidden');
    stopIcon.classList.add('hidden');
    if (queueIcon) queueIcon.classList.add('hidden');
    sendBtn.title = '發送訊息';
    sendBtn.setAttribute('aria-label', '發送訊息');
    if (srLabel) srLabel.textContent = '發送訊息';
  }
}

// ⚡ Instant Concurrent Non-blocking /btw Side-Question (Compatible with both AGY & Codex)
async function sendBtwConcurrentSidecard(customText = null, customImgPath = null) {
  const rawText = customText !== null ? customText : getPromptText();
  const imgPath = customImgPath !== null ? customImgPath : uploadedImagePath;
  if (!rawText && !imgPath) return;

  const cleanQuery = rawText.replace(/^\/btw\b/i, '').trim() || rawText;

  // 1. Clear input bar immediately so user can continue without friction
  promptInput.value = '';
  promptInput.style.height = 'auto';
  uploadedImagePath = null;
  if (cameraInput) cameraInput.value = '';
  if (typeof attachInput !== 'undefined' && attachInput) attachInput.value = '';
  if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
  if (slashMenu) slashMenu.classList.add('hidden');
  updateSendButtonMode();
  if (typeof window.haptic === 'function') window.haptic([25, 40]);

  // 2. Append User [💬 順帶一提] Bubble cleanly
  let userDisplay = cleanQuery;
  if (imgPath) userDisplay = `[Uploaded Image: ${imgPath}]\n${userDisplay}`;
  appendMessage('user', userDisplay, undefined, [], '', true);

  // 3. Append Assistant Concurrent BTW Side Card
  const startTs = performance.now();
  const modelObj = availableModels.find(m => m.id === currentModel);
  const modelLabel = modelObj ? modelObj.name : 'AI';

  const btwMsgDiv = document.createElement('div');
  btwMsgDiv.className = 'w-full max-w-2xl mx-auto justify-start min-w-0 btw-side-container my-2';
  btwMsgDiv.innerHTML = `
    <div class="btw-card bg-gradient-to-b from-slate-900 via-slate-900 to-teal-950/40 border border-teal-500/50 text-slate-200 rounded-2xl p-3 sm:p-3.5 text-xs sm:text-sm shadow-lg shadow-teal-950/30 w-full min-w-0 prose">
      <div class="live-status mb-2.5 rounded-2xl bg-gradient-to-b border-teal-500/40 from-slate-900 to-teal-950/40 aurora-glow-box-teal border overflow-hidden shadow-lg select-none">
        <div class="shimmer-bar-teal h-[2px] w-full"></div>
        <div class="p-2 flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <span class="inline-block w-2 h-2 rounded-full bg-teal-400 animate-ping shrink-0"></span>
            <span class="text-[9px] px-1.5 py-0.5 rounded border font-mono font-semibold bg-teal-500/20 text-teal-300 border-teal-500/40 shrink-0">${escapeHtml(modelLabel)}</span>
            <span class="btw-status-text truncate font-medium text-[11px] text-teal-200">💬 順帶一提快問快答中...</span>
          </div>
          <span class="btw-timer font-bold text-[10px] text-slate-300 bg-slate-800/90 px-1.5 py-0.5 rounded border border-slate-700 font-mono">0.0s</span>
        </div>
      </div>
      <div class="btw-content msg-content leading-relaxed min-w-0"><span class="inline-block w-2 h-4 bg-teal-400 animate-pulse"></span></div>
      <div class="btw-response-time mt-2 border-t border-teal-900/60 pt-1.5 text-right text-[10px] text-slate-500 font-mono select-none"></div>
    </div>
  `;
  messagesContainer.appendChild(btwMsgDiv);
  scrollToBottom();

  const contentElem = btwMsgDiv.querySelector('.msg-content');
  const liveStatusElem = btwMsgDiv.querySelector('.live-status');
  const timerElem = btwMsgDiv.querySelector('.btw-timer');
  const responseTimeElem = btwMsgDiv.querySelector('.btw-response-time');

  const timerInterval = setInterval(() => {
    if (timerElem) timerElem.textContent = ((performance.now() - startTs) / 1000).toFixed(1) + 's';
  }, 100);

  const sideAbort = new AbortController();
  let accumulated = '';

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: `/btw ${cleanQuery}`,
        conversation_id: null, // 🌟 Isolate to ephemeral session: NEVER touches or interrupts busy main stream!
        is_btw: true,
        provider: currentProvider,
        model: currentModel,
        effort: 'low', // Fast low reasoning for instant 1s answers across Gemini & Codex
        image_path: imgPath,
        workspace: (typeof currentWorkspace !== 'undefined') ? currentWorkspace : '/data/data/com.termux/files/home',
        role_id: typeof window.getCurrentRoleId === 'function' ? window.getCurrentRoleId() : 'role-general',
        role: 'general',

      }),
      signal: sideAbort.signal
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.delta) {
              accumulated += parsed.delta;
              contentElem.innerHTML = formatMessageContent(accumulated);
              scrollToBottom();
            } else if (parsed.response) {
              accumulated = parsed.response;
              contentElem.innerHTML = formatMessageContent(accumulated);
            }
          } catch (e) {}
        }
      }
    }
  } catch (err) {
    if (!accumulated) {
      contentElem.innerHTML = `<span class="text-rose-400">⚠️ 快問快答連線中斷: ${escapeHtml(err.message)}</span>`;
    }
  } finally {
    clearInterval(timerInterval);
    if (responseTimeElem) {
      responseTimeElem.textContent = `🕒 回覆時間 ${formatMessageTimestamp()}`;
    }
    if (liveStatusElem) liveStatusElem.style.display = 'none';
    if (accumulated) {
      contentElem.innerHTML = formatMessageContent(accumulated);
      if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(btwMsgDiv);
    }
    if (typeof window.haptic === 'function') window.haptic([20, 30]);
    scrollToBottom();
  }
}

async function flushQueuedBtwMessage() {
  await hydrateRoleMessageQueue(currentStreamRoleId()).catch(() => []);
  const msgToSend = currentConversationQueuedMessages()[0] || null;
  if (!msgToSend || isStreaming) return;
  try {
    await removePendingQueuedMessage(msgToSend, msgToSend.roleId);
  } catch (error) {
    console.warn('[Role Queue] Unable to dequeue message:', error.message);
    return;
  }
  window.setTimeout(() => sendMessage({
    text: msgToSend.text,
    imagePath: msgToSend.imagePath || null,
    source: msgToSend.source || 'queue'
  }), 120);
}
function clearQueuedBtwMessages() {
  return clearPendingQueuedMessage().catch(error => {
    console.warn('[Role Queue] Clear failed:', error.message);
    return 0;
  });
}
async function sendRoleMessage(payload = {}) {
  const text = String(payload.text || payload.message || '').trim();
  const imagePath = payload.imagePath || payload.image_path || null;
  if (!text && !imagePath) return { success: false, error: '訊息不可為空。' };
  const roleId = currentStreamRoleId();
  const activeStream = getActiveRoleStream(roleId);
  if (activeStream) {
    try {
      const message = await setPendingQueuedMessage({ text, imagePath, source: payload.source || 'external' });
      return {
        success: true,
        status: 'queued',
        roleId,
        conversationId: message.conversationId || activeStream.conversationId || null,
        queueCount: getQueuedMessagesForRole(roleId).length
      };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  Promise.resolve(sendMessage({ text, imagePath })).catch(error => console.warn('[Role Message] Background send failed:', error?.message || error));
  return { success: true, status: 'sent', roleId, conversationId: currentConversationId || null };
}
window.sendRoleMessage = sendRoleMessage;
window.hydrateRoleMessageQueue = hydrateRoleMessageQueue;
window.getRoleQueuedMessages = getQueuedMessagesForRole;

// Toggle Send / Stop button appearance & state// Toggle Send / Stop button appearance & state
function setStreamingState(streaming) {
  const roleId = currentStreamRoleId();
  const activeStream = getActiveRoleStream(roleId);
  if (streaming && !activeStream) {
    ensureExternalActiveRoleStream({
      roleId,
      provider: currentProvider,
      conversationId: currentConversationId
    });
    return;
  }
  if (!streaming && activeStream?.source === 'external') {
    clearActiveRoleStream(roleId);
    return;
  }
  syncActiveRoleStreamingState();
}

// Stop active generation
async function stopGeneration() {
  if (typeof streamingTTS !== 'undefined') {
    streamingTTS.stop();
  }

  const roleId = currentStreamRoleId();
  const activeStream = getActiveRoleStream(roleId);
  const targetController = activeStream?.controller || currentAbortController || null;
  const targetProvider = activeStream?.provider || currentProvider;
  const targetConversationId = activeStream?.conversationId || currentConversationId || null;

  if (targetController) {
    try {
      targetController.abort();
    } catch (e) {}
  }

  if (activeStream) {
    if (activeStream.controller) clearActiveRoleStream(roleId, activeStream.controller);
    else clearActiveRoleStream(roleId);
  } else {
    syncActiveRoleStreamingState();
  }

  try {
    await fetch('/api/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: targetProvider,
        conversation_id: targetConversationId
      })
    });
  } catch (e) {}

  if (typeof window.haptic === 'function') {
    window.haptic('heavy');
  }
}
window.stopGeneration = stopGeneration;

// Send Message with Live Streaming, Tools Logging, and Abort Support
async function sendMessage(queuedMessage = null) {
  let text = '';
  let imgPath = null;

  if (typeof queuedMessage === 'string') {
    text = queuedMessage.trim();
  } else if (queuedMessage && typeof queuedMessage === 'object') {
    text = (queuedMessage.text || '').trim();
    imgPath = queuedMessage.imagePath || null;
  } else {
    text = getPromptText();
    imgPath = uploadedImagePath;
  }

  if (!text && !imgPath) {
    if (promptInput) {
      promptInput.focus();
      promptInput.classList.add('ring-2', 'ring-indigo-500');
      setTimeout(() => promptInput.classList.remove('ring-2', 'ring-indigo-500'), 300);
    }
    return;
  }
// 🧹 Clear All / Reset Conversation Initialization
async function clearAndResetCurrentConversation(skipConfirm = false) {
  if (isStreaming) {
    await stopGeneration();
  }

  if (!skipConfirm && currentConversationId) {
    const title = headerTitle ? headerTitle.textContent : '當前對話';
    const confirmed = window.confirm(`確定要清空並初始化「${title}」的紀錄嗎？\n\n所有對話歷史將重置，所選工作區與模型設定會完整保留。`);
    if (!confirmed) return false;
  }

  const oldConvId = currentConversationId;
  const targetProvider = currentProvider;

  if (oldConvId) {
    fetch(`/api/conversation?id=${encodeURIComponent(oldConvId)}&provider=${encodeURIComponent(targetProvider)}`, {
      method: 'DELETE'
    }).then(response => {
      if (!response.ok) throw new Error(`清空${targetProvider === 'codex' ? ' Codex' : ''} 對話失敗`);
    }).catch(error => console.warn('[Conversation clear]', error.message));
  }

  currentConversationId = null;
  localStorage.removeItem(activeConversationStorageKey());
  revokeAllBlobUrls();
  if (typeof clearQueuedBtwMessages === 'function') clearQueuedBtwMessages();
  if (typeof setStreamingState === 'function') setStreamingState(false);
  if (typeof updateContextPill === 'function') updateContextPill(null);

  if (promptInput) {
    promptInput.value = '';
    promptInput.style.height = 'auto';
  }
  uploadedImagePath = null;
  if (cameraInput) cameraInput.value = '';
  if (typeof attachInput !== 'undefined' && attachInput) attachInput.value = '';
  if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');

  if (headerTitle) headerTitle.textContent = '新對話';
  if (messagesContainer) messagesContainer.innerHTML = '';
  appendMessage('assistant', '你好！已為你清空並初始化此對話。有什麼可以幫你的？');

  const toolsDropdown = document.getElementById('tools-menu-dropdown');
  if (toolsDropdown) toolsDropdown.classList.add('hidden');

  if (typeof loadConversations === 'function') {
    loadConversations();
  }

  if (typeof window.haptic === 'function') {
    window.haptic([25, 50, 25]);
  }

  return true;
}
window.clearAndResetCurrentConversation = clearAndResetCurrentConversation;

  const lowerText = text.toLowerCase();
  if (lowerText === '/clear' || lowerText === '/clear-all' || lowerText === '/clearcontext' || lowerText === '/reset' || lowerText === '/init') {
    await clearAndResetCurrentConversation(true);
    return;
  }

  // 📦 /compact and /compact-max - Memory Compaction & Context Pruning
  if (/^\/compact\b/i.test(text)) {
    promptInput.value = '';
    promptInput.style.height = 'auto';
    uploadedImagePath = null;
    if (cameraInput) cameraInput.value = '';
    if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');

    if (!providerConfig().capabilities?.compact) {
      appendMessage('assistant', '⚠️ 此 Provider 尚未支援對話精簡。');
      return;
    }

    if (!currentConversationId) {
      appendMessage('assistant', '⚠️ 當前為新對話，尚未有歷史紀錄可供壓縮。請在對話累積後再執行 `/compact` 進行精簡！');
      return;
    }

    const targetConvId = currentConversationId;
    const compactProvider = currentProvider;
    const compactRenderVersion = historyRenderVersion;
    const isCompactVisible = () => currentConversationId === targetConvId
      && currentProvider === compactProvider && historyRenderVersion === compactRenderVersion;
    const compactMode = /^\/compact-max\b/i.test(text) ? 'max' : 'continue';
    const isMaxCompact = compactMode === 'max';
    // Codex native compact keeps the same thread. Its max variant therefore
    // deliberately starts a fresh thread with a compact handoff instead.
    if (isMaxCompact && currentProvider === 'codex') {
      await startLowContextContinuation();
      return;
    }
    const focusText = text.replace(/^\/compact(?:-max)?\s*/i, '').trim();
    const isEnglish = typeof getCrewLocale === 'function' && getCrewLocale() === 'en';
    appendMessage('user', text, undefined, [], '', false);

    const compactingMsgDiv = document.createElement('div');
    compactingMsgDiv.className = 'flex gap-2.5 w-full max-w-2xl mx-auto justify-start min-w-0';
    compactingMsgDiv.innerHTML = `
      <div class="w-7 h-7 rounded-full bg-cyan-600/30 border border-cyan-500/50 flex items-center justify-center text-cyan-300 shrink-0 text-xs font-bold mt-0.5">📦</div>
      <div class="bg-slate-900/90 border border-cyan-500/50 text-slate-200 rounded-2xl rounded-tl-none p-3.5 text-xs sm:text-sm shadow-xl flex-1 min-w-0 prose thinking-active-glow">
        <div class="flex items-center gap-2 text-cyan-300 font-bold mb-1.5">
          <span class="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
          <span>📦 ${isMaxCompact ? (isEnglish ? 'Max-compacting conversation memory...' : '正在極致精簡對話記憶...') : (isEnglish ? 'Compacting continuation context...' : '正在提煉可接續的對話狀態...')}</span>
        </div>
        <p class="text-slate-400 text-xs leading-relaxed">
          ${isMaxCompact ? (isEnglish ? 'Keeping only final outcome, remaining verification, and non-negotiable state to reduce context.' : '只保留最終成果、待驗證事項與不可遺失的關鍵狀態，盡量降低 Context。') : (isEnglish ? 'Keeping the active task, decisions, paths, values, and next action so work can continue smoothly.' : '保留目前任務、決策、路徑、數值與下一步，讓壓縮後能無縫繼續工作。')}
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
          conversation_id: targetConvId,
          focus: focusText,
          mode: compactMode,
          provider: compactProvider,
          locale: typeof getCrewLocale === 'function' ? getCrewLocale() : 'zh-TW'
        })
      });
      const data = await res.json();
      if (compactingMsgDiv.parentNode) compactingMsgDiv.remove();

      // 🛡️ Cross-Session Guard: Only update active DOM if user is STILL in the same conversation!
      if (isCompactVisible()) {
        if (data.success && data.summary) {
          // 🌟 Visual Persistence: Do not wipe screen! Append glowing checkpoint divider
          const divider = buildCheckpointDividerHtml(data.summary, new Date().toISOString());
          messagesContainer.appendChild(divider);
          if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(divider);
          if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
          scrollToBottom(true);
          if (data.context_verification?.status === 'not_reduced') {
            appendMessage('assistant', '⚠️ 原生 compact 已完成，但 Context 未明顯下降。請在 Context 視窗使用「建立低 Context 續接對話」，舊對話會完整保留。');
          } else if (data.context_verification?.status === 'pending') {
            appendMessage('assistant', 'ℹ️ 原生 compact 已完成；Codex 尚未回傳壓縮後 token，用下一次回覆的 Context 數字確認是否有效下降。');
          }
        } else {
          appendMessage('assistant', `⚠️ 壓縮失敗：${data.error || '未知錯誤'}`);
        }
      } else {
        console.log(`[Compact] Completed background compaction for conversation ${targetConvId}`);
        if (navigator.vibrate) navigator.vibrate([30, 50, 30]);
      }
    } catch (e) {
      if (compactingMsgDiv.parentNode) compactingMsgDiv.remove();
      if (isCompactVisible()) {
        appendMessage('assistant', `⚠️ 壓縮請求失敗：${e.message}`);
      }
    }
    return;
  }

  if (!isOnline && !navigator.onLine) {
    alert('⚠️ 手機目前處於離線狀態，請檢查 Wi-Fi 或行動數據連線！');
    if (navigator.vibrate) navigator.vibrate([40, 80, 40]);
    return;
  }

  streamingStartedAt = Date.now();
  const streamRoleId = currentStreamRoleId();
  const activeStreamConvId = currentConversationId;
  const streamProvider = currentProvider;
  const streamAbortController = new AbortController();
  registerActiveRoleStream({
    roleId: streamRoleId,
    controller: streamAbortController,
    provider: streamProvider,
    conversationId: activeStreamConvId,
    source: 'local',
    startedAt: Date.now()
  });

  let streamConversationId = activeStreamConvId;
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
  const liveToolMap = new Map();
  let hadThinking = false;
  let isWritingPhase = false;
  let receivedContextStats = false;
  const startTs = performance.now();

  const assistantMsgDiv = document.createElement('div');
  assistantMsgDiv.className = 'w-full max-w-2xl mx-auto justify-start min-w-0';

  const bubbleClass = isBtwQuery
    ? 'btw-card bg-gradient-to-b from-slate-900 via-slate-900 to-teal-950/40 border border-teal-500/50 text-slate-200 rounded-2xl p-3 sm:p-3.5 text-xs sm:text-sm shadow-lg shadow-teal-950/30 w-full min-w-0 prose'
    : 'assistant-article bg-slate-900 text-slate-200 w-full min-w-0 prose';

  const statusInitText = isBtwQuery ? '正在處理補充問題…' : '正在理解你的需求…';

  assistantMsgDiv.innerHTML = `
    <div class="${bubbleClass}">
      
      <details class="live-status agent-execution-details live-execution-details select-none">
        <summary class="execution-summary">
          <span class="execution-summary-main min-w-0">
            <span class="activity-dot inline-block w-2 h-2 rounded-full ${isBtwQuery ? 'bg-teal-400' : 'bg-indigo-400'} animate-pulse shrink-0"></span>
            <span class="status-text truncate">${statusInitText}</span>
          </span>
          <span class="execution-summary-side">
            <span class="live-timer">0s</span>
            <span class="execution-chevron">›</span>
          </span>
        </summary>
        <div class="execution-detail-body">
          <div class="live-progress-list"></div>
        </div>
      </details>

      <div class="btw-content msg-content min-w-0"><span class="inline-block w-2 h-4 ${isBtwQuery ? 'bg-teal-400' : 'bg-indigo-400'} animate-pulse"></span></div>
      <div class="response-time mt-2 border-t border-slate-800 pt-1.5 text-right text-[10px] text-slate-500 font-mono select-none"></div>
    </div>
  `;
  messagesContainer.appendChild(assistantMsgDiv);
  const contentElem = assistantMsgDiv.querySelector('.msg-content');
  const liveStatusElem = assistantMsgDiv.querySelector('.live-status');
  const statusTextElem = assistantMsgDiv.querySelector('.status-text');
  const liveTimerElem = assistantMsgDiv.querySelector('.live-timer');
  const responseTimeElem = assistantMsgDiv.querySelector('.response-time');
  const liveProgressListElem = assistantMsgDiv.querySelector('.live-progress-list');
  const isStreamVisible = () => assistantMsgDiv.isConnected
    && currentStreamRoleId() === streamRoleId
    && currentProvider === streamProvider
    && (!streamConversationId ? currentConversationId === null : currentConversationId === streamConversationId);
  const stickyExecution = isBtwQuery ? null : createExecutionStickyController(assistantMsgDiv, isStreamVisible);

  let turnFinalized = false;
  function finalizeTurn(doneData = null) {
    if (turnFinalized) return;
    turnFinalized = true;

    if (renderTimer) {
      clearTimeout(renderTimer);
      renderTimer = null;
      renderPending = false;
    }

    clearInterval(liveTimerInterval);
    const incomplete = !doneData || Boolean(doneData.error || doneData.completionState === 'interrupted' || ['failed', 'error', 'interrupted', 'cancelled', 'canceled', 'aborted'].includes(String(doneData.turn_result?.status || '').toLowerCase()));
    if (!incomplete) {
      markProgressDone('phase:analysis');
      markProgressDone('phase:writing');
    }

    const activityElapsedSec = ((performance.now() - startTs) / 1000).toFixed(1);
    if (hadThinking && !progressEntries.has('phase:analysis')) {
  upsertProgress('phase:analysis', { icon: '🧠', text: '分析需求與執行方案', state: 'done' });
    }
    renderProgressTimeline();
    liveStatusElem.classList.add('is-complete');
    const activityDot = liveStatusElem.querySelector('.activity-dot');
    if (activityDot) activityDot.classList.remove('animate-pulse');
    if (statusTextElem) {
      statusTextElem.textContent = incomplete
        ? (doneData?.completionState === 'interrupted' ? '執行已中斷' : '執行未完成')
        : liveTools.length > 0
        ? `✓ 已完成 · ${liveTools.length} 項操作`
        : '✓ 已完成';
      if (liveTimerElem) liveTimerElem.textContent = `${activityElapsedSec}s`;
    }
    if (responseTimeElem) responseTimeElem.textContent = `🕒 回覆時間 ${formatMessageTimestamp()}`;
    if (!incomplete && liveTools.length === 0) {
      liveStatusElem.classList.add('execution-heartbeat-only');
      window.setTimeout(() => {
        if (!liveStatusElem?.isConnected) return;
        liveStatusElem.classList.add('execution-heartbeat-dismissed');
        window.setTimeout(() => {
          if (liveStatusElem?.isConnected) liveStatusElem.remove();
        }, 190);
      }, 450);
    }

    const targetDoneConvId = doneData?.conversation_id || streamConversationId;
    if (targetDoneConvId && isStreamVisible()) {
      currentConversationId = targetDoneConvId;
      localStorage.setItem(activeConversationStorageKey(), currentConversationId);
    }
    if (doneData?.error) {
      if (typeof isAuthErrorMessage === 'function' && isAuthErrorMessage(doneData.error) && typeof renderAuthRecoveryCard === 'function') {
        renderAuthRecoveryCard(contentElem, streamProvider, doneData.error, { text, imagePath: imgPath });
      } else {
        accumulatedText = `⚠️ ${doneData.error}`;
        contentElem.innerHTML = formatMessageContent(accumulatedText);
      }
    } else if (doneData?.response) {
      accumulatedText = doneData.response;
      contentElem.innerHTML = formatMessageContent(accumulatedText);
    } else if (!accumulatedText || !String(accumulatedText).trim()) {
      contentElem.innerHTML = incomplete ? '<p class="text-slate-400 text-xs">沒有可顯示的完整回覆。</p>' : buildEmptyTurnFallbackHtml();
    } else {
      contentElem.innerHTML = formatMessageContent(accumulatedText);
    }

    const structuredTurnResult = isStructuredExecutionResult(doneData?.turn_result)
      ? doneData.turn_result
      : null;
    const hasAuthRecovery = Boolean(doneData?.error && typeof isAuthErrorMessage === 'function' && isAuthErrorMessage(doneData.error));
    if (structuredTurnResult && !isBtwQuery && !hasAuthRecovery) {
      const article = assistantMsgDiv.querySelector('.assistant-article');
      if (article) {
        article.innerHTML = buildExecutionResultCardHtml(
          accumulatedText,
          liveTools,
          '',
          structuredTurnResult,
          { lazy: false }
        );
      }
      stickyExecution?.complete(
        structuredTurnResult.duration_ms ?? (Number(activityElapsedSec) * 1000),
        structuredTurnResult.status === 'failed'
      );
    } else {
      stickyExecution?.dispose();
    }

    // Codex streams fresh token usage during the turn. Only reload history
    // when a provider did not provide that event; the drawer itself refreshes
    // lazily when opened, so a closed sidebar does not trigger a filesystem
    // scan after every answer.
    if (targetDoneConvId && !receivedContextStats) {
      fetch(`/api/history?id=${targetDoneConvId}&provider=${encodeURIComponent(streamProvider)}`).then(r => r.json()).then(hData => {
        if (hData.context_stats && currentProvider === streamProvider && currentConversationId === targetDoneConvId) updateContextPill(hData.context_stats);
      }).catch(() => {});
    }
    if (targetDoneConvId) loadConversations();

    const totalSec = activityElapsedSec;
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
          <div class="flex items-center gap-2">
            <span class="text-[10px] text-slate-500 font-mono">🕒 ${formatMessageTimestamp()}</span>
            <button type="button" class="btw-toggle-btn text-[10px] text-teal-400 hover:text-teal-200 font-mono transition px-1.5 py-0.5 rounded hover:bg-teal-900/40">收合 ▲</button>
          </div>
        `;
        cardEl.insertBefore(btwHeader, cardEl.firstChild);
        const toggleBtn = btwHeader.querySelector('.btw-toggle-btn');
        toggleBtn.addEventListener('click', () => {
          const isCollapsed = cardEl.classList.toggle('collapsed');
          toggleBtn.textContent = isCollapsed ? '展開 ▼' : '收合 ▲';
        });
      }
    }

    if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(assistantMsgDiv);
    prepareDeferredImages(assistantMsgDiv);

    if (document.hidden) {
      triggerDoneNotification(accumulatedText);
    }

    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    // 🏷️ Set a local title for new conversations without another AI request.
    if (isNewConversation && targetDoneConvId && text) {
      applyInitialConversationTitle(targetDoneConvId, text, { updateHeader: isStreamVisible() });
    }
  }

  scrollToBottom();

  const progressEntries = new Map();
  const progressOrder = [];

  function renderProgressTimeline() {
    if (!liveProgressListElem) return;
    const entries = progressOrder
      .map(key => progressEntries.get(key))
      .filter(Boolean);

    liveProgressListElem.innerHTML = entries.map(entry => {
      const stateIcon = entry.state === 'done'
        ? '<span class="execution-step-state text-emerald-400">✓</span>'
        : entry.state === 'failed'
        ? '<span class="execution-step-state text-rose-400">!</span>'
        : '<span class="execution-step-running"></span>';
      const textClass = entry.state === 'failed' ? 'text-rose-300' : '';
      return `<div class="execution-step-row ${textClass}">
        ${stateIcon}
        <span class="execution-step-icon">${escapeHtml(entry.icon || '⚙️')}</span>
        <span class="execution-step-text">${escapeHtml(entry.text)}</span>
      </div>`;
    }).join('');
  }

  function upsertProgress(key, entry) {
    if (!progressEntries.has(key)) progressOrder.push(key);
    progressEntries.set(key, { ...(progressEntries.get(key) || {}), ...entry });
    renderProgressTimeline();
  }

  function markProgressDone(key) {
    const existing = progressEntries.get(key);
    if (!existing) return;
    progressEntries.set(key, { ...existing, state: 'done' });
    renderProgressTimeline();
  }



  upsertProgress('phase:analysis', {
    icon: '🧠',
    text: '分析需求與執行方案',
    state: 'running'
  });

  const liveTimerInterval = setInterval(() => {
    const elapsedMs = performance.now() - startTs;
    const elapsedSec = elapsedMs / 1000;
    if (liveTimerElem) liveTimerElem.textContent = `${Math.floor(elapsedSec)}s`;
    stickyExecution?.update(null, elapsedMs);
  }, 1000);

  let accumulatedText = '';
  let abortedHandled = false;
  let renderPending = false;
  let renderTimer = null;

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider: streamProvider,
        prompt: text,
        conversation_id: activeStreamConvId,
        image_path: imgPath,
        model: currentModel,
        effort: (typeof currentEffort !== 'undefined') ? currentEffort : 'low',
        workspace: (typeof currentWorkspace !== 'undefined') ? currentWorkspace : '/data/data/com.termux/files/home',
        role_id: typeof window.getCurrentRoleId === 'function' ? window.getCurrentRoleId() : 'role-general',
        role: 'general',

      }),
      signal: streamAbortController.signal
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
              streamConversationId = data.conversation_id;
              updateActiveRoleStream(streamRoleId, { conversationId: data.conversation_id });
              // 🛡️ Only update global currentConversationId if user hasn't switched to another conversation
              if (assistantMsgDiv.isConnected && currentProvider === streamProvider
                && currentConversationId === activeStreamConvId) {
                currentConversationId = data.conversation_id;
                localStorage.setItem(activeConversationStorageKey(), currentConversationId);
                if (data.role_id && typeof window.setConversationRoleDirect === 'function') {
                  window.setConversationRoleDirect(data.role_id, data.project_id, currentWorkspace);
                }
              }
              if (['SURGICAL_EDIT', 'DEBUG', 'BUILD'].includes(String(data.execution_mode || '').toUpperCase())) {
                stickyExecution?.enable(`執行${executionModeLabel(data.execution_mode)}`);
              }
            } else if (currentEvent === 'thought') {
              hadThinking = true;
              statusTextElem.textContent = '🧠 正在分析需求與下一步…';
              upsertProgress('phase:analysis', {
                icon: '🧠',
                text: '分析需求與可行方案',
                state: 'running'
              });
              if (userScrolledUp) {
                const scrollBadge = document.getElementById('scroll-bottom-badge');
                if (scrollBadge) scrollBadge.classList.remove('hidden');
              }
              if (isStreamVisible()) scrollToBottom();
            } else if (currentEvent === 'context') {
              receivedContextStats = true;
              if (isStreamVisible()) updateContextPill(data);
            } else if (currentEvent === 'tool') {
              isWritingPhase = false;
              const mergedTool = mergeToolEventIntoMap(liveToolMap, liveTools, data);
              const progressTool = mergedTool || data;
              const progress = getPassiveToolProgress(progressTool);
              const progressState = toolProgressState(progressTool);
              const progressKey = getToolGroupKey(progressTool, liveTools.length);
              markProgressDone('phase:analysis');

              upsertProgress(progressKey, {
                icon: progress.icon,
                text: progress.text,
                state: progressState
              });

              const activePrefix = progressState === 'running'
                ? '正在'
                : progressState === 'failed'
                ? '失敗：'
                : '已完成：';
              statusTextElem.textContent = progressState === 'running'
                ? `${progress.icon} ${activePrefix}${progress.text}…`
                : `${progress.icon} ${activePrefix}${progress.text}`;
              stickyExecution?.enable(progress.text);
              stickyExecution?.update(progress.text, performance.now() - startTs);
            } else if (currentEvent === 'chunk' && (data.accumulated !== undefined || data.delta !== undefined)) {
              if (!isWritingPhase) {
                isWritingPhase = true;
                markProgressDone('phase:analysis');
                upsertProgress('phase:writing', {
                  icon: '✍️',
                  text: '整理並輸出回覆',
                  state: 'running'
                });
                statusTextElem.textContent = '正在回覆…';
                stickyExecution?.update('整理並輸出回覆', performance.now() - startTs);
              }
              // New servers send only the delta to avoid repeatedly
              // serializing the full response. Keep accepting accumulated for
              // older cached pages or an external compatible server.
              accumulatedText = data.accumulated !== undefined
                ? data.accumulated
                : `${accumulatedText}${data.delta || ''}`;
              if (!renderPending) {
                renderPending = true;
                renderTimer = setTimeout(() => {
                  renderTimer = null;
                  contentElem.innerHTML = formatMessageContent(accumulatedText);
                  renderPending = false;
                  if (userScrolledUp) {
                    const scrollBadge = document.getElementById('scroll-bottom-badge');
                    if (scrollBadge) scrollBadge.classList.remove('hidden');
                  }
                  if (isStreamVisible()) scrollToBottom();
                }, 50);
              }

            } else if (currentEvent === 'done') {
              finalizeTurn(data);
            }
          } catch (e) {}
        }
      }
    }
    if (!turnFinalized) finalizeTurn({ completionState: 'interrupted' });
  } catch (err) {
    if (err.name === 'AbortError') {
      abortedHandled = true;
      stickyExecution?.dispose();
      finalizeTurn({ completionState: 'interrupted' });
      const abortBadge = document.createElement('div');
      abortBadge.className = 'mt-2 pt-1.5 border-t border-slate-800 text-[11px] text-amber-400 font-mono flex items-center gap-1';
      abortBadge.innerHTML = `<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg><span>[已手動中斷生成]</span>`;
      assistantMsgDiv.querySelector('.bg-slate-900').appendChild(abortBadge);
      if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(assistantMsgDiv);
    } else {
      // Graceful Disconnection Recovery
      stickyExecution?.dispose();
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

        if (streamConversationId) {
          let attempts = 0;
          const checkHistory = async () => {
            attempts++;
            try {
              const hRes = await fetch(`/api/history?id=${streamConversationId}&provider=${encodeURIComponent(streamProvider)}`);
              if (hRes.ok) {
                const hData = await hRes.json();
                if (hData.messages && hData.messages.length > 0) {
                  const lastAssistant = [...hData.messages].reverse().find(m => m.role === 'assistant');
                  if (lastAssistant && lastAssistant.content && lastAssistant.content.length >= accumulatedText.length) {
                    accumulatedText = lastAssistant.content;
                    contentElem.innerHTML = formatMessageContent(accumulatedText);
                    if (liveProgressListElem && ((lastAssistant.tools && lastAssistant.tools.length > 0) || lastAssistant.thinking)) {
                      liveProgressListElem.innerHTML = buildExecutionStepRowsHtml(
                        lastAssistant.tools || [],
                        Boolean(lastAssistant.thinking)
                      );
                    }
                    recoveryBadge.innerHTML = `
                      <span class="flex items-center gap-1.5 text-emerald-300">
                        <span class="text-emerald-400 font-bold">✓</span>
                        <span>已成功同步並補齊完整回覆</span>
                      </span>
                    `;
                    setTimeout(() => recoveryBadge.remove(), 4000);
                    if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(assistantMsgDiv);
                    finalizeTurn({ completionState: 'recovered' });
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
                <button type="button" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px]" onclick="loadConversationHistory('${streamConversationId}')">🔄 重整</button>
              `;
            }
          };
          setTimeout(checkHistory, 1200);
        }
      } else {
        if (typeof isAuthErrorMessage === 'function' && isAuthErrorMessage(err.message) && typeof renderAuthRecoveryCard === 'function') {
          renderAuthRecoveryCard(contentElem, streamProvider, err.message, { text, imagePath: imgPath });
        } else {
          contentElem.innerHTML = `
            <div class="p-2 rounded-lg bg-rose-950/40 border border-rose-800/60 text-xs text-rose-300 flex items-center justify-between">
              <span>連線中斷（${escapeHtml(err.message)}）</span>
              <button type="button" class="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px]" onclick="sendMessage()">重試</button>
            </div>
          `;
        }
      }

      if (typeof enhanceCodeBlocks === 'function') enhanceCodeBlocks(assistantMsgDiv);
    }
  } finally {
    clearInterval(liveTimerInterval);
    clearActiveRoleStream(streamRoleId, streamAbortController);
    if (isStreamVisible()) scrollToBottom();
    if (currentStreamRoleId() === streamRoleId) {
      setTimeout(flushQueuedBtwMessage, 0);
    }
  }
}

function handleSendClick(e) {
  if (e) {
    try {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    } catch (_) {}
  }

  // ⚡ /btw: Immediately launch concurrent sidecard without queueing or blocking!
  if (isBtwPrompt()) {
    sendBtwConcurrentSidecard();
    return;
  }

  if (isStreaming) {
    const rawText = getPromptText();
    const imgPath = uploadedImagePath;

    if (rawText || imgPath) {
      // 📥 User submitted input while streaming -> Queue this message!
      promptInput.value = '';
      promptInput.style.height = 'auto';
      uploadedImagePath = null;
      if (cameraInput) cameraInput.value = '';
      if (typeof attachInput !== 'undefined' && attachInput) attachInput.value = '';
      if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
      if (slashMenu) slashMenu.classList.add('hidden');
      if (typeof window.haptic === 'function') window.haptic([20, 20]);
      
      setPendingQueuedMessage({ text: rawText, imagePath: imgPath }).catch(error => {
        console.warn('[Role Queue] Enqueue failed:', error.message);
        if (typeof alert === 'function') alert(`排隊失敗：${error.message}`);
      });
      return;
    }

    // 🛑 No input text -> Stop / Interrupt active generation
    if (Date.now() - streamingStartedAt > 500) {
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

// 🏷️ Persist a deterministic initial title; never spend another AI turn on it.
function applyInitialConversationTitle(convId, userMessage, { updateHeader = true } = {}) {
  const title = shortenConversationTitle(userMessage, 22) || '新對話';
  if (updateHeader && headerTitle) headerTitle.textContent = title;
  renameConversationSilently(convId, title).catch((error) => {
    console.warn('[Conversation Title] Failed to persist:', error.message);
  });
}

// 🌐 Global Link Interceptor: Guarantee all links in messages open in new tab with security attributes
document.addEventListener('click', (e) => {
  const link = e.target.closest('#messages-container a[href]');
  if (link && link.href) {
    const hrefAttr = link.getAttribute('href') || '';
    if (!hrefAttr.startsWith('#') && !hrefAttr.startsWith('javascript:')) {
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
  }
});

// Window Exports for Context Usage, Modals & Queued Messages
window.showContextModal = showContextModal;
window.hideContextModal = hideContextModal;
window.updateContextPill = updateContextPill;
window.startLowContextContinuation = startLowContextContinuation;
window.getCachedConversations = () => cachedConversations;
window.setPendingQueuedMessage = setPendingQueuedMessage;
window.clearPendingQueuedMessage = clearPendingQueuedMessage;
window.getPendingQueuedMessage = getPendingQueuedMessageForRole;
window.getQueuedMessageCount = roleId => getQueuedMessagesForRole(roleId).length;

// ⏳ Queued Message Capsule Event Listeners
document.addEventListener('DOMContentLoaded', () => {
  hydrateRoleMessageQueue().then(() => {
    renderQueuedMessageCapsule();
    updateSendButtonMode();
    if (!getActiveRoleStream()) flushQueuedBtwMessage();
  }).catch(() => {});
  const queuedBody = document.getElementById('queued-msg-body');
  const queuedCancelBtn = document.getElementById('queued-msg-cancel-btn');
  const queuedInterruptBtn = document.getElementById('queued-msg-interrupt-btn');

  // Click Body -> Call message back to textarea for editing
  if (queuedBody) {
    queuedBody.addEventListener('click', async () => {
      const pendingQueuedMessage = currentConversationQueuedMessages()[0] || null;
      if (!pendingQueuedMessage) return;
      const text = pendingQueuedMessage.text || '';
      await removePendingQueuedMessage(pendingQueuedMessage).catch(() => null);
      if (promptInput) {
        promptInput.value = text;
        promptInput.focus();
        promptInput.style.height = 'auto';
        promptInput.style.height = Math.min(promptInput.scrollHeight, 120) + 'px';
        updateSendButtonMode();
      }
      if (typeof window.haptic === 'function') window.haptic('light');
    });
  }

  // Click Cancel -> Drop queued message
  if (queuedCancelBtn) {
    queuedCancelBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pendingQueuedMessage = currentConversationQueuedMessages()[0] || null;
      if (pendingQueuedMessage) await removePendingQueuedMessage(pendingQueuedMessage).catch(() => null);
      if (typeof window.haptic === 'function') window.haptic([15, 15]);
    });
  }

  // Click Interrupt & Send Now -> Stop current stream immediately and send queued message
  if (queuedInterruptBtn) {
    queuedInterruptBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const pendingQueuedMessage = currentConversationQueuedMessages()[0] || null;
      if (!pendingQueuedMessage) return;
      const msgToSend = pendingQueuedMessage;
      await removePendingQueuedMessage(pendingQueuedMessage).catch(() => null);
      if (typeof window.haptic === 'function') window.haptic('heavy');
      await stopGeneration();
      setTimeout(() => {
        sendMessage(msgToSend);
      }, 200);
    });
  }
});
