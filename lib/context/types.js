const ContextSourceType = Object.freeze({
  SYSTEM: 'system',
  ROLE: 'role',
  PROJECT: 'project',
  MEMORY: 'memory',
  CONVERSATION: 'conversation',
  TOOL: 'tool',
  CODE: 'code',
  DOCUMENT: 'document',
  TASK: 'task',
  OTHER: 'other'
});

const ContextPriority = Object.freeze({
  REQUIRED: 'required',
  HIGH: 'high',
  NORMAL: 'normal',
  LOW: 'low'
});

const ContextHealthStatus = Object.freeze({
  HEALTHY: 'healthy',
  WARNING: 'warning',
  CRITICAL: 'critical',
  UNKNOWN: 'unknown'
});

const ContextWarningCode = Object.freeze({
  CONVERSATION_LARGE: 'CONVERSATION_LARGE',
  TOOL_OUTPUT_LARGE: 'TOOL_OUTPUT_LARGE',
  MEMORY_OVERFETCH: 'MEMORY_OVERFETCH',
  LOW_PRIORITY_CONTEXT_LARGE: 'LOW_PRIORITY_CONTEXT_LARGE',
  NEAR_CONTEXT_LIMIT: 'NEAR_CONTEXT_LIMIT',
  UNKNOWN_MODEL_BUDGET: 'UNKNOWN_MODEL_BUDGET'
});

const VALID_SOURCE_TYPES = new Set(Object.values(ContextSourceType));
const VALID_PRIORITIES = new Set(Object.values(ContextPriority));

function optionalTokenCount(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new Error('Invalid context token count');
  return Math.round(numeric);
}

function normalizeContextContribution(input = {}) {
  const id = String(input.id || '').trim().slice(0, 180);
  if (!id) throw new Error('Context contribution id is required');

  const type = String(input.type || '').trim().toLowerCase();
  if (!VALID_SOURCE_TYPES.has(type)) throw new Error(`Invalid context source type: ${input.type}`);

  const priority = String(input.priority || ContextPriority.NORMAL).trim().toLowerCase();
  if (!VALID_PRIORITIES.has(priority)) throw new Error(`Invalid context priority: ${input.priority}`);

  return {
    id,
    type,
    ...(String(input.label || '').trim() ? { label: String(input.label).trim().slice(0, 240) } : {}),
    estimatedTokens: optionalTokenCount(input.estimatedTokens) || 0,
    priority,
    compactable: input.compactable === undefined ? true : Boolean(input.compactable),
    pinned: Boolean(input.pinned),
    ...(String(input.sourceRef || '').trim() ? { sourceRef: String(input.sourceRef).trim().slice(0, 500) } : {})
  };
}

function normalizeContextBudget(input = {}, fallbackEstimatedInputTokens = 0) {
  const maxTokens = optionalTokenCount(input.maxTokens);
  const reservedOutputTokens = optionalTokenCount(input.reservedOutputTokens);
  const reservedReasoningTokens = optionalTokenCount(input.reservedReasoningTokens);
  const explicitEstimated = optionalTokenCount(input.estimatedInputTokens);
  const estimatedInputTokens = explicitEstimated === null
    ? Math.max(0, Math.round(Number(fallbackEstimatedInputTokens) || 0))
    : explicitEstimated;

  const reserved = (reservedOutputTokens || 0) + (reservedReasoningTokens || 0);
  const availableInputTokens = maxTokens === null ? null : Math.max(0, maxTokens - reserved);

  return {
    maxTokens,
    reservedOutputTokens,
    reservedReasoningTokens,
    estimatedInputTokens,
    availableInputTokens
  };
}

module.exports = {
  ContextSourceType,
  ContextPriority,
  ContextHealthStatus,
  ContextWarningCode,
  normalizeContextContribution,
  normalizeContextBudget
};
