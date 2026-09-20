const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const auth = require('./auth');
const { extractNamedChoice } = require('./jev-router');

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 2400;
const MAX_STATE_CHARS = 9000;

const YES_NO = Object.freeze({
  YES: 'Yes.',
  NO: 'No.'
});

function sanitizeText(value, max = 1800) {
  return String(value || '')
    .replace(/(["']?(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|password|authorization)["']?\s*[:=]\s*)[^,\s"']+/gi, '$1[REDACTED]')
    .replace(/\b[A-Z][A-Z0-9_]{2,}\s*=\s*\S+/g, '[ENV_REDACTED]')
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function confidenceFor(parsed, key) {
  return extractNamedChoice(parsed, [key]).confidence;
}

function answerFor(parsed, key) {
  return extractNamedChoice(parsed, [key]).choice;
}

function yes(parsed, key) {
  return String(answerFor(parsed, key) || '').toUpperCase() === 'YES';
}

function averageConfidence(parsed, keys) {
  const values = keys
    .map(key => confidenceFor(parsed, key))
    .filter(value => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function askJevSnapshot(state, questions, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const startedAt = Date.now();
  const apiKey = await auth.getJevApiKey();
  if (!apiKey) {
    return {
      ok: false,
      reason: 'key_missing',
      latencyMs: Date.now() - startedAt
    };
  }

  try {
    const { stdout } = await execFileAsync(
      'jev',
      [
        'ask',
        JSON.stringify(state).slice(0, MAX_STATE_CHARS),
        '--questions',
        JSON.stringify(questions),
        '--format',
        'json'
      ],
      {
        timeout: timeoutMs,
        maxBuffer: 768 * 1024,
        env: { ...process.env, TYPESAFE_API_KEY: apiKey }
      }
    );
    return {
      ok: true,
      parsed: JSON.parse(String(stdout || '').trim()),
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      ok: false,
      reason: error.code === 'ENOENT'
        ? 'cli_missing'
        : (error.killed || error.signal ? 'timeout' : 'error'),
      latencyMs: Date.now() - startedAt,
      error: sanitizeText(error.stderr || error.message || error, 800)
    };
  }
}

async function reviewToolFailureWithJev({
  task,
  mode,
  tool,
  metrics,
  intent
} = {}) {
  const state = {
    snapshot_type: 'TOOL_FAILURE',
    original_task: sanitizeText(task, 3500),
    current_mode: mode || null,
    tool: {
      name: sanitizeText(tool?.name, 160),
      state: sanitizeText(tool?.state, 80),
      attempt: Number(tool?.attempts) || 1,
      parameters: sanitizeText(tool?.parameters, 1400),
      output: sanitizeText(tool?.output, 2200)
    },
    metrics: metrics || null,
    approved_execution_intent: intent || null
  };

  const questions = {
    failure_type: {
      type: 'choice',
      instructions: 'Classify the primary reason this tool attempt failed.',
      criteria: {
        CODE: 'The project code or implementation is wrong.',
        TOOL: 'The chosen tool/command itself is unsuitable or was used incorrectly.',
        ENV: 'The local runtime, environment, dependency availability, path, or platform is the blocker.',
        NETWORK: 'Network/service connectivity is the blocker.',
        AUTH: 'Authentication, login, credential, or authorization is the blocker.',
        PERMISSION: 'OS, filesystem, sandbox, or access permission is the blocker.',
        BAD_INPUT: 'The tool received invalid or incomplete input.',
        UNKNOWN: 'Evidence is insufficient.'
      }
    },
    retry_same: {
      type: 'choice',
      instructions: 'Should the agent retry essentially the same tool/action with the same approach?',
      criteria: YES_NO
    },
    try_alternative: {
      type: 'choice',
      instructions: 'Should the agent continue the same user goal using a meaningfully different approach?',
      criteria: YES_NO
    },
    likely_transient: {
      type: 'choice',
      instructions: 'Is this failure likely transient and likely to succeed without a code change?',
      criteria: YES_NO
    },
    task_on_track: {
      type: 'choice',
      instructions: 'Despite this failure, is the current work still directed at the original user goal?',
      criteria: YES_NO
    },
    escalation: {
      type: 'choice',
      instructions: 'Does the original task justify widening the current execution mode because of this evidence? Never escalate just to explore unrelated work.',
      criteria: {
        NONE: 'Keep the current execution mode.',
        DEBUG: 'Broader debugging/build verification is justified.',
        BUILD: 'Broad build/refactor/dependency/release scope is genuinely required.'
      }
    },
    ask_user: {
      type: 'choice',
      instructions: 'Is user input, authentication, missing information, or an external action required before useful work can continue?',
      criteria: YES_NO
    },
    should_stop: {
      type: 'choice',
      instructions: 'Should Crew Pocket stop the current turn instead of spending more tools?',
      criteria: YES_NO
    },
    stuck_risk: {
      type: 'choice',
      instructions: 'How likely is the agent to waste more tools if it continues without changing strategy?',
      criteria: {
        LOW: 'Low risk of an unproductive loop.',
        MEDIUM: 'Some risk; keep work narrow.',
        HIGH: 'High risk of repeated or broad unproductive work.'
      }
    },
    learning_value: {
      type: 'choice',
      instructions: 'Would this failure/recovery pattern be useful to evaluate later for reusable Crew Experience learning?',
      criteria: {
        NONE: 'Ephemeral or not reusable.',
        LOW: 'Possibly useful but weak evidence.',
        HIGH: 'Likely reusable across future similar tasks.'
      }
    }
  };

  const result = await askJevSnapshot(state, questions);
  if (!result.ok) return { type: 'TOOL_FAILURE', ...result };

  const parsed = result.parsed;
  const keys = Object.keys(questions);
  return {
    type: 'TOOL_FAILURE',
    ok: true,
    failureType: answerFor(parsed, 'failure_type') || 'UNKNOWN',
    retrySame: yes(parsed, 'retry_same'),
    tryAlternative: yes(parsed, 'try_alternative'),
    likelyTransient: yes(parsed, 'likely_transient'),
    taskOnTrack: yes(parsed, 'task_on_track'),
    escalation: answerFor(parsed, 'escalation') || 'NONE',
    askUser: yes(parsed, 'ask_user'),
    shouldStop: yes(parsed, 'should_stop'),
    stuckRisk: answerFor(parsed, 'stuck_risk') || 'MEDIUM',
    learningValue: answerFor(parsed, 'learning_value') || 'NONE',
    confidence: averageConfidence(parsed, keys),
    latencyMs: result.latencyMs
  };
}

async function reviewSoftBudgetWithJev({
  task,
  mode,
  metrics,
  policy,
  intent,
  recentFailures = []
} = {}) {
  const state = {
    snapshot_type: 'SOFT_BUDGET',
    original_task: sanitizeText(task, 3500),
    current_mode: mode || null,
    metrics: metrics || null,
    policy: policy || null,
    approved_execution_intent: intent || null,
    recent_failures: recentFailures.slice(-3)
  };

  const questions = {
    goal_progress: {
      type: 'choice',
      instructions: 'Estimate progress toward the original user-visible goal using only the supplied evidence.',
      criteria: {
        LOW: 'Little useful progress.',
        MEDIUM: 'Meaningful progress, but substantial work remains.',
        HIGH: 'Most necessary work is done.',
        NEAR_DONE: 'Only tiny verification or finishing work remains.'
      }
    },
    root_cause_found: {
      type: 'choice',
      instructions: 'For debugging tasks, has a concrete root cause been found? For non-debug tasks, answer YES when the exact change target is known.',
      criteria: YES_NO
    },
    solution_found: {
      type: 'choice',
      instructions: 'Is there already a concrete solution or implementation path supported by the evidence?',
      criteria: YES_NO
    },
    remaining_work: {
      type: 'choice',
      instructions: 'How much necessary work remains to satisfy exactly the original task?',
      criteria: {
        TINY: 'One or two narrow actions/verification steps.',
        SMALL: 'A few focused actions remain.',
        LARGE: 'Substantial exploration or broad work remains.'
      }
    },
    approach_working: {
      type: 'choice',
      instructions: 'Is the current approach producing useful evidence or implementation progress?',
      criteria: YES_NO
    },
    finish_within_hard_budget: {
      type: 'choice',
      instructions: 'Is the task likely to finish within the current hard tool/file limits if the agent stays focused?',
      criteria: YES_NO
    },
    action: {
      type: 'choice',
      instructions: 'Choose the best runtime control action. Do not widen scope unless the original request genuinely requires it.',
      criteria: {
        CONTINUE: 'Current approach is productive; continue inside the current policy.',
        CHANGE_APPROACH: 'Stay in the current mode but stop broad/repeated exploration and use a narrower different approach.',
        ESCALATE_DEBUG: 'The original task genuinely requires broader debugging/build verification.',
        ESCALATE_BUILD: 'The original task genuinely requires build/release/dependency/broad-refactor scope.',
        STOP: 'Further autonomous work is unlikely to help within the user request.'
      }
    },
    ask_user: {
      type: 'choice',
      instructions: 'Does useful continuation require user input, missing information, authentication, or an external choice?',
      criteria: YES_NO
    },
    stuck_risk: {
      type: 'choice',
      instructions: 'How likely is continued autonomous work to become an unproductive tool loop?',
      criteria: {
        LOW: 'Low.',
        MEDIUM: 'Moderate.',
        HIGH: 'High.'
      }
    }
  };

  const result = await askJevSnapshot(state, questions);
  if (!result.ok) return { type: 'SOFT_BUDGET', ...result };

  const parsed = result.parsed;
  const keys = Object.keys(questions);
  return {
    type: 'SOFT_BUDGET',
    ok: true,
    goalProgress: answerFor(parsed, 'goal_progress') || 'MEDIUM',
    rootCauseFound: yes(parsed, 'root_cause_found'),
    solutionFound: yes(parsed, 'solution_found'),
    remainingWork: answerFor(parsed, 'remaining_work') || 'SMALL',
    approachWorking: yes(parsed, 'approach_working'),
    finishWithinHardBudget: yes(parsed, 'finish_within_hard_budget'),
    action: answerFor(parsed, 'action') || 'CONTINUE',
    askUser: yes(parsed, 'ask_user'),
    stuckRisk: answerFor(parsed, 'stuck_risk') || 'MEDIUM',
    confidence: averageConfidence(parsed, keys),
    latencyMs: result.latencyMs
  };
}

function shouldUseRuntimeSnapshots({ provider, model } = {}) {
  return provider === 'codex' && model === 'gpt-5.6-luna';
}

module.exports = {
  reviewSoftBudgetWithJev,
  reviewToolFailureWithJev,
  sanitizeText,
  shouldUseRuntimeSnapshots
};
