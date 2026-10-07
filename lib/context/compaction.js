const {
  ContextSourceType,
  ContextPriority,
  normalizeContextContribution
} = require('./types');

const CompactionAction = Object.freeze({
  KEEP: 'keep',
  SUMMARIZE: 'summarize',
  DROP: 'drop',
  RERETRIEVE: 'reretrieve'
});

const CONTEXT_COMPACTION_CONFIG = Object.freeze({
  recentTailMessages: 10,
  summaryRatio: 0.18,
  minSummaryTokens: 600
});

function summarizeTarget(tokens, config = CONTEXT_COMPACTION_CONFIG) {
  const value = Math.max(0, Math.round(Number(tokens) || 0));
  if (!value) return 0;
  return Math.min(value, Math.max(config.minSummaryTokens, Math.round(value * config.summaryRatio)));
}

function actionEntry(contribution, action, estimatedAfterTokens) {
  const before = contribution.estimatedTokens;
  const after = Math.max(0, Math.min(before, Math.round(Number(estimatedAfterTokens) || 0)));
  return {
    ...contribution,
    action,
    estimatedBeforeTokens: before,
    estimatedAfterTokens: after,
    estimatedSavingsTokens: Math.max(0, before - after)
  };
}

function classifyContribution(contribution, config) {
  if (contribution.pinned ||
      contribution.compactable === false ||
      contribution.priority === ContextPriority.REQUIRED) {
    return actionEntry(contribution, CompactionAction.KEEP, contribution.estimatedTokens);
  }

  if (contribution.type === ContextSourceType.MEMORY) {
    return actionEntry(contribution, CompactionAction.RERETRIEVE, 0);
  }

  if (contribution.type === ContextSourceType.CONVERSATION ||
      contribution.type === ContextSourceType.CODE ||
      contribution.type === ContextSourceType.DOCUMENT) {
    return actionEntry(contribution, CompactionAction.SUMMARIZE, summarizeTarget(contribution.estimatedTokens, config));
  }

  if (contribution.type === ContextSourceType.TOOL &&
      [ContextPriority.NORMAL, ContextPriority.LOW].includes(contribution.priority)) {
    return actionEntry(contribution, CompactionAction.DROP, 0);
  }

  if ([ContextSourceType.OTHER, ContextSourceType.SYSTEM].includes(contribution.type) &&
      [ContextPriority.NORMAL, ContextPriority.LOW].includes(contribution.priority)) {
    return actionEntry(contribution, CompactionAction.DROP, 0);
  }

  return actionEntry(contribution, CompactionAction.SUMMARIZE, summarizeTarget(contribution.estimatedTokens, config));
}

function planContextCompaction({
  health = null,
  contributions = null,
  config = CONTEXT_COMPACTION_CONFIG
} = {}) {
  const normalized = (contributions || health?.contributions || []).map(normalizeContextContribution);
  const buckets = {
    keep: [],
    summarize: [],
    drop: [],
    reretrieve: []
  };

  for (const contribution of normalized) {
    const entry = classifyContribution(contribution, config);
    buckets[entry.action].push(entry);
  }

  const attributedBefore = normalized.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const plannedSavings = [
    ...buckets.summarize,
    ...buckets.drop,
    ...buckets.reretrieve
  ].reduce((sum, item) => sum + item.estimatedSavingsTokens, 0);
  const healthTotal = Number(health?.totalUsage?.value);
  const estimatedBeforeTokens = Number.isFinite(healthTotal) && healthTotal >= 0
    ? Math.round(healthTotal)
    : attributedBefore;
  const estimatedSavingsTokens = Math.min(estimatedBeforeTokens, plannedSavings);
  const estimatedAfterTokens = Math.max(0, estimatedBeforeTokens - estimatedSavingsTokens);

  return {
    ...buckets,
    estimatedBeforeTokens,
    estimatedAfterTokens,
    estimatedSavingsTokens,
    beforeExact: Boolean(health?.totalUsage?.exact),
    afterExact: false,
    hasActionableWork: estimatedSavingsTokens > 0 &&
      (buckets.summarize.length + buckets.drop.length + buckets.reretrieve.length > 0),
    policy: {
      recentTailMessages: config.recentTailMessages,
      summaryRatio: config.summaryRatio,
      minSummaryTokens: config.minSummaryTokens
    }
  };
}

module.exports = {
  CompactionAction,
  CONTEXT_COMPACTION_CONFIG,
  planContextCompaction
};
