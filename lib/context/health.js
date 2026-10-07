const {
  ContextSourceType,
  ContextPriority,
  ContextHealthStatus,
  ContextWarningCode,
  normalizeContextContribution,
  normalizeContextBudget
} = require('./types');
const {
  defaultContextEstimator,
  contributionFromText
} = require('./estimator');

const CONTEXT_HEALTH_THRESHOLDS = Object.freeze({
  warningUsageRatio: 0.70,
  criticalUsageRatio: 0.90,
  conversationLargeTokens: 16000,
  conversationLargeShare: 0.45,
  toolLargeTokens: 8000,
  toolLargeShare: 0.20,
  memoryLargeTokens: 6000,
  memoryLargeShare: 0.25,
  lowPriorityLargeTokens: 6000,
  lowPriorityLargeShare: 0.25
});

function sumTokens(contributions) {
  return contributions.reduce((sum, contribution) => sum + contribution.estimatedTokens, 0);
}

function groupContextContributions(contributions = []) {
  const grouped = {};
  for (const raw of contributions) {
    const contribution = normalizeContextContribution(raw);
    if (!grouped[contribution.type]) {
      grouped[contribution.type] = {
        type: contribution.type,
        estimatedTokens: 0,
        count: 0
      };
    }
    grouped[contribution.type].estimatedTokens += contribution.estimatedTokens;
    grouped[contribution.type].count += 1;
  }
  return grouped;
}

function largestContribution(contributions = [], predicate = () => true) {
  return contributions
    .filter(predicate)
    .sort((a, b) => b.estimatedTokens - a.estimatedTokens || a.id.localeCompare(b.id))[0] || null;
}

function warning(code, contribution = null, details = {}) {
  return {
    code,
    ...(contribution?.id ? { contributionId: contribution.id } : {}),
    ...details
  };
}

function analyzeContext({
  contributions = [],
  budget = {},
  thresholds = CONTEXT_HEALTH_THRESHOLDS
} = {}) {
  const normalized = contributions.map(normalizeContextContribution);
  const contributionEstimateTokens = sumTokens(normalized);
  const normalizedBudget = normalizeContextBudget(budget, contributionEstimateTokens);
  const estimatedInputTokens = normalizedBudget.estimatedInputTokens;
  const availableInputTokens = normalizedBudget.availableInputTokens;
  const usageRatio = availableInputTokens && availableInputTokens > 0
    ? estimatedInputTokens / availableInputTokens
    : null;

  let status = ContextHealthStatus.UNKNOWN;
  if (usageRatio !== null) {
    status = usageRatio >= thresholds.criticalUsageRatio
      ? ContextHealthStatus.CRITICAL
      : usageRatio >= thresholds.warningUsageRatio
        ? ContextHealthStatus.WARNING
        : ContextHealthStatus.HEALTHY;
  }

  const warnings = [];
  if (usageRatio === null) {
    warnings.push(warning(ContextWarningCode.UNKNOWN_MODEL_BUDGET));
  } else if (usageRatio >= thresholds.warningUsageRatio) {
    warnings.push(warning(ContextWarningCode.NEAR_CONTEXT_LIMIT, null, { usageRatio }));
  }

  const denominator = Math.max(estimatedInputTokens, contributionEstimateTokens, 1);
  const grouped = groupContextContributions(normalized);

  const conversationTokens = grouped[ContextSourceType.CONVERSATION]?.estimatedTokens || 0;
  if (conversationTokens >= thresholds.conversationLargeTokens &&
      conversationTokens / denominator >= thresholds.conversationLargeShare) {
    warnings.push(warning(
      ContextWarningCode.CONVERSATION_LARGE,
      largestContribution(normalized, item => item.type === ContextSourceType.CONVERSATION),
      { estimatedTokens: conversationTokens }
    ));
  }

  const toolTokens = grouped[ContextSourceType.TOOL]?.estimatedTokens || 0;
  if (toolTokens >= thresholds.toolLargeTokens &&
      toolTokens / denominator >= thresholds.toolLargeShare) {
    warnings.push(warning(
      ContextWarningCode.TOOL_OUTPUT_LARGE,
      largestContribution(normalized, item => item.type === ContextSourceType.TOOL),
      { estimatedTokens: toolTokens }
    ));
  }

  const memoryTokens = grouped[ContextSourceType.MEMORY]?.estimatedTokens || 0;
  if (memoryTokens >= thresholds.memoryLargeTokens &&
      memoryTokens / denominator >= thresholds.memoryLargeShare) {
    warnings.push(warning(
      ContextWarningCode.MEMORY_OVERFETCH,
      largestContribution(normalized, item => item.type === ContextSourceType.MEMORY),
      { estimatedTokens: memoryTokens }
    ));
  }

  const lowPriority = normalized.filter(item => item.priority === ContextPriority.LOW);
  const lowPriorityTokens = sumTokens(lowPriority);
  if (lowPriorityTokens >= thresholds.lowPriorityLargeTokens &&
      lowPriorityTokens / denominator >= thresholds.lowPriorityLargeShare) {
    warnings.push(warning(
      ContextWarningCode.LOW_PRIORITY_CONTEXT_LARGE,
      largestContribution(lowPriority),
      { estimatedTokens: lowPriorityTokens }
    ));
  }

  return {
    status,
    ...(usageRatio === null ? {} : { usageRatio }),
    contributions: normalized,
    breakdown: grouped,
    warnings,
    estimatedInputTokens,
    contributionEstimateTokens,
    unattributedTokens: Math.max(0, estimatedInputTokens - contributionEstimateTokens),
    overAttributedTokens: Math.max(0, contributionEstimateTokens - estimatedInputTokens),
    budget: normalizedBudget,
    largestContribution: largestContribution(normalized),
    largestCompactableContribution: largestContribution(
      normalized,
      item => item.compactable && !item.pinned
    ),
    estimate: {
      exact: false,
      source: 'crew-context-health'
    }
  };
}

function stripCodeBlocks(text) {
  const codeBlocks = [];
  const prose = String(text || '').replace(/```[\s\S]*?```/g, block => {
    codeBlocks.push(block);
    return ' ';
  });
  return { prose, code: codeBlocks.join('\n\n') };
}

function serializeTool(tool) {
  if (!tool) return '';
  try {
    return JSON.stringify({
      name: tool.name || tool.tool_name || 'tool',
      args: tool.args || tool.arguments || tool.input || null,
      output: tool.output || tool.result || null
    });
  } catch (_) {
    return String(tool.name || tool.tool_name || 'tool');
  }
}

function buildHistoryContextContributions(history = {}, {
  estimator = defaultContextEstimator
} = {}) {
  const conversationParts = [];
  const codeParts = [];
  const toolParts = [];
  const reasoningParts = [];

  for (const message of history.messages || []) {
    const content = String(message?.content || '');
    if (content) {
      const split = stripCodeBlocks(content);
      if (split.prose.trim()) conversationParts.push(split.prose);
      if (split.code.trim()) codeParts.push(split.code);
    }
    if (message?.thinking) reasoningParts.push(String(message.thinking));
    for (const tool of message?.tools || []) toolParts.push(serializeTool(tool));
  }

  const contributions = [];
  const conversationText = conversationParts.join('\n\n');
  const codeText = codeParts.join('\n\n');
  const toolText = toolParts.join('\n');
  const reasoningText = reasoningParts.join('\n\n');

  if (conversationText) contributions.push(contributionFromText({
    id: 'conversation-current',
    type: ContextSourceType.CONVERSATION,
    text: conversationText,
    label: 'Conversation history',
    priority: ContextPriority.NORMAL,
    compactable: true,
    sourceRef: history.conversation_id ? `conversation:${history.conversation_id}` : undefined,
    estimator
  }));
  if (toolText) contributions.push(contributionFromText({
    id: 'tools-current',
    type: ContextSourceType.TOOL,
    text: toolText,
    label: 'Tool history',
    priority: ContextPriority.NORMAL,
    compactable: true,
    sourceRef: history.conversation_id ? `conversation:${history.conversation_id}:tools` : undefined,
    estimator
  }));
  if (codeText) contributions.push(contributionFromText({
    id: 'code-current',
    type: ContextSourceType.CODE,
    text: codeText,
    label: 'Code in conversation',
    priority: ContextPriority.NORMAL,
    compactable: true,
    sourceRef: history.conversation_id ? `conversation:${history.conversation_id}:code` : undefined,
    estimator
  }));
  if (reasoningText) contributions.push(contributionFromText({
    id: 'reasoning-history',
    type: ContextSourceType.OTHER,
    text: reasoningText,
    label: 'Reasoning/history metadata',
    priority: ContextPriority.LOW,
    compactable: true,
    sourceRef: history.conversation_id ? `conversation:${history.conversation_id}:reasoning` : undefined,
    estimator
  }));

  return contributions;
}

function analyzeConversationContext(history = {}, {
  additionalContributions = [],
  estimator = defaultContextEstimator,
  thresholds = CONTEXT_HEALTH_THRESHOLDS
} = {}) {
  const historyContributions = buildHistoryContextContributions(history, { estimator });
  const stats = history.context_stats || {};
  const activeTokens = Number(stats.active_tokens);
  const contextWindow = Number(stats.context_window);

  return analyzeContext({
    contributions: [...additionalContributions, ...historyContributions],
    budget: {
      ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { maxTokens: contextWindow } : {}),
      ...(Number.isFinite(activeTokens) && activeTokens >= 0 ? { estimatedInputTokens: activeTokens } : {})
    },
    thresholds
  });
}

module.exports = {
  CONTEXT_HEALTH_THRESHOLDS,
  analyzeContext,
  analyzeConversationContext,
  buildHistoryContextContributions,
  groupContextContributions,
  largestContribution,
  stripCodeBlocks
};
