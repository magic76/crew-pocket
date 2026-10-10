// Progress-aware compaction only decides WHEN. The existing planner decides WHAT;
// the provider Safe Compact path decides HOW. All weights are heuristic defaults
// to be calibrated against local session telemetry, not research-derived scores.
const { ContextSourceType, ContextPriority } = require('./types');

const AUTO_COMPACT_CONFIG = Object.freeze({
  weights: Object.freeze({
    contextPressure: 0.35,
    staleContextRatio: 0.25,
    repetitionScore: 0.15,
    toolOutputRatio: 0.10,
    taskStageTransition: 0.10,
    workingStateStable: 0.05
  }),
  suggestThreshold: 0.55,
  autoThreshold: 0.78,
  staleReasonThreshold: 0.30,
  toolReasonThreshold: 0.20,
  repetitionReasonThreshold: 0.30,
  repeatWindow: 18,
  // Hysteresis applies to automatic compaction only. A new transition does
  // not bypass the minimum time between costly compactions.
  cooldownMinutes: 10,
  cooldownTurns: 4,
  cooldownNewTokens: 12000,
  telemetryMaxBytes: 2 * 1024 * 1024
});

const AUTO_COMPACT_REASON = Object.freeze({
  CONTEXT_PRESSURE_HIGH: 'CONTEXT_PRESSURE_HIGH',
  STALE_CONTEXT_HIGH: 'STALE_CONTEXT_HIGH',
  TOOL_OUTPUT_HIGH: 'TOOL_OUTPUT_HIGH',
  REPETITION_HIGH: 'REPETITION_HIGH',
  TASK_STAGE_TRANSITION: 'TASK_STAGE_TRANSITION',
  WORKING_STATE_UNSTABLE: 'WORKING_STATE_UNSTABLE',
  COOLDOWN_ACTIVE: 'COOLDOWN_ACTIVE'
});

function clamp01(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0;
}

function activeContributions(health) {
  return Array.isArray(health?.contributions) ? health.contributions : [];
}

function isOldCompactable(item) {
  if (!item || item.compactable === false || item.pinned ||
      item.priority === ContextPriority.REQUIRED) return false;
  if ([ContextSourceType.ROLE, ContextSourceType.PROJECT, ContextSourceType.TASK,
    ContextSourceType.MEMORY, ContextSourceType.WORK].includes(item.type)) return false;
  // Current / recent context is never stale, even if metadata is malformed.
  const name = `${item.id || ''} ${item.label || ''}`.toLowerCase();
  if (/recent|current|active|tail/.test(name)) return false;
  return item.priority === ContextPriority.LOW ||
    [ContextSourceType.CONVERSATION, ContextSourceType.TOOL,
      ContextSourceType.CODE, ContextSourceType.DOCUMENT].includes(item.type) ||
    /checkpoint|older|history/.test(name);
}

function toolEventsFromHistory(history = {}, limit = AUTO_COMPACT_CONFIG.repeatWindow) {
  const messages = Array.isArray(history.active_messages) ? history.active_messages
    : Array.isArray(history.messages) ? history.messages : [];
  const result = [];
  for (const message of messages.slice(-35)) {
    for (const tool of message?.tools || []) {
      if (tool && typeof tool === 'object') result.push(tool);
    }
  }
  return result.slice(-limit);
}

function stableArgs(tool) {
  const input = tool?.args ?? tool?.arguments ?? tool?.input ?? tool?.tool_info?.parameters ?? tool?.info?.parameters ?? {};
  if (typeof input === 'string') return input.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 280);
  if (!input || typeof input !== 'object') return '';
  // Files and commands are better loop indicators than non-deterministic
  // metadata such as request IDs and invocation timestamps.
  const keys = ['path', 'filePath', 'file_path', 'filename', 'file', 'command', 'cmd', 'query', 'pattern', 'url', 'args'];
  const selected = keys.filter(key => input[key] != null).map(key =>
    `${key}:${String(Array.isArray(input[key]) ? input[key].join(' ') : input[key]).toLowerCase().replace(/\s+/g, ' ').slice(0, 220)}`);
  if (selected.length) return selected.join('|');
  return Object.keys(input).length ? JSON.stringify(input).slice(0, 220) : '';
}

function summarizeRepeatedTools(tools = [], config = AUTO_COMPACT_CONFIG) {
  const events = (Array.isArray(tools) ? tools : []).slice(-config.repeatWindow);
  const signatures = events.map(tool => {
    const name = String(tool?.name || tool?.tool_name || tool?.toolName || '').toLowerCase().trim();
    if (!name) return '';
    const args = stableArgs(tool);
    // Missing arguments alone do not prove two reads inspected the same file.
    if (!args && /read|inspect|search|grep/.test(name)) return '';
    return `${name}|${args}`;
  }).filter(Boolean);
  const counts = new Map();
  for (const sig of signatures) counts.set(sig, (counts.get(sig) || 0) + 1);
  return {
    observed: signatures.length,
    repeated: [...counts.values()].reduce((sum, count) => sum + Math.max(0, count - 2), 0)
  };
}

function calculateRepetitionScore(tools = [], config = AUTO_COMPACT_CONFIG) {
  const { observed, repeated } = summarizeRepeatedTools(tools, config);
  return observed < 4 ? 0 : clamp01(repeated / Math.max(1, observed - 2) * 2);
}

function toolStage(tool) {
  const name = String(tool?.name || tool?.tool_name || tool?.toolName || '').toLowerCase();
  const details = stableArgs(tool);
  const command = `${name} ${details}`;
  if (/\b(npm test|npm run test|vitest|jest|pytest|gradle|eslint|lint|build|cargo test|go test|tsc)\b/.test(command)) return 'test';
  if (/\b(review|git diff|git show)\b/.test(command)) return 'review';
  if (/\b(apply_patch|write_file|edit_file|replace_file|create_file|update_file|sed -i)\b/.test(command)) return 'implementation';
  if (/\b(read_file|inspect|grep|rg |search|cat |head |tail |ls )\b/.test(command)) return 'research';
  return null;
}

function inferTaskStage(history, recentTools = []) {
  const tools = [...toolEventsFromHistory(history), ...(Array.isArray(recentTools) ? recentTools : [])];
  for (let i = tools.length - 1; i >= 0; i--) {
    const state = String(tools[i]?.state || tools[i]?.status || '').toLowerCase();
    if (state && !['completed','complete','success','succeeded','done'].includes(state)) continue;
    const stage = toolStage(tools[i]);
    if (stage) return stage;
  }
  return null;
}

function isStageTransition(previous, current) {
  if (!previous || !current || previous === current) return false;
  return ['research>implementation','implementation>test','test>review',
    'research>test','implementation>review'].includes(`${previous}>${current}`);
}

function buildAutoCompactSignals({ health = {}, history = {}, recentTools = [], previousStage = null, runtime = {} } = {}) {
  const contributions = activeContributions(health);
  const attributed = contributions.reduce((sum, item) => sum + (Number(item.estimatedTokens) || 0), 0);
  const providerTotal = Number(health?.totalUsage?.value);
  const total = Math.max(attributed, Number.isFinite(providerTotal) ? providerTotal : 0, 1);
  const stale = contributions.filter(isOldCompactable)
    .reduce((sum, item) => sum + (Number(item.estimatedTokens) || 0), 0);
  const tools = contributions.filter(item => item.type === ContextSourceType.TOOL)
    .reduce((sum, item) => sum + (Number(item.estimatedTokens) || 0), 0);
  const historyTools = toolEventsFromHistory(history);
  // Provider history frequently contains the same tools as the just-finished
  // event stream. Never double-count one invocation as evidence of a loop.
  const currentStage = inferTaskStage(recentTools.length ? {} : history, recentTools);
  const ratio = Number(health?.usageRatio);
  const hasPressure = health?.usageRatio !== null && health?.usageRatio !== undefined && Number.isFinite(ratio);
  const activeTool = (Array.isArray(recentTools) ? recentTools : []).some(tool => {
    const state = String(tool?.state || tool?.status || '').toLowerCase();
    // Unknown non-terminal states are unsafe: providers use different state vocabularies.
    return Boolean(state) && !['completed','complete','success','succeeded','done',
      'failed','error','cancelled','canceled','stopped'].includes(state);
  });
  const workingStateStable = !runtime.streaming && !runtime.toolRunning && !runtime.buildRunning &&
    !runtime.pendingSideEffect && !runtime.externalPending && !activeTool;
  return {
    contextPressure: hasPressure ? clamp01(ratio) : null,
    staleContextRatio: clamp01(stale / total),
    toolOutputRatio: clamp01(tools / total),
    repetitionScore: calculateRepetitionScore(historyTools.length ? historyTools : recentTools),
    taskStageTransition: isStageTransition(previousStage, currentStage),
    workingStateStable,
    currentStage
  };
}

function autoCompactCooldown({ lastCompactedAt = null, lastCompactedTurn = null, lastCompactedTokenCount = null,
  currentTurn = 0, currentTokens = 0, taskStageTransition = false, now = Date.now(),
  config = AUTO_COMPACT_CONFIG } = {}) {
  if (!lastCompactedAt) return { active: false };
  const elapsed = now - new Date(lastCompactedAt).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return { active: true };
  const turns = Math.max(0, Number(currentTurn) - Number(lastCompactedTurn || 0));
  const grown = Math.max(0, Number(currentTokens) - Number(lastCompactedTokenCount || 0));
  return { active: elapsed < config.cooldownMinutes * 60000 ||
    !(turns >= config.cooldownTurns || grown >= config.cooldownNewTokens || taskStageTransition),
    elapsedMinutes: Math.floor(elapsed / 60000), turnsSinceCompact: turns, newTokens: grown };
}

function evaluateAutoCompact({ health = {}, signals = {}, cooldown = { active: false },
  canCompact = true, config = AUTO_COMPACT_CONFIG } = {}) {
  const hasPressure = signals.contextPressure !== null && signals.contextPressure !== undefined &&
    Number.isFinite(Number(signals.contextPressure));
  const entries = [
    ['contextPressure', hasPressure ? clamp01(signals.contextPressure) : null],
    ['staleContextRatio', clamp01(signals.staleContextRatio)],
    ['repetitionScore', clamp01(signals.repetitionScore)],
    ['toolOutputRatio', clamp01(signals.toolOutputRatio)],
    ['taskStageTransition', signals.taskStageTransition ? 1 : 0],
    ['workingStateStable', signals.workingStateStable === true ? 1 : 0]
  ];
  const weight = entries.reduce((total, [key, value]) => total + (value === null ? 0 : config.weights[key]), 0);
  const score = weight ? clamp01(entries.reduce((total, [key, value]) =>
    total + (value === null ? 0 : value * config.weights[key]), 0) / weight) : 0;
  const reasons = [];
  if (hasPressure && signals.contextPressure >= 0.70) reasons.push(AUTO_COMPACT_REASON.CONTEXT_PRESSURE_HIGH);
  if (signals.staleContextRatio >= config.staleReasonThreshold) reasons.push(AUTO_COMPACT_REASON.STALE_CONTEXT_HIGH);
  if (signals.toolOutputRatio >= config.toolReasonThreshold) reasons.push(AUTO_COMPACT_REASON.TOOL_OUTPUT_HIGH);
  if (signals.repetitionScore >= config.repetitionReasonThreshold) reasons.push(AUTO_COMPACT_REASON.REPETITION_HIGH);
  if (signals.taskStageTransition === true) reasons.push(AUTO_COMPACT_REASON.TASK_STAGE_TRANSITION);
  const safeNow = signals.workingStateStable === true && canCompact === true && cooldown.active !== true;
  if (!signals.workingStateStable) reasons.push(AUTO_COMPACT_REASON.WORKING_STATE_UNSTABLE);
  if (cooldown.active) reasons.push(AUTO_COMPACT_REASON.COOLDOWN_ACTIVE);
  const recommendation = !canCompact || score < config.suggestThreshold ? 'none'
    : score >= config.autoThreshold && safeNow ? 'auto' : 'suggest';
  return { recommendation, score: Number(score.toFixed(3)), reasons, safeNow };
}

module.exports = {
  AUTO_COMPACT_CONFIG, AUTO_COMPACT_REASON, buildAutoCompactSignals,
  calculateRepetitionScore, summarizeRepeatedTools, inferTaskStage, isStageTransition, isOldCompactable,
  autoCompactCooldown, evaluateAutoCompact
};
