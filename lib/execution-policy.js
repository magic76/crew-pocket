const { isLunaModel } = require('./model-runtime');

const TASK_MODES = Object.freeze({
  CHAT: 'CHAT',
  INSPECT: 'INSPECT',
  SURGICAL_EDIT: 'SURGICAL_EDIT',
  DEBUG: 'DEBUG',
  BUILD: 'BUILD'
});

const VERIFICATION_MODES = Object.freeze({
  NONE: 'NONE',
  TARGETED: 'TARGETED',
  FULL: 'FULL'
});

const BASE_POLICIES = Object.freeze({
  [TASK_MODES.CHAT]: Object.freeze({
    softToolExecutions: 0,
    hardToolExecutions: 0,
    maxPolls: 0,
    maxFilesChanged: 0,
    allowWrite: false,
    allowBuild: false,
    allowDependencyChanges: false,
    verification: VERIFICATION_MODES.NONE
  }),
  [TASK_MODES.INSPECT]: Object.freeze({
    softToolExecutions: 6,
    hardToolExecutions: 10,
    maxPolls: 4,
    maxFilesChanged: 0,
    allowWrite: false,
    allowBuild: false,
    allowDependencyChanges: false,
    verification: VERIFICATION_MODES.NONE
  }),
  [TASK_MODES.SURGICAL_EDIT]: Object.freeze({
    softToolExecutions: 8,
    hardToolExecutions: 12,
    maxPolls: 4,
    maxFilesChanged: 3,
    allowWrite: true,
    allowBuild: false,
    allowDependencyChanges: false,
    verification: VERIFICATION_MODES.TARGETED
  }),
  [TASK_MODES.DEBUG]: Object.freeze({
    softToolExecutions: 12,
    hardToolExecutions: 18,
    maxPolls: 6,
    maxFilesChanged: 5,
    allowWrite: true,
    allowBuild: true,
    allowDependencyChanges: false,
    verification: VERIFICATION_MODES.TARGETED
  }),
  [TASK_MODES.BUILD]: Object.freeze({
    softToolExecutions: 18,
    hardToolExecutions: 28,
    maxPolls: 8,
    maxFilesChanged: 12,
    allowWrite: true,
    allowBuild: true,
    allowDependencyChanges: true,
    verification: VERIFICATION_MODES.FULL
  })
});

function normalizeTaskMode(value) {
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
  return Object.values(TASK_MODES).includes(normalized) ? normalized : null;
}

function clampInteger(value, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  const numeric = Number(value);
  if (!Number.isInteger(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function resolveExecutionPolicy({
  provider,
  model,
  executionMode,
  executionPolicy,
  executionSource
} = {}) {
  if (provider && provider !== 'codex') return null;

  const requestedMode = normalizeTaskMode(executionMode || executionPolicy?.mode);
  const isLunaDefault = !requestedMode && isLunaModel(model);
  const mode = requestedMode || (isLunaDefault ? TASK_MODES.SURGICAL_EDIT : null);
  if (!mode) return null;

  const base = BASE_POLICIES[mode];
  const source = requestedMode ? (executionSource || 'request') : 'luna-default';
  const overrides = executionPolicy && typeof executionPolicy === 'object' ? executionPolicy : {};

  const hardToolExecutions = clampInteger(
    overrides.hardToolExecutions,
    base.hardToolExecutions,
    0,
    100
  );
  const softToolExecutions = Math.min(
    hardToolExecutions,
    clampInteger(overrides.softToolExecutions, base.softToolExecutions, 0, 100)
  );

  return Object.freeze({
    mode,
    source,
    softToolExecutions,
    hardToolExecutions,
    maxPolls: clampInteger(overrides.maxPolls, base.maxPolls, 0, 50),
    maxFilesChanged: clampInteger(overrides.maxFilesChanged, base.maxFilesChanged, 0, 50),
    allowWrite: typeof overrides.allowWrite === 'boolean' ? overrides.allowWrite : base.allowWrite,
    allowBuild: typeof overrides.allowBuild === 'boolean' ? overrides.allowBuild : base.allowBuild,
    allowDependencyChanges: typeof overrides.allowDependencyChanges === 'boolean'
      ? overrides.allowDependencyChanges
      : base.allowDependencyChanges,
    verification: Object.values(VERIFICATION_MODES).includes(overrides.verification)
      ? overrides.verification
      : base.verification,
    stopWhenDone: true
  });
}

function buildExecutionContract(policy) {
  if (!policy) return '';

  const rules = [
    '[Crew Pocket Execution Contract]',
    `MODE: ${policy.mode}`,
    'Complete exactly the requested task. Make the smallest coherent change that fully satisfies it.',
    'Do not investigate, refactor, rename, document, or improve unrelated code.',
    'When independent read-only checks or tool calls do not depend on one another, run them in parallel; keep dependent work and conflicting writes ordered.',
    'Keep tool output concise: read only the relevant file sections, summarize long results, and do not repeat unchanged output.',
    'Avoid rereading files or rerunning checks whose relevant result is already available; poll only for meaningful state changes.',
    'Prefer compact summaries for outputs above roughly 8 KB; include full content only when it is required to complete or verify the requested task.',
    policy.allowDependencyChanges
      ? 'Dependency changes are allowed only when required by the task.'
      : 'Do not add, remove, or upgrade dependencies.',
    policy.allowBuild
      ? 'Build/test commands are allowed when they are necessary for verification.'
      : 'Do not run broad builds or full test suites unless the requested change cannot be verified otherwise.',
    policy.allowWrite
      ? `Keep the edit surface narrow; target at most ${policy.maxFilesChanged} changed files unless the task genuinely cannot be completed otherwise.`
      : 'Do not modify files.',
    policy.verification === VERIFICATION_MODES.FULL
      ? 'VERIFY: run the relevant full verification required by the task.'
      : policy.verification === VERIFICATION_MODES.TARGETED
        ? 'VERIFY: use targeted verification for the affected code path only.'
        : 'VERIFY: no verification command is required unless needed to answer correctly.',
    `TOOL BUDGET: soft=${policy.softToolExecutions}, hard=${policy.hardToolExecutions}, polling=${policy.maxPolls}. Treat the hard limit as a strict ceiling.`,
    'STOP: as soon as the requested behavior is implemented and the required verification passes, stop working and report the result.',
    'Do not look for additional improvements after the task is complete.'
  ];

  return rules.join('\n');
}

function wrapPromptWithExecutionContract(prompt, policy) {
  // Execution policy is enforced by Crew Runtime. Keep it out of the model
  // prompt so every turn does not repeat a large, potentially conflicting
  // instruction block.
  return prompt;
}

module.exports = {
  TASK_MODES,
  VERIFICATION_MODES,
  resolveExecutionPolicy,
  buildExecutionContract,
  wrapPromptWithExecutionContract
};
