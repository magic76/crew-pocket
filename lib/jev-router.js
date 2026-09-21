const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const auth = require('./auth');

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

function extractNamedChoice(parsed, keys = []) {
  if (!parsed || typeof parsed !== 'object') return { choice: null, confidence: null };

  const answers = parsed.answers && typeof parsed.answers === 'object'
    ? parsed.answers
    : parsed;
  let candidate = null;
  for (const key of keys) {
    if (answers[key] !== undefined) {
      candidate = answers[key];
      break;
    }
  }

  const confidenceKeys = keys.flatMap(key => [
    answers.confidence?.[key],
    parsed.confidence?.[key]
  ]);

  if (typeof candidate === 'string') {
    return {
      choice: candidate.trim(),
      confidence: numberOrNull(confidenceKeys.find(value => value !== undefined))
    };
  }

  if (candidate && typeof candidate === 'object') {
    const choice = candidate.choice ?? candidate.value ?? candidate.answer ?? candidate.label;
    return {
      choice: typeof choice === 'string' ? choice.trim() : null,
      confidence: numberOrNull(
        candidate.confidence ??
        confidenceKeys.find(value => value !== undefined)
      )
    };
  }

  const directChoice = parsed.choice ?? parsed.value ?? parsed.answer;
  return {
    choice: typeof directChoice === 'string' ? directChoice.trim() : null,
    confidence: numberOrNull(parsed.confidence)
  };
}

function extractChoice(parsed) {
  const { choice, confidence } = extractNamedChoice(
    parsed,
    ['execution_mode', 'mode', 'route', 'task_mode']
  );
  return { mode: normalizeMode(choice), confidence };
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
    const apiKey = await auth.getJevApiKey();
    if (!apiKey) {
      return {
        mode: null,
        accepted: false,
        source: 'jev',
        reason: 'key_missing',
        latencyMs: Date.now() - startedAt
      };
    }

    const { stdout, stderr } = await execFileAsync(
      'jev',
      ['ask', state, '--questions', questions, '--format', 'json'],
      {
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
        env: { ...process.env, TYPESAFE_API_KEY: apiKey }
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


const INTENT_REVIEW_DECISIONS = Object.freeze({
  KEEP_CURRENT: 'KEEP_CURRENT',
  ESCALATE_DEBUG: 'ESCALATE_DEBUG',
  ESCALATE_BUILD: 'ESCALATE_BUILD',
  REJECT_SCOPE: 'REJECT_SCOPE'
});

function normalizeIntentDecision(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return Object.values(INTENT_REVIEW_DECISIONS).includes(normalized)
    ? normalized
    : null;
}

async function reviewExecutionIntentWithJev({
  task,
  intent,
  candidates,
  currentMode,
  conflicts = [],
  timeoutMs = 2200
} = {}) {
  const startedAt = Date.now();
  const candidateEntries = Array.isArray(candidates) && candidates.length
    ? candidates.slice(0, 3)
    : (intent ? [{ id: 'candidate_1', intent, conflicts }] : []);

  if (!task || !candidateEntries.length || !currentMode) {
    return {
      accepted: false,
      decision: null,
      candidateId: null,
      mode: currentMode || null,
      reason: 'invalid_input',
      latencyMs: Date.now() - startedAt
    };
  }

  const state = JSON.stringify({
    original_task: String(task).slice(0, MAX_STATE_CHARS),
    current_mode: currentMode,
    execution_candidates: candidateEntries.map(candidate => ({
      id: candidate.id,
      execution_intent: candidate.intent,
      policy_conflicts: candidate.conflicts || []
    }))
  });

  const candidateCriteria = Object.fromEntries(candidateEntries.map(candidate => [
    candidate.id,
    [
      candidate.intent?.summary || 'Execution candidate',
      `expected_files=${candidate.intent?.expectedFiles ?? 0}`,
      `estimated_tools=${candidate.intent?.estimatedTools ?? 0}`,
      candidate.conflicts?.length ? `conflicts=${candidate.conflicts.join(',')}` : 'conflicts=none'
    ].join(' | ')
  ]));

  const questions = JSON.stringify({
    candidate_id: {
      type: 'choice',
      instructions: 'Choose the candidate that most directly completes the ORIGINAL task with the least unnecessary scope.',
      criteria: candidateCriteria
    },
    intent_review: {
      type: 'choice',
      instructions: [
        'Review the selected execution candidate against the ORIGINAL task.',
        'Do not legitimize unrelated work just because the agent proposed it.',
        'KEEP_CURRENT means the candidate is justified inside the current policy.',
        'ESCALATE_DEBUG only when the original task genuinely needs broader investigation or build verification.',
        'ESCALATE_BUILD only when the original task genuinely requires broad refactor, dependency changes, release/build work, migration, or destructive operations.',
        'REJECT_SCOPE when every candidate adds unnecessary work; Crew Runtime will re-plan inside the existing policy rather than misclassifying the request as chat.'
      ].join(' '),
      criteria: INTENT_REVIEW_DECISIONS
    }
  });

  try {
    const apiKey = await auth.getJevApiKey();
    if (!apiKey) {
      return {
        accepted: false,
        decision: null,
        candidateId: null,
        mode: currentMode,
        reason: 'key_missing',
        latencyMs: Date.now() - startedAt
      };
    }

    const { stdout } = await execFileAsync(
      'jev',
      ['ask', state, '--questions', questions, '--format', 'json'],
      {
        timeout: timeoutMs,
        maxBuffer: 512 * 1024,
        env: { ...process.env, TYPESAFE_API_KEY: apiKey }
      }
    );

    const parsed = JSON.parse(String(stdout || '').trim());
    const candidateChoice = extractNamedChoice(parsed, ['candidate_id', 'candidate']);
    const candidateId = candidateEntries.some(candidate => candidate.id === candidateChoice.choice)
      ? candidateChoice.choice
      : (candidateEntries.length === 1 ? candidateEntries[0].id : null);
    const { choice, confidence } = extractNamedChoice(parsed, ['intent_review', 'decision']);
    const decision = normalizeIntentDecision(choice);
    if (!decision || !candidateId) {
      return {
        accepted: false,
        decision,
        candidateId,
        mode: currentMode,
        confidence,
        reason: !candidateId ? 'invalid_candidate' : 'invalid_choice',
        latencyMs: Date.now() - startedAt
      };
    }

    const mode = decision === INTENT_REVIEW_DECISIONS.ESCALATE_BUILD
      ? 'BUILD'
      : decision === INTENT_REVIEW_DECISIONS.ESCALATE_DEBUG
        ? (currentMode === 'BUILD' ? 'BUILD' : 'DEBUG')
        : currentMode;

    return {
      accepted: true,
      decision,
      candidateId,
      mode,
      confidence,
      reason: decision === INTENT_REVIEW_DECISIONS.REJECT_SCOPE
        ? 'scope_rejected'
        : 'accepted',
      latencyMs: Date.now() - startedAt,
      model: parsed.model || parsed.meta?.model || null
    };
  } catch (error) {
    return {
      accepted: false,
      decision: null,
      candidateId: null,
      mode: currentMode,
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
  extractNamedChoice,
  INTENT_REVIEW_DECISIONS,
  getJevCliStatus,
  looksLikeContinuation,
  normalizeMode,
  reviewExecutionIntentWithJev,
  routeTaskWithJev,
  shouldRouteWithJev
};
