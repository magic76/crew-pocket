const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { BRAIN_DIR, parseJsonBody, cleanUserContent } = require('./config');
const { sessionManager } = require('./session');

// Generate high-density memory compaction summary using one-shot agy
function generateCompactedSummary(conversationText, userFocus) {
  return new Promise((resolve, reject) => {
    const focusInstruction = userFocus ? `\n特別關注焦點: ${userFocus}` : '';
    const systemPrompt = `你是一個專業的對話記憶精簡壓縮器（Memory Compactor）。
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
${focusInstruction}

請使用繁體中文輸出，格式清晰精煉，保留所有重要的技術變數、關鍵字與邏輯，使後續 AI 接續對話時能無損繼承 100% 的脈絡！只輸出 Markdown 摘要，不要有多餘客套話。`;

    const promptText = `${systemPrompt}\n\n=== 對話歷史紀錄開始 ===\n${conversationText.slice(0, 15000)}\n=== 對話歷史紀錄結束 ===\n\n請輸出高密度結構化精簡摘要：`;

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
      output += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      errorOutput += chunk.toString();
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

    if (!conversation_id || !/^[a-zA-Z0-9_\-]+$/.test(conversation_id)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Invalid conversation_id' }));
    }

    const logDir = path.join(BRAIN_DIR, conversation_id, '.system_generated', 'logs');
    const logPath = path.join(logDir, 'transcript.jsonl');
    const logFullPath = path.join(logDir, 'transcript_full.jsonl');

    if (!fs.existsSync(logPath)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '尚無足夠的對話紀錄可供壓縮' }));
    }

    const logContent = await fsPromises.readFile(logPath, 'utf-8');
    const lines = logContent.trim().split('\n');
    const historySegments = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const item = JSON.parse(line);
        if (item.type === 'USER_INPUT' && item.content) {
          const userTxt = cleanUserContent(item.content);
          if (userTxt) historySegments.push(`User: ${userTxt}`);
        } else if (item.type === 'PLANNER_RESPONSE' && item.content) {
          historySegments.push(`Assistant: ${item.content}`);
        }
      } catch (e) {}
    }

    if (historySegments.length < 2) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '對話記錄過短（需至少 1 輪完整問答），無需壓縮' }));
    }

    const fullHistoryText = historySegments.join('\n\n');
    console.log(`[Compact] Generating compaction summary for conversation ${conversation_id} (${historySegments.length} segments)...`);

    const summary = await generateCompactedSummary(fullHistoryText, focus);

    // Save summary checkpoint
    const compactCachePath = path.join(BRAIN_DIR, conversation_id, '.compacted_summary.json');
    await fsPromises.writeFile(compactCachePath, JSON.stringify({
      summary,
      compacted_at: new Date().toISOString(),
      original_turns: historySegments.length
    }, null, 2));

    // Truncate and replace transcript with clean consolidated memory
    const nowIso = new Date().toISOString();
    const compactedTranscriptLines = [
      JSON.stringify({
        step_index: 0,
        source: "SYSTEM",
        type: "CHECKPOINT",
        status: "DONE",
        created_at: nowIso,
        content: `{{ CHECKPOINT 0 }}\n**The prior conversation has been compacted via /compact.**\n\n# Compacted Conversation Context\n\n${summary}`
      }),
      JSON.stringify({
        step_index: 1,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: nowIso,
        content: `<USER_REQUEST>/compact${focus ? ' ' + focus : ''}</USER_REQUEST>`
      }),
      JSON.stringify({
        step_index: 2,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: nowIso,
        content: `📦 **對話記憶已成功精簡壓縮！**\n\n${summary}`
      })
    ];

    await fsPromises.writeFile(logPath, compactedTranscriptLines.join('\n') + '\n');
    if (fs.existsSync(logFullPath)) {
      await fsPromises.writeFile(logFullPath, compactedTranscriptLines.join('\n') + '\n');
    }

    // Close resident session so it reloads the compacted transcript next turn
    sessionManager.closeSession(conversation_id);

    console.log(`[Compact] Successfully compacted conversation ${conversation_id}!`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      success: true,
      conversation_id,
      summary,
      message: '對話記憶已成功精簡壓縮！'
    }));

  } catch (err) {
    console.error('[Compact Error]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message || '壓縮對話記憶失敗' }));
  }
}

module.exports = {
  handleCompact,
  generateCompactedSummary
};
