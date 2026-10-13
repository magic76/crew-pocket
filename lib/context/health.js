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

const CONTEXT_HISTORY_CONFIG = Object.freeze({
  recentTailMessages: 10
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

function normalizeTotalUsage(totalUsage, budget, fallbackTokens) {
  if (totalUsage && typeof totalUsage === 'object') {
    const value = Number(totalUsage.value);
    if (Number.isFinite(value) && value >= 0) {
      return {
        value: Math.round(value),
        exact: Boolean(totalUsage.exact),
        source: String(totalUsage.source || (totalUsage.exact ? 'provider' : 'heuristic'))
      };
    }
  }

  const budgetValue = Number(budget?.estimatedInputTokens);
  if (Number.isFinite(budgetValue) && budgetValue >= 0) {
    return {
      value: Math.round(budgetValue),
      exact: false,
      source: String(budget?.usageSource || 'heuristic')
    };
  }

  return {
    value: Math.max(0, Math.round(Number(fallbackTokens) || 0)),
    exact: false,
    source: 'heuristic'
  };
}

function analyzeContext({
  contributions = [],
  budget = {},
  totalUsage = null,
  thresholds = CONTEXT_HEALTH_THRESHOLDS
} = {}) {
  const normalized = contributions.map(normalizeContextContribution);
  const contributionEstimateTokens = sumTokens(normalized);
  const normalizedTotalUsage = normalizeTotalUsage(totalUsage, budget, contributionEstimateTokens);
  const normalizedBudget = normalizeContextBudget({
    ...budget,
    estimatedInputTokens: normalizedTotalUsage.value
  }, normalizedTotalUsage.value);
  const estimatedInputTokens = normalizedTotalUsage.value;
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

  const unattributedTokens = Math.max(0, estimatedInputTokens - contributionEstimateTokens);
  const overAttributedTokens = Math.max(0, contributionEstimateTokens - estimatedInputTokens);

  return {
    status,
    ...(usageRatio === null ? {} : { usageRatio }),
    contributions: normalized,
    breakdown: grouped,
    warnings,
    estimatedInputTokens,
    contributionEstimateTokens,
    unattributedTokens,
    overAttributedTokens,
    budget: normalizedBudget,
    totalUsage: normalizedTotalUsage,
    breakdownEstimate: {
      exact: false,
      source: 'heuristic',
      attributedTokens: contributionEstimateTokens,
      unattributedTokens,
      overAttributedTokens
    },
    largestContribution: largestContribution(normalized),
    largestCompactableContribution: largestContribution(
      normalized,
      item => item.compactable && !item.pinned
    ),
    // Backward-compatible alias. Breakdown attribution is always heuristic.
    estimate: {
      exact: false,
      source: 'heuristic'
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
    return [tool.name || tool.tool_name || 'tool',
      tool.args ?? tool.arguments ?? tool.input,
      tool.output ?? tool.result
    ].filter(value => value !== null && value !== undefined)
      .map(value => typeof value === 'string' ? value : JSON.stringify(value)).join('\n');
  } catch (_) {
    return String(tool.name || tool.tool_name || 'tool');
  }
}

function collectHistoryParts(messages = []) {
  const conversationParts = [];
  const codeParts = [];
  const toolParts = [];
  const reasoningParts = [];
  const systemParts = [];
  const metadataParts = [];
  const memoryParts = [];

  for (const message of messages) {
    let content = String(message?.content || '');
    if (message?.role === 'system' || message?.role === 'developer') {
      if (content) systemParts.push(content);
      continue;
    }
    if (message?.role === 'user') {
      content = content.replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/g, block => {
        if (/^<ADDITIONAL_METADATA>\s*\[(?:Updated|Refreshed) Long-Term Memory\]/.test(block)) {
          memoryParts.push(block);
        } else metadataParts.push(block);
        return '';
      });
    }
    if (content) {
      const split = stripCodeBlocks(content);
      if (split.prose.trim()) conversationParts.push(split.prose);
      if (split.code.trim()) codeParts.push(split.code);
    }
    if (message?.thinking) reasoningParts.push(String(message.thinking));
    for (const tool of message?.tools || []) toolParts.push(serializeTool(tool));
  }

  return {
    conversationText: conversationParts.join('\n\n'),
    codeText: codeParts.join('\n\n'),
    toolText: toolParts.join('\n'),
    systemText: systemParts.join('\n\n'),
    metadataText: metadataParts.join('\n\n'),
    memoryText: memoryParts.join('\n\n'),
    reasoningText: reasoningParts.join('\n\n')
  };
}

function appendHistoryBucket(contributions, parts, {
  suffix,
  history,
  priority,
  compactable,
  labelPrefix,
  estimator
}) {
  const sourceBase = history.conversation_id ? `conversation:${history.conversation_id}` : undefined;
  for (const [name, type, text, pinned] of [
    ['instructions', ContextSourceType.SYSTEM, parts.systemText, true],
    ['injected-metadata', ContextSourceType.OTHER, parts.metadataText, false],
    ['injected-memory', ContextSourceType.MEMORY, parts.memoryText, false]
  ]) {
    if (text) contributions.push(contributionFromText({
      id: `${name}-${suffix}`, type, text,
      label: `${labelPrefix} ${name}`, estimator,
      priority: pinned ? ContextPriority.REQUIRED : priority,
      pinned, compactable: !pinned && compactable, sourceRef: sourceBase
    }));
  }
  if (parts.conversationText) contributions.push(contributionFromText({
    id: `conversation-${suffix}`,
    type: ContextSourceType.CONVERSATION,
    text: parts.conversationText,
    label: `${labelPrefix} conversation`,
    priority,
    compactable,
    sourceRef: sourceBase,
    estimator
  }));
  if (parts.toolText) contributions.push(contributionFromText({
    id: `tools-${suffix}`,
    type: ContextSourceType.TOOL,
    text: parts.toolText,
    label: `${labelPrefix} tool output`,
    priority,
    compactable,
    sourceRef: sourceBase ? `${sourceBase}:tools` : undefined,
    estimator
  }));
  if (parts.codeText) contributions.push(contributionFromText({
    id: `code-${suffix}`,
    type: ContextSourceType.CODE,
    text: parts.codeText,
    label: `${labelPrefix} code`,
    priority,
    compactable,
    sourceRef: sourceBase ? `${sourceBase}:code` : undefined,
    estimator
  }));
  if (parts.reasoningText) contributions.push(contributionFromText({
    id: `reasoning-${suffix}`,
    type: ContextSourceType.OTHER,
    text: parts.reasoningText,
    label: `${labelPrefix} reasoning metadata`,
    priority: compactable ? ContextPriority.LOW : ContextPriority.HIGH,
    compactable,
    sourceRef: sourceBase ? `${sourceBase}:reasoning` : undefined,
    estimator
  }));
}

function buildHistoryContextContributions(history = {}, {
  estimator = defaultContextEstimator,
  recentTailMessages = CONTEXT_HISTORY_CONFIG.recentTailMessages
} = {}) {
  const messages = Array.isArray(history.active_messages)
    ? history.active_messages
    : Array.isArray(history.messages)
      ? history.messages
      : [];
  const tailCount = Math.max(0, Math.min(messages.length, Number(recentTailMessages) || 0));
  const splitAt = Math.max(0, messages.length - tailCount);
  const older = messages.slice(0, splitAt);
  const recent = messages.slice(splitAt);
  const contributions = [];

  appendHistoryBucket(contributions, collectHistoryParts(older), {
    suffix: 'history',
    history,
    priority: ContextPriority.NORMAL,
    compactable: true,
    labelPrefix: 'Older',
    estimator
  });
  appendHistoryBucket(contributions, collectHistoryParts(recent), {
    suffix: 'recent',
    history,
    priority: ContextPriority.HIGH,
    compactable: false,
    labelPrefix: 'Recent',
    estimator
  });

  return contributions;
}

function analyzeConversationContext(history = {}, {
  additionalContributions = [],
  estimator = defaultContextEstimator,
  thresholds = CONTEXT_HEALTH_THRESHOLDS,
  recentTailMessages = CONTEXT_HISTORY_CONFIG.recentTailMessages
} = {}) {
  const historyContributions = buildHistoryContextContributions(history, {
    estimator,
    recentTailMessages
  });
  const stats = history.context_stats || {};
  const activeTokens = Number(stats.active_tokens);
  const contextWindow = Number(stats.context_window);
  const providerHasTotal = Number.isFinite(activeTokens) && activeTokens >= 0;
  const totalUsage = providerHasTotal
    ? {
      value: activeTokens,
      exact: stats.active_tokens_exact === true,
      source: String(stats.active_tokens_source || (stats.active_tokens_exact === true ? 'provider' : 'heuristic'))
    }
    : null;

  const health = analyzeContext({
    // Codex model-facing messages already include Crew metadata. The snapshot
    // is a delivery ledger, not additional text still present in the context.
    contributions: [...(history.context_attribution ? [] : additionalContributions), ...historyContributions],
    budget: {
      ...(Number.isFinite(contextWindow) && contextWindow > 0 ? { maxTokens: contextWindow } : {})
    },
    totalUsage,
    thresholds
  });
  if (history.context_attribution) {
    health.breakdownEstimate = { ...health.breakdownEstimate, ...history.context_attribution };
    health.compactionExecution = 'provider_native';
  }
  return health;
}

module.exports = {
  CONTEXT_HEALTH_THRESHOLDS,
  CONTEXT_HISTORY_CONFIG,
  analyzeContext,
  analyzeConversationContext,
  buildHistoryContextContributions,
  groupContextContributions,
  largestContribution,
  stripCodeBlocks
};
