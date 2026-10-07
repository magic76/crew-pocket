const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { BRAIN_DIR, parseJsonBody, cleanUserContent } = require('./config');
const { sessionManager } = require('./session');
const { CONTEXT_COMPACTION_CONFIG } = require('./context/compaction');

function parseJsonlRecords(content, label) {
  const records = [];
  for (const line of content.split('\n')) {
    if (!line.trim()) continue;
    try {
      const item = JSON.parse(line);
      records.push({ item, line });
    } catch (err) {
      // A malformed AGY record must never prevent compaction; it is already
      // ignored by the history reader, so exclude it from the durable archive too.
      console.warn(`[Compact] Ignoring malformed JSONL record in ${label}`);
    }
  }
  return records;
}

function transcriptRecordKey(item) {
  // Keep deliberate repeated user messages distinct while making a session
  // restart/replay of the same JSONL record idempotent.
  return JSON.stringify([
    item.step_index,
    item.source,
    item.type,
    item.status,
    item.created_at,
    item.content,
    item.thinking,
    item.tool_calls
  ]);
}

async function archiveActiveTranscript(activeContent, logFullPath) {
  const activeRecords = parseJsonlRecords(activeContent, 'transcript.jsonl');
  const fullContent = fs.existsSync(logFullPath)
    ? await fsPromises.readFile(logFullPath, 'utf-8')
    : '';
  const fullRecords = parseJsonlRecords(fullContent, 'transcript_full.jsonl');
  const known = new Set(fullRecords.map(({ item }) => transcriptRecordKey(item)));
  const additions = activeRecords.filter(({ item }) => {
    const key = transcriptRecordKey(item);
    if (known.has(key)) return false;
    known.add(key);
    return true;
  });

  if (!fs.existsSync(logFullPath) || additions.length > 0) {
    const merged = [...fullRecords.map(({ line }) => line), ...additions.map(({ line }) => line)].join('\n');
    const tempPath = `${logFullPath}.tmp-${process.pid}-${Date.now()}`;
    await fsPromises.writeFile(tempPath, merged + (merged ? '\n' : ''), 'utf-8');
    await fsPromises.rename(tempPath, logFullPath);
  }

  return { activeRecords: activeRecords.length, archivedRecords: additions.length };
}

function buildCompactionSource(historySegments, maxChars = 24000) {
  const fullText = historySegments.join('\n\n');
  if (fullText.length <= maxChars) return fullText;

  // Keep the old checkpoint at the beginning and the active work at the end.
  // The former implementation kept only the first 15k characters, which could
  // discard the task currently in progress after a long conversation.
  const headChars = Math.min(6000, Math.floor(maxChars * 0.28));
  const tailChars = maxChars - headChars;
  return `${fullText.slice(0, headChars)}\n\n[... routine earlier detail omitted; latest active work follows ...]\n\n${fullText.slice(-tailChars)}`;
}

// Generate high-density memory compaction summary using one-shot agy.
function generateCompactedSummary(conversationText, userFocus, locale = 'zh-TW', mode = 'continue') {
  return new Promise((resolve, reject) => {
    const isEnglish = locale === 'en';
    const isMaxMode = mode === 'max';
    const focusInstruction = userFocus ? (isEnglish ? `\nSpecial focus: ${userFocus}` : `\n特別關注焦點: ${userFocus}`) : '';
    const modeInstruction = isMaxMode
      ? (isEnglish
        ? `\n\nCOMPLETION MODE: Keep only the final outcome, unfinished verification or next action, and exact non-negotiable paths, IDs, settings, constraints, or unresolved errors. Omit chronology, exploration, superseded choices, and routine detail. Target 120–300 English words. Never invent missing facts.`
        : `\n\n【極致結案模式】只保留最終成果、尚待驗證或下一步，以及不可遺失的路徑、ID、設定、限制與未解錯誤。刪除時序、探索、淘汰選項與例行細節；目標 350–900 個中文字，禁止猜測未提供的資訊。`)
      : (isEnglish
        ? `\n\nCONTINUATION MODE: You MUST preserve the active objective, latest task state, completed work, exact next action, user corrections/preferences, and all still-relevant paths, IDs, commands, model/API/config values, numbers, constraints, and errors. Prioritize the latest active work over obsolete history. Never invent missing facts.`
        : `\n\n【接續工作模式】必須保留：當前目標、最新任務狀態、已完成事項、明確下一步、使用者更正與偏好，以及仍相關的路徑、ID、指令、模型／API／設定值、數字、限制與錯誤。優先保留最新活躍工作，禁止猜測未提供的資訊。`);
    const systemPrompt = isEnglish ? `You are a professional conversation memory compactor.
Analyze the conversation history below and produce a dense, structured Markdown summary.

The summary must include:
### 🎯 Core Objectives & Decisions
- The user's original intent, agreed names, architecture, and technical choices.

### 🛠️ Completed Work & Implementation Progress
- All implemented, changed, or fixed functionality.

### 📁 Key Files & Changed Paths
- Relevant absolute project paths and their roles.

### 📌 Current State & Continuation Context
- Current system state, resolved issues, and the next actionable steps.
${focusInstruction}${modeInstruction}

Write in clear, concise English. Preserve all important technical variables, keywords, and logic so a future AI turn can continue without losing context. Output only the Markdown summary.` : `你是一個專業的對話記憶精簡壓縮器（Memory Compactor）。
請分析以下對話歷史紀錄，提取關鍵資訊並提煉成一份高密度的 Markdown 精簡結構摘要。

摘要結構必須嚴格包含：
### 🎯 核心目標與重要決策 (User Objectives & Decisions)
- 列出用戶的原始意圖、已定案的命名、架構與技術選型。

### 🛠️ 已完成功能與實作進度 (Completed Work)
- 條列所有已撰寫、修改或修復的功能細節。

### 📁 關鍵檔案與變更路徑 (Key Files & Paths)
- 列出相關的專案檔案絕對路徑與核心作用。

### 📌 當前狀態與後續脈絡 (Current State & Context)
- 總結系統目前處於什麼狀態、已解決的問題以及隨時可接續的下一步。
${focusInstruction}${modeInstruction}

請使用繁體中文輸出，格式清晰精煉，保留所有重要的技術變數、關鍵字與邏輯，使後續 AI 接續對話時能無損繼承 100% 的脈絡！只輸出 Markdown 摘要，不要有多餘客套話。`;

    const promptText = isEnglish
      ? `${systemPrompt}\n\n=== Conversation History Start ===\n${conversationText}\n=== Conversation History End ===\n\nOutput the structured compact summary:`
      : `${systemPrompt}\n\n=== 對話歷史紀錄開始 ===\n${conversationText}\n=== 對話歷史紀錄結束 ===\n\n請輸出高密度結構化精簡摘要：`;

    const args = [
      '--prompt', promptText,
      '--model', 'gemini-3.7-flash',
      '--effort', 'low',
      '--dangerously-skip-permissions'
    ];

    const child = spawn('agy', args, {
      cwd: '/data/data/com.termux/files/home',
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    const { StringDecoder } = require('node:string_decoder');
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    let output = '';
    let errorOutput = '';
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { child.kill('SIGKILL'); } catch (e) {}
        reject(new Error('Compaction generation timed out'));
      }
    }, 35000);

    child.stdout.on('data', (chunk) => {
      output += typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk);
    });

    child.stderr.on('data', (chunk) => {
      errorOutput += typeof chunk === 'string' ? chunk : stderrDecoder.write(chunk);
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;

      let summary = output.trim();

      // Check if output is stream-json format
      if (summary.startsWith('{') && summary.includes('"result"')) {
        let jsonSummary = '';
        const lines = summary.split('\n');
        for (const line of lines) {
          try {
            const item = JSON.parse(line);
            if (item.result && item.result.response) {
              jsonSummary = item.result.response;
            } else if (item.event === 'step_update' && item.step_update && item.step_update.text_delta) {
              jsonSummary += item.step_update.text_delta;
            }
          } catch (e) {}
        }
        if (jsonSummary) summary = jsonSummary;
      }

      summary = summary.trim();
      if (summary.length > 20) {
        resolve(summary);
      } else {
        console.warn('[Compact] Output too short. stdout:', output, 'stderr:', errorOutput);
        reject(new Error(errorOutput || '無法生成精簡摘要，請稍後重試'));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.stdin.end();
  });
}

// POST /api/compact
async function handleCompact(req, res) {
  try {
    const body = await parseJsonBody(req);
    const { conversation_id, focus } = body;
    const mode = body.mode === 'max' ? 'max' : 'continue';
    const isEnglish = body.locale === 'en';

    if (!conversation_id || !/^[a-zA-Z0-9_\-]+$/.test(conversation_id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid conversation_id' }));
    }

    const logDir = path.join(BRAIN_DIR, conversation_id, '.system_generated', 'logs');
    const logPath = path.join(logDir, 'transcript.jsonl');
    const logFullPath = path.join(logDir, 'transcript_full.jsonl');

    if (!fs.existsSync(logPath)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: isEnglish ? 'There is not enough conversation history to compact yet.' : '尚無足夠的對話紀錄可供壓縮' }));
    }

    const logContent = await fsPromises.readFile(logPath, 'utf-8');
    const lines = logContent.trim().split('\n');
    const historySegments = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.type === 'USER_INPUT' && item.content) {
          const userTxt = cleanUserContent(item.content);
          if (userTxt && !/^\/compact(?:-max)?\b/i.test(userTxt)) {
            historySegments.push({ text: `User: ${userTxt}`, line, index });
          }
        } else if (item.type === 'PLANNER_RESPONSE' && item.content) {
          if (!/^📦 \*\*對話記憶已(?:成功|極致)精簡壓縮！/.test(item.content)) {
            historySegments.push({ text: `Assistant: ${item.content}`, line, index });
          }
        }
      } catch (_) {}
    }

    if (historySegments.length < 4) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: isEnglish ? 'Conversation is too short to compact safely.' : '對話還太短，暫時不需要精簡' }));
    }

    const configuredTail = CONTEXT_COMPACTION_CONFIG.recentTailMessages;
    const recentTailCount = Math.min(configuredTail, Math.max(2, historySegments.length - 2));
    const coveredSegments = historySegments.slice(0, historySegments.length - recentTailCount);
    const recentSegments = historySegments.slice(historySegments.length - recentTailCount);

    if (coveredSegments.length < 2) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: isEnglish ? 'Not enough older history to compact while preserving the recent tail.' : '較舊歷史不足；為保留最近工作內容，本次不執行精簡' }));
    }

    const archiveResult = await archiveActiveTranscript(logContent, logFullPath);
    console.log(`[Compact] Archived ${archiveResult.archivedRecords} new record(s) from ${archiveResult.activeRecords} active record(s).`);

    const compactSource = buildCompactionSource(coveredSegments.map(segment => segment.text));
    console.log(`[Compact] Generating ${mode} checkpoint for conversation ${conversation_id} (${coveredSegments.length} covered messages, ${recentSegments.length} recent messages kept).`);

    const summary = await generateCompactedSummary(compactSource, focus, isEnglish ? 'en' : 'zh-TW', mode);
    const coveredMessageIds = coveredSegments.map(segment => `transcript:${segment.index}`);
    const estimatedOriginalTokens = Math.max(1, Math.round(compactSource.length / 2.2));
    const estimatedSummaryTokens = Math.max(1, Math.round(summary.length / 2.2));
    const createdAt = new Date().toISOString();

    const checkpoint = {
      id: `checkpoint_${Date.now().toString(36)}`,
      conversationId: conversation_id,
      summary,
      coveredMessageIds,
      createdAt,
      estimatedOriginalTokens,
      estimatedSummaryTokens
    };

    const compactCachePath = path.join(BRAIN_DIR, conversation_id, '.compacted_summary.json');
    await fsPromises.writeFile(compactCachePath, JSON.stringify({
      ...checkpoint,
      mode,
      recentTailMessages: recentSegments.length
    }, null, 2));

    const lastStepIndex = lines.length;
    const checkpointStep = JSON.stringify({
      step_index: lastStepIndex,
      source: 'SYSTEM',
      type: 'CHECKPOINT',
      status: 'DONE',
      created_at: createdAt,
      content: `{{ CHECKPOINT ${lastStepIndex} }}\n**The prior conversation has been compacted via ${mode === 'max' ? '/compact-max' : '/compact'}.**\n\n# Compacted Conversation Context\n\n${summary}`
    });
    const userCompactStep = JSON.stringify({
      step_index: lastStepIndex + 1,
      source: 'USER_EXPLICIT',
      type: 'USER_INPUT',
      status: 'DONE',
      created_at: createdAt,
      content: `<USER_REQUEST>${mode === 'max' ? '/compact-max' : '/compact'}${focus ? ' ' + focus : ''}</USER_REQUEST>`
    });
    const modelCompactStep = JSON.stringify({
      step_index: lastStepIndex + 2,
      source: 'MODEL',
      type: 'PLANNER_RESPONSE',
      status: 'DONE',
      created_at: createdAt,
      content: isEnglish
        ? '📦 **Conversation context compacted successfully. Recent work is still available verbatim.**'
        : '📦 **對話 Context 已安全精簡，最近工作內容仍以原文保留。**'
    });

    await fsPromises.appendFile(logFullPath, `\n${checkpointStep}\n${userCompactStep}\n${modelCompactStep}\n`);

    const recentRawLines = recentSegments.map(segment => segment.line);
    const cleanSnapshot = [
      checkpointStep,
      ...recentRawLines,
      userCompactStep,
      modelCompactStep
    ].join('\n') + '\n';
    await fsPromises.writeFile(logPath, cleanSnapshot, 'utf-8');

    sessionManager.closeSession(conversation_id);
    console.log(`[Compact] Successfully compacted conversation ${conversation_id}; kept ${recentSegments.length} recent message records.`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      conversation_id,
      summary,
      checkpoint,
      recent_tail_messages: recentSegments.length,
      message: isEnglish
        ? 'Conversation context compacted safely.'
        : '對話 Context 已安全精簡。'
    }));
  } catch (err) {
    console.error('[Compact Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || 'Failed to compact conversation context' }));
  }
}

module.exports = {
  handleCompact,
  generateCompactedSummary,
  buildCompactionSource,
  archiveActiveTranscript
};
