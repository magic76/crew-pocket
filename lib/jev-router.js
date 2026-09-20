const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const ROUTE_OPTIONS = Object.freeze({
  CHAT: 'Conversation or explanation only. No repository inspection, code edits, build, or debugging work is requested.',
  INSPECT: 'Read, review, analyze, or check existing code/state without modifying files.',
  SURGICAL_EDIT: 'A small, localized implementation or UI/config edit that should stay narrow and avoid unrelated work.',
  DEBUG: 'A bug, error, regression, or failure where root-cause investigation may be needed before making a focused fix.',
  BUILD: 'Build, release, install, migration, dependency changes, broad refactor, multi-module work, or full verification.'
});

const VALID_MODES = new Set(Object.keys(ROUTE_OPTIONS));
const DEFAULT_TIMEOUT_MS = 2500;
const MAX_STATE_CHARS = 6000;

function normalizeMode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return VALID_MODES.has(normalized) ? normalized : null;
}

function numberOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractChoice(parsed) {
  if (!parsed || typeof parsed !== 'object') return { mode: null, confidence: null };

  const answers = parsed.answers && typeof parsed.answers === 'object'
    ? parsed.answers
    : parsed;
  const candidate = answers.execution_mode ?? answers.mode ?? answers.route ?? answers.task_mode;

  if (typeof candidate === 'string') {
    const confidence = numberOrNull(
      answers.confidence?.execution_mode ??
      answers.confidence?.mode ??
      parsed.confidence?.execution_mode ??
      parsed.confidence?.mode
    );
    return { mode: normalizeMode(candidate), confidence };
  }

  if (candidate && typeof candidate === 'object') {
    const choice = candidate.choice ?? candidate.value ?? candidate.answer ?? candidate.label;
    const confidence = numberOrNull(
      candidate.confidence ??
      answers.confidence?.execution_mode ??
      answers.confidence?.mode ??
      parsed.confidence?.execution_mode ??
      parsed.confidence?.mode
    );
    return { mode: normalizeMode(choice), confidence };
  }

  const directChoice = parsed.choice ?? parsed.value ?? parsed.answer;
  return {
    mode: normalizeMode(directChoice),
    confidence: numberOrNull(parsed.confidence)
  };
}

function acceptanceThreshold(mode) {
  if (mode === 'CHAT' || mode === 'INSPECT') return 0.75;
  if (mode === 'DEBUG' || mode === 'BUILD') return 0.60;
  return 0.45;
}

function looksLikeContinuation(prompt) {
  const text = String(prompt || '').trim().toLowerCase();
  if (!text) return false;
  if (text.length > 24) return false;
  return /^(好|好啊|可以|做吧|繼續|继续|再來|再来|開始|开始|go|go ahead|ok|okay|continue|proceed|merge|合併|合并)[!！。.]?$/.test(text);
}

function shouldRouteWithJev({ provider, model, explicitExecutionMode, prompt }) {
  if (provider !== 'codex') return false;
  if (model !== 'gpt-5.6-luna') return false;
  if (explicitExecutionMode) return false;
  if (!String(prompt || '').trim()) return false;
  return !looksLikeContinuation(prompt);
}

async function getJevCliStatus({ timeoutMs = 1200 } = {}) {
  try {
    const { stdout } = await execFileAsync('jev', ['--version'], {
      timeout: timeoutMs,
      maxBuffer: 64 * 1024,
      env: process.env
    });
    return {
      available: true,
      version: String(stdout || '').trim().slice(0, 120) || 'jev'
    };
  } catch (error) {
    return {
      available: false,
      version: null,
      error: error.code === 'ENOENT' ? 'jev CLI not found' : String(error.message || error).slice(0, 240)
    };
  }
}

async function routeTaskWithJev(prompt, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  const state = String(prompt || '').trim().slice(0, MAX_STATE_CHARS);
  if (!state) {
    return { mode: null, accepted: false, source: 'jev', reason: 'empty_prompt', latencyMs: 0 };
  }

  const questions = JSON.stringify({
    execution_mode: {
      type: 'choice',
      instructions: 'Which execution mode best matches the user request? Choose the narrowest mode that can complete exactly the requested work.',
      criteria: ROUTE_OPTIONS
    }
  });

  try {
    const { stdout, stderr } = await execFileAsync(
      'jev',
      ['ask', state, '--questions', questions, '--format', 'json'],
      {
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
        env: process.env
      }
    );

    const raw = String(stdout || '').trim();
    const parsed = JSON.parse(raw);
    const { mode, confidence } = extractChoice(parsed);
    if (!mode) {
      return {
        mode: null,
        accepted: false,
        source: 'jev',
        reason: 'invalid_choice',
        confidence,
        latencyMs: Date.now() - startedAt,
        stderr: String(stderr || '').trim().slice(-500)
      };
    }

    const threshold = acceptanceThreshold(mode);
    const accepted = confidence == null ? true : confidence >= threshold;
    return {
      mode: accepted ? mode : null,
      suggestedMode: mode,
      accepted,
      source: 'jev',
      confidence,
      threshold,
      model: parsed.model || parsed.meta?.model || null,
      latencyMs: Date.now() - startedAt,
      reason: accepted ? 'accepted' : 'low_confidence'
    };
  } catch (error) {
    return {
      mode: null,
      accepted: false,
      source: 'jev',
      reason: error.code === 'ENOENT'
        ? 'cli_missing'
        : (error.killed || error.signal ? 'timeout' : 'error'),
      latencyMs: Date.now() - startedAt,
      error: String(error.stderr || error.message || error).trim().slice(-800)
    };
  }
}

module.exports = {
  ROUTE_OPTIONS,
  acceptanceThreshold,
  extractChoice,
  getJevCliStatus,
  looksLikeContinuation,
  normalizeMode,
  routeTaskWithJev,
  shouldRouteWithJev
};
