const { spawn } = require('node:child_process');
const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { BRAIN_DIR, parseJsonBody } = require('./config');

const TITLE_FILENAME = '.auto_title.json';

// Read cached title for a conversation
function getCachedTitle(convId) {
  try {
    const titlePath = path.join(BRAIN_DIR, convId, TITLE_FILENAME);
    if (fs.existsSync(titlePath)) {
      const data = JSON.parse(fs.readFileSync(titlePath, 'utf-8'));
      return data.title || null;
    }
  } catch (e) {}
  return null;
}

// Save title for a conversation
async function saveTitleCache(convId, title) {
  try {
    const dir = path.join(BRAIN_DIR, convId);
    if (!fs.existsSync(dir)) return;
    const titlePath = path.join(dir, TITLE_FILENAME);
    await fsPromises.writeFile(titlePath, JSON.stringify({ title, generated_at: new Date().toISOString() }));
  } catch (e) {
    console.warn('[Title] Failed to save title cache:', e.message);
  }
}

// Generate title using a lightweight one-shot agy call
function generateTitleWithAI(userMessage, assistantResponse) {
  return new Promise((resolve, reject) => {
    const context = `User: ${userMessage.slice(0, 200)}\nAssistant: ${(assistantResponse || '').slice(0, 300)}`;
    const systemPrompt = '你是一個對話標題生成器。根據以下對話內容，用繁體中文生成一個精簡的對話標題（5-10個字，不要加引號或符號）。只輸出標題文字，不要輸出任何其他內容。';

    const args = [
      '--prompt', `${systemPrompt}\n\n${context}\n\n標題：`,
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
        reject(new Error('Title generation timed out'));
      }
    }, 12000);

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

      // Try to extract title from output (may be stream-json or plain text)
      let title = '';

      // Try parsing as stream-json lines first
      const lines = output.trim().split('\n');
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          if (item.result && item.result.response) {
            title = item.result.response;
          } else if (item.event === 'step_update' && item.step_update && item.step_update.text_delta) {
            title += item.step_update.text_delta;
          }
        } catch (e) {
          // Not JSON, treat as plain text
          if (line.trim() && !title) {
            title = line.trim();
          }
        }
      }

      // Clean up the title
      title = title
        .replace(/^["'「」『』【】\s]+/, '')
        .replace(/["'「」『』【】\s]+$/, '')
        .replace(/^標題[：:]\s*/, '')
        .replace(/\n/g, ' ')
        .trim();

      if (title && title.length > 0 && title.length <= 30) {
        resolve(title);
      } else if (title && title.length > 30) {
        resolve(title.slice(0, 25) + '...');
      } else {
        reject(new Error('Empty title generated'));
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    // Close stdin immediately for one-shot mode
    child.stdin.end();
  });
}

// POST /api/generate-title
async function handleGenerateTitle(req, res) {
  try {
    const body = await parseJsonBody(req);
    const { conversation_id, user_message, assistant_response } = body;

    if (!conversation_id || !user_message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'conversation_id and user_message are required' }));
    }

    // Check for cached title first
    const cached = getCachedTitle(conversation_id);
    if (cached) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ success: true, title: cached, cached: true }));
    }

    // Generate with AI
    const title = await generateTitleWithAI(user_message, assistant_response || '');
    await saveTitleCache(conversation_id, title);

    console.log(`[Title] Generated title for ${conversation_id}: "${title}"`);

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: true, title, cached: false }));

  } catch (err) {
    console.warn('[Title] Generation failed:', err.message);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, title: null, error: err.message }));
  }
}

module.exports = {
  handleGenerateTitle,
  getCachedTitle
};
