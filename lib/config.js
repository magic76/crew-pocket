const path = require('node:path');
const fs = require('node:fs');

const PORT = process.env.PORT || 8000;
const HOST = '127.0.0.1';
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const LEGACY_UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const PREVIOUS_UPLOADS_DIR = '/storage/emulated/0/Download/crew-pocket';
// Keep user-created photos and Live call snapshots in Android Pictures
// collection so they remain easy to inspect, share, and back up outside Termux.
const UPLOADS_DIR = '/storage/emulated/0/Pictures/crew-pocket';
const BRAIN_DIR = '/data/data/com.termux/files/home/.gemini/antigravity-cli/brain';
const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 mins idle sleep

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.ico': 'image/x-icon'
};

const AVAILABLE_MODELS = [
  { id: 'gemini-3.7-flash', provider: 'antigravity', name: 'Gemini 3.7 Flash', desc: '極速混合推理 · 預設推薦', icon: '✨', badge: '推薦', badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' },
  { id: 'claude-sonnet-4-6', provider: 'antigravity', name: 'Claude Sonnet 4.6', desc: '深度思考 · 代碼與架構大師', icon: '🟣', badge: 'Thinking', badgeColor: 'bg-purple-500/20 text-purple-300 border-purple-500/40' },
  { id: 'claude-opus-4-6-thinking', provider: 'antigravity', name: 'Claude Opus 4.6', desc: '最強旗艦 · 複雜邏輯思維', icon: '👑', badge: '旗艦', badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { id: 'gemini-3.1-pro', provider: 'antigravity', name: 'Gemini 3.1 Pro', desc: '深度多模態推理', icon: '🔵', badge: 'Pro', badgeColor: 'bg-sky-500/20 text-sky-300 border-sky-500/40' },
  { id: 'gpt-oss-120b-medium', provider: 'antigravity', name: 'GPT-OSS 120B', desc: '千億級開源大模型', icon: '🟢', badge: '開源', badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  { id: 'gpt-5.6-terra', provider: 'codex', name: 'GPT-5.6-Terra', desc: '能力與速度平衡 · 日常開發推薦', icon: '🌍', badge: '預設', badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
  { id: 'gpt-5.6-luna', provider: 'codex', name: 'GPT-5.6-Luna', desc: '快速省資源 · 高頻輕量工作', icon: '🌙', badge: 'Luna', badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { id: 'gpt-5.5', provider: 'codex', name: 'GPT-5.5', desc: 'OpenAI Codex 模型', icon: '🧩', badge: 'Codex', badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
  { id: 'gpt-5.4-mini', provider: 'codex', name: 'GPT-5.4-Mini', desc: 'OpenAI Codex 模型', icon: '🧩', badge: 'Codex', badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', defaultReasoningEffort: 'medium', supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] }
];

const THINKING_EFFORTS = [
  { id: 'low', name: 'Low (極速)', desc: '⚡ 0~1s 秒回 · 適合日常問答與對話', icon: '⚡', badgeColor: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' },
  { id: 'medium', name: 'Medium (平衡)', desc: '⚖️ 基礎推理 · 平衡速度與深度', icon: '⚖️', badgeColor: 'bg-amber-500/20 text-amber-300 border-amber-500/40' },
  { id: 'high', name: 'High (深度)', desc: '🧠 深度邏輯 · 複雜架構與大型 Code', icon: '🧠', badgeColor: 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40' }
];

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let done = false;

    const onData = chunk => {
      if (done) return;
      body += chunk.toString();
      if (body.length > 50 * 1024 * 1024) {
        done = true;
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
        req.destroy();
        reject(new Error('Payload too large'));
      }
    };

    const onEnd = () => {
      if (done) return;
      done = true;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    };

    const onError = (err) => {
      if (done) return;
      done = true;
      reject(err);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

function cleanUserContent(raw) {
  if (!raw) return '';
  const match = raw.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  let text = match ? match[1] : raw;
  return text
    .replace(/\[Context:[\s\S]*?(?:\](?:\n\n|\n|$)|\[User Request\]:?\n*|$)/gi, '')
    .replace(/\[System Environment:[\s\S]*?(?:\[User Request\]:?\n*|$)/gi, '')
    .replace(/\[User Request\]:?\n*/gi, '')
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, '')
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/g, '')
    .trim();
}

module.exports = {
  PORT,
  HOST,
  ROOT_DIR,
  PUBLIC_DIR,
  LEGACY_UPLOADS_DIR,
  PREVIOUS_UPLOADS_DIR,
  UPLOADS_DIR,
  BRAIN_DIR,
  IDLE_TIMEOUT_MS,
  MIME_TYPES,
  AVAILABLE_MODELS,
  THINKING_EFFORTS,
  parseJsonBody,
  cleanUserContent
};
